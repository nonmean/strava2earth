"""
Strava data cache manager.

Cache layout:
  cache/activities.json       — full activity list (refreshed every ACTIVITIES_TTL_SECONDS)
  cache/streams/{id}.json     — GPS stream + metadata per activity
"""
import json
import os
import threading
import time
import requests
from shared.config import (
    CACHE_DIR, STREAMS_DIR, ACTIVITIES_FILE, ACTIVITIES_TTL_SECONDS,
    SPORT_COLORS, DEFAULT_COLOR,
)
from shared import strava_client, geocoding

_sync_lock = threading.Lock()
_sync_state = {"running": False, "total": 0, "done": 0, "errors": 0, "last_error": ""}


# ── Activity list ────────────────────────────────────────────────────────────

def _get_athlete_id(token_data: dict) -> int:
    """Return the authenticated athlete's integer ID from the token dict."""
    athlete = token_data.get("athlete", {})
    athlete_id = athlete.get("id")
    if not athlete_id:
        raise RuntimeError("Athlete ID not found in token — try logging out and reconnecting.")
    return int(athlete_id)


def _activities_stale() -> bool:
    if not ACTIVITIES_FILE.exists():
        return True
    age = time.time() - os.path.getmtime(ACTIVITIES_FILE)
    return age > ACTIVITIES_TTL_SECONDS


def load_activities(access_token: str, token_data: dict = None, force: bool = False) -> list:
    """Load activity list from cache, refreshing from Strava if stale or forced."""
    if force or _activities_stale():
        if token_data is None:
            raise RuntimeError("token_data required to refresh activities")
        athlete_id = _get_athlete_id(token_data)
        raw = strava_client.fetch_all_activities(access_token, athlete_id)
        slim = []
        for a in raw:
            slim.append({
                "id": a["id"],
                "athlete_id": athlete_id,
                "name": a.get("name", ""),
                "sport_type": a.get("sport_type") or a.get("type", "Other"),
                "start_date": a.get("start_date", ""),
                "start_latlng": a.get("start_latlng"),
                "distance": a.get("distance", 0),
                "elapsed_time": a.get("elapsed_time", 0),
                "moving_time": a.get("moving_time", 0),
                "total_elevation_gain": a.get("total_elevation_gain"),
                "average_speed": a.get("average_speed"),
                "max_speed": a.get("max_speed"),
                "average_heartrate": a.get("average_heartrate"),
                "max_heartrate": a.get("max_heartrate"),
                "suffer_score": a.get("suffer_score"),
                "average_watts": a.get("average_watts"),
                "weighted_average_watts": a.get("weighted_average_watts"),
                "kilojoules": a.get("kilojoules"),
                "average_cadence": a.get("average_cadence"),
                "pr_count": a.get("pr_count", 0),
                "location_country": a.get("location_country") or "",
                "location_city": a.get("location_city") or "",
            })
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with open(ACTIVITIES_FILE, "w") as f:
            json.dump(slim, f)
        return slim

    with open(ACTIVITIES_FILE) as f:
        return json.load(f)


# ── GPS streams ──────────────────────────────────────────────────────────────

def _stream_path(activity_id):
    return STREAMS_DIR / f"{activity_id}.json"


def _stream_cached(activity_id) -> bool:
    p = _stream_path(activity_id)
    if not p.exists():
        return False
    try:
        with open(p) as f:
            data = json.load(f)
        return bool(data.get("latlng"))
    except (json.JSONDecodeError, OSError):
        return False


def _compute_hr_zones(heartrate_data, max_hr=None):
    """Return percentage of time in each of 5 HR zones, or None if no data."""
    if not heartrate_data:
        return None
    if not max_hr:
        max_hr = max(heartrate_data)
    if not max_hr:
        return None
    thresholds = [0.60, 0.70, 0.80, 0.90, 1.01]
    counts = [0] * 5
    for hr in heartrate_data:
        pct = hr / max_hr
        for i, t in enumerate(thresholds):
            if pct <= t:
                counts[i] += 1
                break
    total = len(heartrate_data)
    return {f"z{i+1}": round(c / total * 100) for i, c in enumerate(counts)}


