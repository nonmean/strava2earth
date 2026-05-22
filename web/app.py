import json
import stat
import threading
import requests as http_requests
from flask import Flask, redirect, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import auth
from shared import cache_manager as fetch
from shared import credentials as creds_store
from shared.config import CACHE_DIR, STREAMS_DIR, MEMORY_FILE, get_strava_credentials

app = Flask(__name__, static_folder="static")
_ALLOWED_ORIGINS = ["http://localhost:5001", "http://127.0.0.1:5001"]
CORS(app, resources={r"/api/*": {"origins": _ALLOWED_ORIGINS}, r"/auth/*": {"origins": _ALLOWED_ORIGINS}})

# Ensure cache dirs exist on startup
CACHE_DIR.mkdir(parents=True, exist_ok=True)
STREAMS_DIR.mkdir(parents=True, exist_ok=True)

_sync_thread = None


# ── Auth routes ──────────────────────────────────────────────────────────────

@app.route("/auth/login")
def login():
    return redirect(auth.get_auth_url())


@app.route("/auth/callback")
def callback():
    code = request.args.get("code")
    error = request.args.get("error")
    returned_state = request.args.get("state", "")
    if error or not code:
        return f"Strava auth error: {error or 'no code returned'}", 400
    if not auth.verify_state(returned_state):
        return "OAuth state mismatch — possible CSRF. Please try logging in again.", 400
    try:
        auth.exchange_code(code)
    except (RuntimeError, OSError) as e:
        return f"Token exchange failed: {e}", 500
    # Return a page that signals Android's Chrome Custom Tab via deep link,
    # and falls back to the web SPA for desktop browsers after 600ms.
    return """<!doctype html><html><body><script>
  window.location.href = 'strava2earth://auth/callback?success=1';
  setTimeout(function(){ window.location.href = '/'; }, 600);
</script><p>Redirecting...</p></body></html>"""


@app.route("/auth/logout")
def logout():
    auth.clear_token()
    return redirect("/")


# ── API routes ───────────────────────────────────────────────────────────────

def _require_auth():
    """Returns a 401 Response if not authenticated, else None."""
    if not auth.get_valid_token():
        return Response('{"error":"not_authenticated"}', status=401, mimetype="application/json")
    return None


@app.route("/api/sync")
def api_sync():
    err = _require_auth()
    if err:
        return err

    global _sync_thread
    force_streams = request.args.get("force", "0") == "1"

    if not fetch.try_start_sync():
        return jsonify({"status": "in_progress", **fetch.sync_status()})

    access_token = auth.get_valid_token()
    token_data = auth.load_token()
    _sync_thread = threading.Thread(
        target=fetch.sync,
        kwargs={"access_token": access_token, "token_data": token_data, "force_streams": force_streams},
        daemon=True,
    )
    _sync_thread.start()
    return jsonify({"status": "started"})


@app.route("/api/sync/status")
def api_sync_status():
    err = _require_auth()
    if err:
        return err
    return jsonify(fetch.sync_status())


@app.route("/api/activities")
def api_activities():
    err = _require_auth()
    if err:
        return err
    try:
        activities = fetch.load_activities(auth.get_valid_token(), auth.load_token())
    except (RuntimeError, OSError) as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(activities)


@app.route("/api/routes")
def api_routes():
    err = _require_auth()
    if err:
        return err
    from_date = request.args.get("from") or None
    to_date = request.args.get("to") or None
    country = request.args.get("country") or None
    city = request.args.get("city") or None
    geojson = fetch.get_routes(from_date=from_date, to_date=to_date, country=country, city=city)
    return jsonify(geojson)


@app.route("/api/stream/<int:activity_id>")
def api_stream(activity_id):
    err = _require_auth()
    if err:
        return err
    stream = fetch.get_stream(activity_id)
    if not stream:
        return jsonify({"altitude": [], "distance_stream": []})
    return jsonify({
        "altitude": stream.get("altitude", []),
        "distance_stream": stream.get("distance_stream", []),
    })


@app.route("/api/activity-stats")
def api_activity_stats():
    err = _require_auth()
    if err:
        return err
    return jsonify(fetch.get_activity_stats())


@app.route("/api/countries")
def api_countries():
    err = _require_auth()
    if err:
        return err
    return jsonify(fetch.get_countries())


@app.route("/api/cities")
def api_cities():
    err = _require_auth()
    if err:
        return err
    country = request.args.get("country") or None
    return jsonify(fetch.get_cities(country=country))


# ── Setup routes (credential management) ─────────────────────────────────────

@app.route("/api/setup/status")
def api_setup_status():
    client_id, _ = get_strava_credentials()
    return jsonify({"configured": bool(client_id)})


