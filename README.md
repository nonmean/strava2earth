# strava2earth

A self-hosted web app that pulls your Strava activities and displays every GPS route on an interactive map. Filter by date range, country, and city. Click any route or sidebar item to zoom in.

![Map view showing activity routes on OpenStreetMap](https://raw.githubusercontent.com/nonmean/strava2earth/main/docs/screenshot.png)

## Features

- **Interactive map** — all your GPS routes rendered on OpenStreetMap (no API key, no cost)
- **Activity sidebar** — scrollable list sorted newest-first with search, synced to map selection
- **Filters** — date range, country, and city dropdowns; results update immediately on change
- **Click to focus** — click a sidebar item or a route to zoom the map and open a popup with stats
- **Encrypted credentials** — Strava API keys stored with Fernet AES encryption, never readable as plain text
- **Local cache** — GPS streams cached to `cache/streams/` so Strava's rate limits are respected; sync resumes where it left off
- **Background sync** — live progress bar while activities download; safe to interrupt and restart

## Tech stack

| Layer | Tool |
|---|---|
| Backend | Python · Flask |
| Map | Leaflet.js · OpenStreetMap tiles |
| Geocoding | Nominatim (OSM) — free, no key needed |
| Encryption | `cryptography` (Fernet / AES-128-CBC + HMAC-SHA256) |
| Auth | Strava OAuth 2.0 |

## Setup

### 1. Create a Strava API app

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an app (any name/website)
3. Set **Authorization Callback Domain** to `localhost`
4. Note your **Client ID** and **Client Secret**

### 2. Install dependencies

```bash
pip install flask requests cryptography
```

### 3. Run

```bash
python app.py
```

Open [http://localhost:5001](http://localhost:5001).

### 4. First-time flow

1. **Setup** — enter your Strava Client ID and Secret (stored encrypted on disk)
2. **Connect** — click *Connect with Strava* to authorize via OAuth
3. **Sync** — click *Sync Strava* to download your activity list and GPS streams
4. **Explore** — use the date / country / city filters and the sidebar to navigate your routes

Sync runs in the background. You can start browsing cached activities immediately while the rest download.

## Project layout

```
strava2earth/
├── app.py            # Flask server, API routes
├── auth.py           # Strava OAuth token management
├── credentials.py    # Fernet-encrypted credential storage
├── fetch.py          # Strava API client + local cache
├── config.py         # Paths, constants, credential loader
├── static/
│   └── index.html    # Single-file frontend (Leaflet + vanilla JS)
├── cache/            # Runtime data — gitignored
│   ├── .key          # Fernet encryption key (auto-generated)
│   ├── credentials.enc
│   ├── token.json
│   ├── activities.json
│   └── streams/      # One JSON file per activity
├── requirements.txt
└── .env.example
```

## Cache and privacy

Everything stays local. No data is sent anywhere except to Strava's API and OpenStreetMap tile servers (for the map background). The `cache/` directory is gitignored.

The encryption key (`cache/.key`) and encrypted credentials (`cache/credentials.enc`) are generated locally on first setup. Without the key file, the credentials file cannot be decrypted.

## Rate limits

Strava allows 100 requests per 15 minutes and 1 000 per day. The sync sleeps 0.5 s between stream fetches and skips activities that are already cached, so large accounts sync cleanly over multiple sessions.

## License

MIT