def _downsample_streams(latlng, altitude, distance, max_points=500):
    """Downsample latlng, altitude, and distance arrays together at the same indices."""
    n = len(latlng)
    if n <= max_points:
        return latlng, altitude, distance
    step = n / max_points
    indices = [int(i * step) for i in range(max_points)]
    ds_latlng = [latlng[i] for i in indices]
    ds_alt = [round(altitude[i], 1) for i in indices] if len(altitude) == n else []
    ds_dist = [round(distance[i], 1) for i in indices] if len(distance) == n else []
    return ds_latlng, ds_alt, ds_dist


def fetch_stream_for_activity(access_token: str, activity: dict):
    """Fetch and cache GPS stream for a single activity. Returns stream dict or None."""
    aid = activity["id"]
    if _stream_cached(aid):
        return None  # already have it

    if not activity.get("start_latlng"):
        return None  # no GPS

    stream_data = strava_client.fetch_stream(access_token, aid)
    if not stream_data or not stream_data["latlng"]:
        return None

    latlng, altitude, distance = _downsample_streams(
        stream_data["latlng"], stream_data["altitude"], stream_data["distance"]
    )

    country = activity.get("location_country", "")
    city = activity.get("location_city", "")
    if (not country or not city) and latlng:
        lat, lng = latlng[0]
        geo_city, geo_country = geocoding.reverse_geocode(lat, lng)
        if not country:
            country = geo_country
        if not city:
            city = geo_city
        time.sleep(1.1)  # Nominatim rate limit

    hr_data = stream_data.get("heartrate", [])
    vel_data = stream_data.get("velocity_smooth", [])
    hr_zones = _compute_hr_zones(hr_data, activity.get("max_heartrate"))
    avg_speed_kmh = round(sum(vel_data) / len(vel_data) * 3.6, 2) if vel_data else None
    max_speed_kmh = round(max(vel_data) * 3.6, 2) if vel_data else None

    stream = {
        "id": aid,
        "name": activity["name"],
        "sport_type": activity["sport_type"],
        "start_date": activity["start_date"],
        "distance": activity["distance"],
        "elapsed_time": activity["elapsed_time"],
        "moving_time": activity.get("moving_time", 0),
        "total_elevation_gain": activity.get("total_elevation_gain"),
        "average_speed": activity.get("average_speed"),
        "max_speed": activity.get("max_speed"),
        "average_heartrate": activity.get("average_heartrate"),
        "max_heartrate": activity.get("max_heartrate"),
        "suffer_score": activity.get("suffer_score"),
        "average_watts": activity.get("average_watts"),
        "weighted_average_watts": activity.get("weighted_average_watts"),
        "kilojoules": activity.get("kilojoules"),
        "average_cadence": activity.get("average_cadence"),
        "pr_count": activity.get("pr_count", 0),
        "hr_zones": hr_zones,
        "avg_speed_kmh": avg_speed_kmh,
        "max_speed_kmh": max_speed_kmh,
        "location_country": country,
        "location_city": city,
        "latlng": latlng,
        "altitude": altitude,
        "distance_stream": distance,
    }

    STREAMS_DIR.mkdir(parents=True, exist_ok=True)
    with open(_stream_path(aid), "w") as f:
        json.dump(stream, f)

    return stream


# ── Sync orchestration ───────────────────────────────────────────────────────

def try_start_sync() -> bool:
    """Atomically mark sync as running. Returns True if started, False if already running."""
    with _sync_lock:
        if _sync_state["running"]:
            return False
        _sync_state["running"] = True
        _sync_state["errors"] = 0
        _sync_state["last_error"] = ""
        return True