@app.route("/api/setup/credentials", methods=["POST"])
def api_setup_credentials():
    body = request.get_json(silent=True) or {}
    client_id = (body.get("client_id") or "").strip()
    client_secret = (body.get("client_secret") or "").strip()
    osm_user_agent = (body.get("osm_user_agent") or "").strip()
    deepseek_api_key = (body.get("deepseek_api_key") or "").strip()

    if not client_id or not client_secret:
        return jsonify({"error": "client_id and client_secret are required"}), 400

    # Prevent credential replacement when already configured — require active auth
    existing_id, existing_secret, _, _ = creds_store.load()
    if existing_id and existing_secret:
        err = _require_auth()
        if err:
            return err

    try:
        creds_store.save(client_id, client_secret, osm_user_agent, deepseek_api_key)
        auth.clear_token()
        fetch.clear_cache()
    except OSError as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@app.route("/api/setup/osm-email", methods=["POST"])
def api_setup_osm_email():
    body = request.get_json(silent=True) or {}
    osm_user_agent = (body.get("osm_user_agent") or "").strip()
    client_id, client_secret, _, deepseek_api_key = creds_store.load()
    if not client_id or not client_secret:
        return jsonify({"error": "No credentials found"}), 400
    try:
        creds_store.save(client_id, client_secret, osm_user_agent, deepseek_api_key)
    except OSError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


@app.route("/api/setup/clear", methods=["POST"])
def api_setup_clear():
    if not request.is_json:
        return jsonify({"error": "bad_request"}), 400
    creds_store.clear()
    auth.clear_token()
    fetch.clear_cache()
    return jsonify({"ok": True})


@app.route("/api/status")
def api_status():
    client_id, _, osm_ua, deepseek_api_key = creds_store.load()
    if not client_id:
        client_id, _ = get_strava_credentials()
    configured = bool(client_id)
    authenticated = False
    if configured:
        try:
            authenticated = auth.get_valid_token() is not None
        except Exception:
            authenticated = False
    token = auth.load_token()
    athlete_name = ""
    if token and "athlete" in token:
        a = token["athlete"]
        athlete_name = f"{a.get('firstname', '')} {a.get('lastname', '')}".strip()
    return jsonify({
        "configured": configured,
        "osm_user_agent": osm_ua or "",
        "has_deepseek_key": bool(deepseek_api_key),
        "authenticated": authenticated,
        "athlete_name": athlete_name,
        "sync": fetch.sync_status(),
    })


@app.route("/api/activity/<int:activity_id>", methods=["PUT"])
def api_update_activity(activity_id):
    err = _require_auth()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    new_name = (body.get("name") or "").strip()
    new_sport_type = (body.get("sport_type") or "").strip()
    if not new_name and not new_sport_type:
        return jsonify({"error": "name or sport_type is required"}), 400
    if new_name and new_sport_type:
        return jsonify({"error": "send name and sport_type in separate requests"}), 400
    try:
        access_token = auth.get_valid_token()
        result = {}
        if new_name:
            result["name"] = fetch.update_activity_name(access_token, activity_id, new_name)
        if new_sport_type:
            actual_type, color = fetch.update_activity_sport_type(access_token, activity_id, new_sport_type)
            result["sport_type"] = actual_type
            result["color"] = color
        return jsonify(result)
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except http_requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        if status == 429:
            return jsonify({"error": "Strava rate limit exceeded — try again later"}), 429
        if status in (400, 401, 404):
            return jsonify({"error": str(e)}), status
        return jsonify({"error": str(e)}), 502
    except http_requests.RequestException as e:
        return jsonify({"error": f"Network error: {e}"}), 502
    except (RuntimeError, OSError) as e:
        return jsonify({"error": str(e)}), 500


# ── Memory routes ────────────────────────────────────────────────────────────

@app.route("/api/memory")
def api_memory_get():
    err = _require_auth()
    if err:
        return err
    if not MEMORY_FILE.exists():
        return jsonify({})
    try:
        with open(MEMORY_FILE) as f:
            return jsonify(json.load(f))
    except (json.JSONDecodeError, OSError):
        return jsonify({})


@app.route("/api/memory", methods=["POST"])
def api_memory_post():
    err = _require_auth()
    if err:
        return err
    body = request.get_json(silent=True)
    if body is None:
        return jsonify({"error": "invalid JSON"}), 400
    if len(json.dumps(body)) > 200_000:
        return jsonify({"error": "payload too large"}), 413
    try:
        MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        MEMORY_FILE.write_text(json.dumps(body))
        MEMORY_FILE.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except OSError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


# ── Chat route ────────────────────────────────────────────────────────────────

DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"


@app.route("/api/chat", methods=["POST"])
def api_chat():
    err = _require_auth()
    if err:
        return err

    _, _, _, deepseek_api_key = creds_store.load()
    if not deepseek_api_key:
        return jsonify({"error": "DeepSeek API key not configured"}), 400

    body = request.get_json(silent=True) or {}
    messages = body.get("messages", [])
    model = body.get("model", "deepseek-chat")

    if model not in ("deepseek-v4-flash", "deepseek-v4-pro"):
        model = "deepseek-v4-flash"

    try:
        resp = http_requests.post(
            DEEPSEEK_API_URL,
            headers={"Authorization": f"Bearer {deepseek_api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": messages},
            timeout=60,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        return jsonify({"content": content})
    except http_requests.RequestException as e:
        return jsonify({"error": str(e)}), 502


# ── Static files ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


if __name__ == "__main__":
    print("Starting strava2earth at http://localhost:5001")
    app.run(debug=True, port=5001)
