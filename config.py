import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
CACHE_DIR = BASE_DIR / "cache"
STREAMS_DIR = CACHE_DIR / "streams"
TOKEN_FILE = CACHE_DIR / "token.json"
ACTIVITIES_FILE = CACHE_DIR / "activities.json"

ACTIVITIES_TTL_SECONDS = 3600  # re-fetch activity list after 1 hour

REDIRECT_URI = os.environ.get("REDIRECT_URI", "http://localhost:5001/auth/callback")
STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_API_BASE = "https://www.strava.com/api/v3"

SPORT_COLORS = {
    "Run": "#e74c3c",
    "TrailRun": "#c0392b",
    "Ride": "#3498db",
    "MountainBikeRide": "#2980b9",
    "GravelRide": "#1abc9c",
    "Swim": "#00bcd4",
    "Walk": "#2ecc71",
    "Hike": "#27ae60",
    "AlpineSki": "#9b59b6",
    "NordicSki": "#8e44ad",
    "Kayaking": "#16a085",
    "Rowing": "#0e6655",
    "Workout": "#f39c12",
    "VirtualRide": "#7f8c8d",
    "VirtualRun": "#95a5a6",
}
DEFAULT_COLOR = "#7f8c8d"


def _load_dotenv():
    env_path = BASE_DIR / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def get_strava_credentials():
    """
    Return (client_id, client_secret).

    Priority:
      1. Encrypted credentials file (set via the setup UI)
      2. Environment variables / .env file (dev override)
    Returns (None, None) if not configured.
    """
    import credentials as creds_store  # imported here to avoid circular init

    client_id, client_secret, _ = creds_store.load()
    if client_id and client_secret:
        return client_id, client_secret

    _load_dotenv()
    cid = os.environ.get("STRAVA_CLIENT_ID", "")
    csecret = os.environ.get("STRAVA_CLIENT_SECRET", "")
    return (cid or None, csecret or None)


def get_osm_user_agent() -> str:
    """Return the OSM/Nominatim contact string stored in encrypted credentials."""
    import credentials as creds_store

    _, _, osm_ua = creds_store.load()
    if osm_ua:
        return f"strava2earth/1.0 ({osm_ua})"

    _load_dotenv()
    env_ua = os.environ.get("OSM_USER_AGENT", "")
    if env_ua:
        return env_ua

    return "strava2earth/1.0 (self-hosted)"
