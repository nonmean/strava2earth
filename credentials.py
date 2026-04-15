"""
Encrypted credential storage using Fernet symmetric encryption.

Two files are kept in cache/:
  .key              — randomly generated 32-byte Fernet key (never committed)
  credentials.enc   — Fernet-encrypted JSON containing client_id + client_secret

Both are gitignored. The credentials file is unreadable without the key file.
"""
import json
import stat
from pathlib import Path
from cryptography.fernet import Fernet, InvalidToken

_BASE = Path(__file__).parent / "cache"
_KEY_FILE = _BASE / ".key"
_CREDS_FILE = _BASE / "credentials.enc"


def _secure_write(path: Path, data: bytes):
    """Write binary data and restrict permissions to owner-only."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0o600


def _get_or_create_key() -> bytes:
    if _KEY_FILE.exists():
        return _KEY_FILE.read_bytes()
    key = Fernet.generate_key()
    _secure_write(_KEY_FILE, key)
    return key


def is_configured() -> bool:
    return _CREDS_FILE.exists() and _KEY_FILE.exists()


def save(client_id: str, client_secret: str) -> None:
    """Encrypt and persist Strava credentials."""
    key = _get_or_create_key()
    fernet = Fernet(key)
    plaintext = json.dumps({"client_id": client_id.strip(), "client_secret": client_secret.strip()}).encode()
    _secure_write(_CREDS_FILE, fernet.encrypt(plaintext))


def load() -> tuple:
    """Return (client_id, client_secret) or (None, None) if unavailable/corrupt."""
    if not is_configured():
        return None, None
    try:
        fernet = Fernet(_KEY_FILE.read_bytes())
        plaintext = fernet.decrypt(_CREDS_FILE.read_bytes())
        data = json.loads(plaintext)
        return data["client_id"], data["client_secret"]
    except (InvalidToken, KeyError, json.JSONDecodeError, OSError):
        return None, None


def clear() -> None:
    """Remove stored credentials (keeps the key file)."""
    if _CREDS_FILE.exists():
        _CREDS_FILE.unlink()
