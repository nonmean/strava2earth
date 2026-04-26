import threading
from flask import Flask, redirect, request, jsonify, send_from_directory, Response
import auth
import fetch
import credentials as creds_store
from config import CACHE_DIR, STREAMS_DIR, get_strava_credentials

app = Flask(__name__, static_folder="static")

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
    if error or not code:
        return f"Strava auth error: {error or 'no code returned'}", 400
    try:
        auth.exchange_code(code)
    except (RuntimeError, OSError) as e:
        return f"Token exchange failed: {e}", 500
    return redirect("/")


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

    _sync_thread = threading.Thread(
        target=fetch.sync, kwargs={"force_streams": force_streams}, daemon=True
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
        activities = fetch.load_activities()
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

    if not client_id or not client_secret:
        return jsonify({"error": "client_id and client_secret are required"}), 400

    try:
        creds_store.save(client_id, client_secret, osm_user_agent)
        auth.clear_token()
        fetch.clear_cache()
    except OSError as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"ok": True})


@app.route("/api/setup/osm-email", methods=["POST"])
def api_setup_osm_email():
    body = request.get_json(silent=True) or {}
    osm_user_agent = (body.get("osm_user_agent") or "").strip()
    client_id, client_secret, _ = creds_store.load()
    if not client_id or not client_secret:
        return jsonify({"error": "No credentials found"}), 400
    try:
        creds_store.save(client_id, client_secret, osm_user_agent)
    except OSError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True})


@app.route("/api/setup/clear", methods=["POST"])
def api_setup_clear():
    creds_store.clear()
    auth.clear_token()
    fetch.clear_cache()
    return jsonify({"ok": True})


@app.route("/api/status")
def api_status():
    client_id, _, osm_ua = creds_store.load()
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
        "client_id": client_id or "",   # safe to expose — it's a public app identifier
        "osm_user_agent": osm_ua or "",
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
    if not new_name:
        return jsonify({"error": "name is required"}), 400
    try:
        actual_name = fetch.update_activity_name(activity_id, new_name)
        return jsonify({"name": actual_name})
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except (RuntimeError, OSError) as e:
        return jsonify({"error": str(e)}), 500


# ── Static files ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


if __name__ == "__main__":
    print("Starting strava2earth at http://localhost:5001")
    app.run(debug=True, port=5001)