def sync(access_token: str, token_data: dict, force_streams: bool = False):
    """
    Main sync function — call in a background thread.
    Always re-fetches the activity list from Strava to catch new activities.
    If force_streams=True, re-downloads all GPS streams (wipes existing cache).
    """
    global _route_data, _route_data_mtime

    try:
        activities = load_activities(access_token, token_data, force=True)
        gps_activities = [a for a in activities if a.get("start_latlng")]
        initial_done = 0 if force_streams else sum(
            1 for a in gps_activities if _stream_cached(a["id"])
        )
        with _sync_lock:
            _sync_state["total"] = len(gps_activities)
            _sync_state["done"] = initial_done

        if force_streams:
            _route_data = []
            _route_data_mtime = 0.0

        for activity in gps_activities:
            if force_streams:
                p = _stream_path(activity["id"])
                if p.exists():
                    p.unlink()
            elif _stream_cached(activity["id"]):
                continue
            try:
                fetch_stream_for_activity(access_token, activity)
                with _sync_lock:
                    _sync_state["done"] += 1
            except requests.RequestException as e:
                with _sync_lock:
                    _sync_state["errors"] += 1
                    _sync_state["last_error"] = str(e)
                print(f"Network error fetching stream for {activity['id']}: {e}")
                if getattr(e.response, "status_code", None) == 429:
                    print("Rate limit hit — aborting sync early.")
                    with _sync_lock:
                        _sync_state["last_error"] = "Strava rate limit exceeded. Try again later."
                    return
            except (json.JSONDecodeError, OSError, KeyError, ValueError) as e:
                with _sync_lock:
                    _sync_state["errors"] += 1
                    _sync_state["last_error"] = str(e)
                print(f"Error fetching stream for {activity['id']}: {e}")
            time.sleep(0.5)  # stay under 100 req/15min burst limit

        _backfill_cities_nominatim()
    finally:
        with _sync_lock:
            _sync_state["running"] = False


def sync_status() -> dict:
    with _sync_lock:
        return dict(_sync_state)


# ── Activity mutations ───────────────────────────────────────────────────────

def update_activity_name(access_token: str, activity_id: int, new_name: str) -> str:
    """Push a renamed activity to Strava and update local cache. Returns the saved name."""
    result = strava_client.update_activity(access_token, activity_id, name=new_name)
    actual_name = result.get("name", new_name)

    path = _stream_path(activity_id)
    if path.exists():
        try:
            with open(path) as f:
                stream = json.load(f)
            stream["name"] = actual_name
            with open(path, "w") as f:
                json.dump(stream, f)
        except (json.JSONDecodeError, OSError):
            pass

    if ACTIVITIES_FILE.exists():
        try:
            with open(ACTIVITIES_FILE) as f:
                activities = json.load(f)
            for a in activities:
                if a["id"] == activity_id:
                    a["name"] = actual_name
                    break
            with open(ACTIVITIES_FILE, "w") as f:
                json.dump(activities, f)
        except (json.JSONDecodeError, OSError):
            pass

    global _route_data_mtime
    _route_data_mtime = 0.0
    return actual_name


def update_activity_sport_type(access_token: str, activity_id: int, sport_type: str) -> tuple:
    """Push a sport_type change to Strava and update local cache. Returns (sport_type, color)."""
    result = strava_client.update_activity(access_token, activity_id, sport_type=sport_type)
    actual_sport_type = result.get("sport_type", sport_type)
    new_color = SPORT_COLORS.get(actual_sport_type, DEFAULT_COLOR)

    path = _stream_path(activity_id)
    if path.exists():
        try:
            with open(path) as f:
                stream = json.load(f)
            stream["sport_type"] = actual_sport_type
            with open(path, "w") as f:
                json.dump(stream, f)
        except (json.JSONDecodeError, OSError):
            pass

    if ACTIVITIES_FILE.exists():
        try:
            with open(ACTIVITIES_FILE) as f:
                activities = json.load(f)
            for a in activities:
                if a["id"] == activity_id:
                    a["sport_type"] = actual_sport_type
                    break
            with open(ACTIVITIES_FILE, "w") as f:
                json.dump(activities, f)
        except (json.JSONDecodeError, OSError):
            pass

    global _route_data_mtime
    _route_data_mtime = 0.0
    return actual_sport_type, new_color


# ── In-memory route cache ────────────────────────────────────────────────────

