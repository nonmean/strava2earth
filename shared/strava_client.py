"""
Outbound Strava API calls. All functions accept access_token explicitly
so this module has no dependency on auth or Flask.
"""
import time
import requests
from shared.config import STRAVA_API_BASE


def _headers(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


def fetch_activities_page(access_token: str, page: int, athlete_id: int) -> list:
    """Fetch one page of activities from Strava, filtering to athlete_id."""
    resp = requests.get(
        f"{STRAVA_API_BASE}/athlete/activities",
        headers=_headers(access_token),
        params={"per_page": 200, "page": page},
        timeout=30,
    )
    resp.raise_for_status()
    batch = resp.json()
    skipped = 0
    result = []
    for a in batch:
        if int(a.get("athlete", {}).get("id", 0)) == athlete_id:
            result.append(a)
        else:
            skipped += 1
            print(f"Skipped activity {a.get('id')} — belongs to athlete {a.get('athlete', {}).get('id')}, not {athlete_id}")
    if skipped:
        print(f"Warning: {skipped} activities skipped (wrong athlete ID)")
    return result


def fetch_all_activities(access_token: str, athlete_id: int) -> list:
    """Paginate through all activities from the Strava API."""
    activities = []
    page = 1
    while True:
        batch = fetch_activities_page(access_token, page, athlete_id)
        if not batch:
            break
        activities.extend(batch)
        page += 1
        time.sleep(0.3)
    return activities


def fetch_stream(access_token: str, activity_id: int):
    """Fetch GPS/altitude/distance streams for a single activity. Returns None on 404."""
    resp = requests.get(
        f"{STRAVA_API_BASE}/activities/{activity_id}/streams",
        headers=_headers(access_token),
        params={"keys": "latlng,altitude,distance,heartrate,velocity_smooth", "key_by_type": "true"},
        timeout=30,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json()
    return {
        "latlng": data.get("latlng", {}).get("data", []),
        "altitude": data.get("altitude", {}).get("data", []),
        "distance": data.get("distance", {}).get("data", []),
        "heartrate": data.get("heartrate", {}).get("data", []),
        "velocity_smooth": data.get("velocity_smooth", {}).get("data", []),
    }


def update_activity(access_token: str, activity_id: int, **fields) -> dict:
    """PUT fields to Strava activity. Raises PermissionError on 403, HTTPError otherwise."""
    resp = requests.put(
        f"{STRAVA_API_BASE}/activities/{activity_id}",
        headers=_headers(access_token),
        json=fields,
        timeout=15,
    )
    if resp.status_code == 403:
        raise PermissionError(
            "Missing activity:write permission — please logout and reconnect to Strava"
        )
    resp.raise_for_status()
    return resp.json()
