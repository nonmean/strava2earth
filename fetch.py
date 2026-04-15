"""
Strava data fetcher with local cache.

Cache layout:
  cache/activities.json       — full activity list (refreshed every ACTIVITIES_TTL_SECONDS)
  cache/streams/{id}.json     — GPS stream + metadata per activity
"""
import json
import os
import time
import requests
from config import (
    CACHE_DIR, STREAMS_DIR, ACTIVITIES_FILE, ACTIVITIES_TTL_SECONDS,
    STRAVA_API_BASE
)
import auth

_sync_state = {"running": False, "total": 0, "done": 0, "errors": 0}


def _headers():
    token = auth.get_valid_token()
    if not token:
        raise RuntimeError("Not authenticated")
    return {"Authorization": f"Bearer {token}"}


# ── Activity list ────────────────────────────────────────────────────────────

def _get_athlete_id():
    """Return the authenticated athlete's integer ID from the stored token."""
    token = auth.load_token()
    if not token:
        raise RuntimeError("Not authenticated")
    athlete = token.get("athlete", {})
    athlete_id = athlete.get("id")
    if not athlete_id:
        raise RuntimeError("Athlete ID not found in token — try logging out and reconnecting.")
    return int(athlete_id)


def _fetch_all_activities(athlete_id):
    """Paginate through all activities from the Strava API, keeping only those owned by athlete_id."""
    activities = []
    page = 1
    skipped = 0
    while True:
        resp = requests.get(
            f"{STRAVA_API_BASE}/athlete/activities",
            headers=_headers(),
            params={"per_page": 200, "page": page},
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        for a in batch:
            if int(a.get("athlete", {}).get("id", 0)) == athlete_id:
                activities.append(a)
            else:
                skipped += 1
                print(f"Skipped activity {a.get('id')} — belongs to athlete {a.get('athlete', {}).get('id')}, not {athlete_id}")
        page += 1
        time.sleep(0.3)
    if skipped:
        print(f"Warning: {skipped} activities skipped (wrong athlete ID)")
    return activities


def _activities_stale():
    if not ACTIVITIES_FILE.exists():
        return True
    age = time.time() - os.path.getmtime(ACTIVITIES_FILE)
    return age > ACTIVITIES_TTL_SECONDS


def load_activities(force=False):
    """Load activity list from cache, refreshing if stale or forced."""
    if force or _activities_stale():
        athlete_id = _get_athlete_id()
        raw = _fetch_all_activities(athlete_id)
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


def _stream_cached(activity_id):
    p = _stream_path(activity_id)
    if not p.exists():
        return False
    with open(p) as f:
        data = json.load(f)
    return bool(data.get("latlng"))


def _fetch_stream(activity_id):
    resp = requests.get(
        f"{STRAVA_API_BASE}/activities/{activity_id}/streams",
        headers=_headers(),
        params={"keys": "latlng", "key_by_type": "true"},
        timeout=30,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json()
    latlng = data.get("latlng", {}).get("data", [])
    return latlng


def _reverse_geocode(lat, lng):
    """Best-effort city+country lookup via Nominatim. Returns (city, country) tuple."""
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lng, "format": "json"},
            headers={"User-Agent": "strava2earth/1.0 (bruce.xiao@gmail.com)"},
            timeout=10,
        )
        if resp.status_code == 200:
            address = resp.json().get("address", {})
            city = (
                address.get("city") or address.get("town") or
                address.get("village") or address.get("hamlet") or ""
            )
            country = address.get("country", "")
            return city, country
    except requests.RequestException as e:
        print(f"Warning: reverse geocode failed for ({lat}, {lng}): {e}")
    return "", ""


def _downsample(points, max_points=500):
    """Keep at most max_points evenly-spaced points."""
    if len(points) <= max_points:
        return points
    step = len(points) / max_points
    return [points[int(i * step)] for i in range(max_points)]