_route_data: list = []
_route_data_mtime: float = 0.0


def _load_route_data() -> list:
    """Return all cached stream dicts, reloading from disk only when files change."""
    global _route_data, _route_data_mtime

    if not STREAMS_DIR.exists():
        return []

    try:
        current_mtime = max(
            (p.stat().st_mtime for p in STREAMS_DIR.glob("*.json")),
            default=0.0,
        )
    except OSError:
        current_mtime = 0.0

    if current_mtime <= _route_data_mtime and _route_data:
        return _route_data

    data = []
    for path in STREAMS_DIR.glob("*.json"):
        try:
            with open(path) as f:
                stream = json.load(f)
            if stream.get("latlng"):
                data.append(stream)
        except (json.JSONDecodeError, OSError):
            continue

    _route_data = _enrich_cities(data)
    _route_data_mtime = current_mtime
    return _route_data


def _enrich_cities(streams: list) -> list:
    """
    For streams missing location_city, pull the value from activities.json
    (Strava-provided city) and write it back to the stream file on disk.
    """
    if not ACTIVITIES_FILE.exists():
        return streams

    try:
        with open(ACTIVITIES_FILE) as f:
            acts = json.load(f)
        act_city_map = {
            a["id"]: (a.get("location_city") or "").strip()
            for a in acts
        }
    except (json.JSONDecodeError, OSError):
        return streams

    enriched = []
    for stream in streams:
        if not (stream.get("location_city") or "").strip():
            city = act_city_map.get(stream.get("id"), "")
            if city:
                stream = {**stream, "location_city": city}
                try:
                    with open(_stream_path(stream["id"]), "w") as f:
                        json.dump(stream, f)
                except OSError:
                    pass
        enriched.append(stream)
    return enriched


def _backfill_cities_nominatim():
    """
    For cached streams that still have no location_city after the activities.json
    merge, call Nominatim reverse geocoding using the first GPS point.
    """
    if not STREAMS_DIR.exists():
        return

    for path in STREAMS_DIR.glob("*.json"):
        try:
            with open(path) as f:
                stream = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        if (stream.get("location_city") or "").strip():
            continue

        latlng = stream.get("latlng")
        if not latlng:
            continue

        lat, lng = latlng[0]
        geo_city, geo_country = geocoding.reverse_geocode(lat, lng)
        if not geo_city and not geo_country:
            continue

        if geo_city:
            stream["location_city"] = geo_city
        if not (stream.get("location_country") or "").strip() and geo_country:
            stream["location_country"] = geo_country

        try:
            with open(path, "w") as f:
                json.dump(stream, f)
        except OSError:
            pass

        time.sleep(1.1)  # Nominatim rate limit: max 1 req/s


# ── Query cache for routes ───────────────────────────────────────────────────

def get_routes(from_date=None, to_date=None, country=None, city=None) -> dict:
    """Return a GeoJSON FeatureCollection filtered by date, country, city."""
    features = []
    for stream in _load_route_data():
        start_date = stream.get("start_date", "")[:10]
        if from_date and start_date < from_date:
            continue
        if to_date and start_date > to_date:
            continue

        stream_country = (stream.get("location_country") or "").strip()
        if country and country.lower() not in stream_country.lower():
            continue

        stream_city = (stream.get("location_city") or "").strip()
        if city and city.lower() not in stream_city.lower():
            continue

        coords = [[pt[1], pt[0]] for pt in stream["latlng"]]  # [lng, lat] for GeoJSON

        sport = stream.get("sport_type", "Other")
        color = SPORT_COLORS.get(sport, DEFAULT_COLOR)

        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "id": stream["id"],
                "name": stream["name"],
                "sport_type": sport,
                "start_date": stream["start_date"],
                "distance_km": round(stream.get("distance", 0) / 1000, 2),
                "elapsed_time": stream.get("elapsed_time", 0),
                "moving_time": stream.get("moving_time") or 0,
                "total_elevation_gain": stream.get("total_elevation_gain"),
                "average_speed": stream.get("average_speed"),
                "average_heartrate": stream.get("average_heartrate"),
                "max_heartrate": stream.get("max_heartrate"),
                "country": stream_country,
                "city": stream_city,
                "color": color,
            },
        })

    return {"type": "FeatureCollection", "features": features}


