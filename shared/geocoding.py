import time
import requests
from shared.config import get_osm_user_agent


def reverse_geocode(lat: float, lng: float) -> tuple:
    """Best-effort city+country lookup via Nominatim. Returns (city, country) tuple."""
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lng, "format": "json"},
            headers={"User-Agent": get_osm_user_agent()},
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