def fetch_stream_for_activity(activity):
    """Fetch and cache GPS stream for a single activity. Returns stream dict or None."""
    aid = activity["id"]
    if _stream_cached(aid):
        return None  # already have it

    if not activity.get("start_latlng"):
        return None  # no GPS

    latlng = _fetch_stream(aid)
    if not latlng:
        return None

    country = activity.get("location_country", "")
    city = activity.get("location_city", "")
    if (not country or not city) and latlng:
        lat, lng = latlng[0]
        geo_city, geo_country = _reverse_geocode(lat, lng)
        if not country:
            country = geo_country
        if not city:
            city = geo_city
        time.sleep(1.1)  # Nominatim rate limit

    stream = {
        "id": aid,
        "name": activity["name"],
        "sport_type": activity["sport_type"],
        "start_date": activity["start_date"],
        "distance": activity["distance"],
        "elapsed_time": activity["elapsed_time"],
        "location_country": country,
        "location_city": city,
        "latlng": _downsample(latlng),
    }

    STREAMS_DIR.mkdir(parents=True, exist_ok=True)
    with open(_stream_path(aid), "w") as f:
        json.dump(stream, f)

    return stream


# ── Sync orchestration ───────────────────────────────────────────────────────

def sync(force=False):
    """
    Main sync function — call in a background thread.
    Fetches activity list then downloads missing GPS streams.
    """
    global _sync_state
    _sync_state["running"] = True
    _sync_state["errors"] = 0

    try:
        activities = load_activities(force=force)
        gps_activities = [a for a in activities if a.get("start_latlng")]
        _sync_state["total"] = len(gps_activities)
        _sync_state["done"] = sum(1 for a in gps_activities if _stream_cached(a["id"]))

        for activity in gps_activities:
            if _stream_cached(activity["id"]):
                continue
            try:
                fetch_stream_for_activity(activity)
                _sync_state["done"] += 1
            except Exception as e:
                _sync_state["errors"] += 1
                print(f"Error fetching stream for {activity['id']}: {e}")
            time.sleep(0.5)  # stay under 100 req/15min burst limit

        _backfill_cities_nominatim()
    finally:
        _sync_state["running"] = False


def _backfill_cities_nominatim():
    """
    For cached streams that still have no location_city after the activities.json
    merge, call Nominatim reverse geocoding using the first GPS point.
    Runs at the end of sync() — already on a background thread.
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
            continue  # already has city

        latlng = stream.get("latlng")
        if not latlng:
            continue

        lat, lng = latlng[0]
        geo_city, geo_country = _reverse_geocode(lat, lng)
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


def sync_status():
    return dict(_sync_state)


# ── In-memory route cache ────────────────────────────────────────────────────
# Avoids re-reading hundreds of stream files on every API request.
# The cache is keyed by the maximum mtime across all stream files; any new
# file written by sync() will bump the mtime and trigger a reload.

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
    Streams still missing city after this pass will be filled by Nominatim
    during the next sync().
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


# ── Query cache for routes ───────────────────────────────────────────────────

def get_routes(from_date=None, to_date=None, country=None, city=None):
    """
    Return a GeoJSON FeatureCollection from the in-memory route cache,
    filtered by date range, country, and city.
    """
    from config import SPORT_COLORS, DEFAULT_COLOR

    features = []
    for stream in _load_route_data():
        start_date = stream.get("start_date", "")[:10]  # YYYY-MM-DD
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

        # GeoJSON requires [lng, lat] — Strava gives [lat, lng]
        coords = [[pt[1], pt[0]] for pt in stream["latlng"]]

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
                "country": stream_country,
                "city": stream_city,
                "color": color,
            },
        })

    return {"type": "FeatureCollection", "features": features}


def get_countries():
    """Return sorted list of unique countries present in the in-memory cache."""
    countries = {(s.get("location_country") or "").strip() for s in _load_route_data()}
    countries.discard("")
    return sorted(countries)


def get_cities(country=None):
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
