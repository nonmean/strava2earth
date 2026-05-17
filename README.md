# strava2earth

A self-hosted web app that pulls your Strava activities and displays every GPS route on an interactive map. Filter by date range, country, city, and activity type. Click any route or sidebar item to zoom in and inspect details.

![Map view showing activity routes on OpenStreetMap](https://raw.githubusercontent.com/nonmean/strava2earth/main/docs/screenshot.png)

## Features

- **Interactive map** — all your GPS routes rendered on a choice of background maps (no API key, no cost)
- **Multiple background maps** — switch between OpenStreetMap, Topographic (with isoheight contour lines), CartoDB Dark, and Esri Satellite via the bottom-left control
- **Activity sidebar** — scrollable list sorted newest-first with search, synced to map selection
- **Filters** — date range, country, city, and activity type dropdowns; results update immediately; type filter hides non-matching routes on the map in real time
- **Click to focus** — click a sidebar item or a route to zoom the map and isolate that single activity; all other routes are hidden; click again to show all
- **Draggable stats panel** — activity details (distance, avg speed, pace, moving time, elevation gain, heart rate) float in a panel you can drag anywhere on the map
- **Rename activities** — click ✏ next to the activity name in the stats panel to edit it and push the change back to Strava
- **Change activity type** — click ✏ next to the sport type in the stats panel to reassign the type (Run, Ride, Hike, etc.) and sync the change to Strava; the map color and filters update instantly
- **Elevation profile** — Chart.js panel shows elevation vs. distance for the selected activity; drag it anywhere on the map
- **UI themes** — switch between four visual styles from the header: General (dark navy), Cyberpunk (neon cyan/magenta), Classical (antique gold serif), and Alp (alpine forest green)
- **AI coach** — optional DeepSeek integration; when a DeepSeek API key is configured, a chat panel appears with a coaching assistant that has access to your training history, HR zones, and recent activity data (see Privacy below)
- **Sync New / Sync All** — _Sync New_ fetches the latest activity list and downloads only missing GPS streams; _Sync All_ forces a full re-download of every stream from Strava
- **Encrypted credentials** — Strava API keys stored with Fernet AES encryption, never readable as plain text
- **Local cache** — GPS streams cached to `cache/streams/` so Strava's rate limits are respected; sync resumes where it left off
- **Background sync** — live progress bar while activities download; safe to interrupt and restart

## Tech stack

| Layer      | Tool                                                            |
| ---------- | --------------------------------------------------------------- |
| Backend    | Python · Flask                                                  |
| Map        | Leaflet.js · OpenStreetMap / OpenTopoMap / CartoDB / Esri tiles |
| Charts     | Chart.js                                                        |
| Geocoding  | Nominatim (OSM) — free, no key needed                           |
| Encryption | `cryptography` (Fernet / AES-128-CBC + HMAC-SHA256)             |
| Auth       | Strava OAuth 2.0                                                |
| AI coach   | DeepSeek API (optional)                                         |

## Setup

### 1. Create a Strava API app

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an app (any name/website)
3. Set **Authorization Callback Domain** to `localhost`
4. Note your **Client ID** and **Client Secret**

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Run

```bash
python app.py
```

Open [http://localhost:5001](http://localhost:5001).

### 4. First-time flow

1. **Setup** — enter your Strava Client ID, Secret, an optional Nominatim contact email, and an optional DeepSeek API key (all stored encrypted on disk)
2. **Connect** — click _Connect with Strava_ to authorize via OAuth; you can also set or update the contact email from this page
3. **Sync** — click _Sync New_ to fetch your activity list and download GPS streams; use _Sync All_ to force a full re-download
4. **Explore** — use the date / country / city / type filters and the sidebar to navigate your routes

Sync runs in the background. You can start browsing cached activities immediately while the rest download.

## Project layout

```
strava2earth/
├── app.py            # Flask server, API routes
├── auth.py           # Strava OAuth token management
├── credentials.py    # Fernet-encrypted credential storage
├── fetch.py          # Strava API client + local cache
├── config.py         # Paths, constants, sport color mapping
├── static/
│   └── index.html    # Single-file frontend (Leaflet + vanilla JS)
├── cache/            # Runtime data — gitignored
│   ├── .key          # Fernet encryption key (auto-generated)
│   ├── credentials.enc
│   ├── token.json
│   ├── activities.json
│   ├── memory_context.json  # AI coach conversation history
│   └── streams/      # One JSON file per activity
└── requirements.txt
```

## Cache and privacy

All activity data stays local. The only outbound connections are:

- **Strava API** — to fetch your activities and push name/type edits
- **Map tile providers** — OpenStreetMap, OpenTopoMap, CartoDB, or Esri depending on your background map choice
- **Nominatim (OSM)** — reverse-geocoding the start point of each activity to determine city and country
- **DeepSeek API** _(only if a key is configured)_ — when the AI coach is active, activity summaries including names, dates, distances, heart rate data, and training load scores are sent to DeepSeek's API for analysis. This data leaves your machine. If you do not enter a DeepSeek key, no data is sent to any AI service.

The encryption key (`cache/.key`) and encrypted credentials (`cache/credentials.enc`) are generated locally on first setup. Without the key file, the credentials file cannot be decrypted.

Clicking **Delete credential** or saving new credentials wipes the OAuth token and all cached activity data (`activities.json` and `streams/`). A fresh sync is required after reconnecting.

## Rate limits

Strava allows 100 requests per 15 minutes and 1 000 per day. The sync sleeps 0.5 s between stream fetches and skips activities that are already cached, so large accounts sync cleanly over multiple sessions.

## License

MIT