def get_countries() -> list:
    """Return sorted list of unique countries present in the in-memory cache."""
    countries = {(s.get("location_country") or "").strip() for s in _load_route_data()}
    countries.discard("")
    return sorted(countries)


def get_cities(country=None) -> list:
    """Return sorted list of unique cities, optionally filtered to a country."""
    cities = set()
    for s in _load_route_data():
        if country:
            stream_country = (s.get("location_country") or "").strip()
            if country.lower() not in stream_country.lower():
                continue
        city = (s.get("location_city") or "").strip()
        if city:
            cities.add(city)
    return sorted(cities)


def get_stream(activity_id: int):
    """Return the cached stream dict for a single activity, or None if not cached."""
    path = _stream_path(activity_id)
    if not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def get_activity_stats(access_token: str = None, token_data: dict = None) -> list:
    """
    Return per-activity stats for the coach context: merges activities.json fields
    with stream-computed fields (hr_zones, speed). No GPS coordinates.
    """
    stream_extras = {}
    if STREAMS_DIR.exists():
        for path in STREAMS_DIR.glob("*.json"):
            try:
                with open(path) as f:
                    s = json.load(f)
                stream_extras[s["id"]] = {
                    "hr_zones": s.get("hr_zones"),
                    "avg_speed_kmh": s.get("avg_speed_kmh"),
                    "max_speed_kmh": s.get("max_speed_kmh"),
                    "suffer_score": s.get("suffer_score"),
                    "average_watts": s.get("average_watts"),
                    "weighted_average_watts": s.get("weighted_average_watts"),
                    "kilojoules": s.get("kilojoules"),
                    "average_cadence": s.get("average_cadence"),
                    "pr_count": s.get("pr_count", 0),
                }
            except (json.JSONDecodeError, OSError, KeyError):
                continue

    try:
        if ACTIVITIES_FILE.exists():
            with open(ACTIVITIES_FILE) as f:
                activities = json.load(f)
        elif access_token and token_data:
            activities = load_activities(access_token, token_data)
        else:
            return []
    except (RuntimeError, OSError):
        return []

    result = []
    for a in activities:
        extras = stream_extras.get(a["id"], {})
        result.append({
            "id": a["id"],
            "name": a["name"],
            "sport_type": a["sport_type"],
            "start_date": a["start_date"],
            "distance_km": round(a.get("distance", 0) / 1000, 2),
            "elapsed_time": a.get("elapsed_time", 0),
            "moving_time": a.get("moving_time", 0),
            "total_elevation_gain": a.get("total_elevation_gain"),
            "average_heartrate": a.get("average_heartrate"),
            "max_heartrate": a.get("max_heartrate"),
            "average_speed_kmh": round(a["average_speed"] * 3.6, 2) if a.get("average_speed") else None,
            "suffer_score": extras.get("suffer_score") or a.get("suffer_score"),
            "average_watts": extras.get("average_watts") or a.get("average_watts"),
            "weighted_average_watts": extras.get("weighted_average_watts") or a.get("weighted_average_watts"),
            "kilojoules": extras.get("kilojoules") or a.get("kilojoules"),
            "average_cadence": extras.get("average_cadence") or a.get("average_cadence"),
            "pr_count": extras.get("pr_count") or a.get("pr_count", 0),
            "hr_zones": extras.get("hr_zones"),
            "location_city": a.get("location_city", ""),
            "location_country": a.get("location_country", ""),
        })
    return result


def clear_cache():
    """Delete all cached activity and stream data."""
    global _route_data, _route_data_mtime
    if ACTIVITIES_FILE.exists():
        ACTIVITIES_FILE.unlink()
    if STREAMS_DIR.exists():
        for p in STREAMS_DIR.glob("*.json"):
            p.unlink()
    _route_data = []
    _route_data_mtime = 0.0
