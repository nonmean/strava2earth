import json
import os
import secrets
import stat
import time
import requests
from urllib.parse import urlencode
from shared.config import (
    TOKEN_FILE, STRAVA_TOKEN_URL, STRAVA_AUTH_URL,
    REDIRECT_URI, CACHE_DIR, get_strava_credentials
)

_STATE_FILE = CACHE_DIR / ".oauth_state"


def _save_state(state: str) -> None:
    _STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _STATE_FILE.write_text(state)
    _STATE_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)


def _load_and_clear_state():
    if not _STATE_FILE.exists():
        return None
    try:
        value = _STATE_FILE.read_text().strip()
        _STATE_FILE.unlink()
        return value or None
    except OSError:
        return None


def get_auth_url():
    client_id, _ = get_strava_credentials()
    state = secrets.token_urlsafe(24)
    _save_state(state)
    params = urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "approval_prompt": "auto",
        "scope": "activity:read_all,activity:write",
        "state": state,
    })
    return f"{STRAVA_AUTH_URL}?{params}"


def verify_state(returned_state: str) -> bool:
    """Return True if returned_state matches the saved state (and consume it)."""
    saved = _load_and_clear_state()
    return saved is not None and secrets.compare_digest(saved, returned_state)


def load_token():
    if not TOKEN_FILE.exists():
        return None
    try:
        with open(TOKEN_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def save_token(token_data):
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)
    TOKEN_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)


def clear_token():
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()


def get_valid_token():
    """Return a valid access token, refreshing if needed. Returns None if not authenticated."""
    token = load_token()
    if not token:
        return None

    if token.get("expires_at", 0) > time.time() + 60:
        return token["access_token"]

    client_id, client_secret = get_strava_credentials()
    resp = requests.post(STRAVA_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "refresh_token",
        "refresh_token": token["refresh_token"],
    }, timeout=15)

    if resp.status_code == 401:
        clear_token()
        return None

    resp.raise_for_status()
    new_token = resp.json()
    save_token(new_token)
    return new_token["access_token"]


def exchange_code(code):
    """Exchange OAuth code for token after callback. Returns token data."""
    client_id, client_secret = get_strava_credentials()
    resp = requests.post(STRAVA_TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "grant_type": "authorization_code",
    }, timeout=15)
    resp.raise_for_status()
    token_data = resp.json()
    save_token(token_data)
    return token_data


def is_authenticated():
    token = load_token()
    return token is not None
