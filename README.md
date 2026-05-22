# strava2earth

A self-hosted tool that pulls your Strava activities and displays every GPS route on an interactive map. Available as a **web app** (Flask + Leaflet) and a **standalone Android app** (React Native + MapLibre). No third-party accounts or cloud services required beyond your own Strava API credentials.

![Map view showing activity routes on OpenStreetMap](https://raw.githubusercontent.com/nonmean/strava2earth/main/docs/screenshot.png)

---

## Clients

| Client  | Stack                             | Details              |
| ------- | --------------------------------- | -------------------- |
| Web     | Flask · Leaflet.js · vanilla JS   | [Web setup](#web)    |
| Android | React Native · MapLibre · Zustand | [Android setup](#android) |

Both clients share the same Strava API credentials and feature set. The Android app runs entirely on-device — no server is required.

---

## Features

### Shared

- **Interactive map** — every GPS route rendered as a colour-coded polyline (Run = red, Ride = blue, Hike = green, Ski = purple, …)
- **Multiple base maps** — switch between Street (OSM), Satellite (Esri), Terrain (Esri Topo), and Dark (CartoDB); no API key needed
- **Filters** — date range, sport type, country, and city; city list is scoped to the selected country
- **Select & isolate** — tap or click a route to zoom in and hide all other routes; the selected route is highlighted; deselect to restore all
- **Activity details** — distance, moving time, elapsed time, elevation gain, avg/max heart rate, city, country; elevation profile chart
- **Rename activities** — edit the activity name and push the change back to Strava
- **Change activity type** — reassign sport type (Run, Ride, Hike, …) and sync to Strava; map colour updates immediately
- **Four UI themes** — Default (dark navy), Cyberpunk (neon), Classical (antique gold), Alp (forest green)
- **AI coach** — optional DeepSeek chat assistant with access to your training history and HR zones; choose between V4 Flash and V4 Pro models
- **Background sync** — live progress bar; safe to interrupt; resumes where it left off
- **Geocoding** — Nominatim reverse-geocodes activity start points to city and country; rate-limited to 1 req/s

### Web only

- **Draggable panels** — stats panel and elevation chart can be repositioned anywhere on the map
- **Sync New / Sync All** — _Sync New_ skips already-cached streams; _Sync All_ forces a full re-download
- **Fernet-encrypted credentials** — Strava keys stored with AES-128 encryption on disk

### Android only

- **Standalone** — no server required; all logic runs on-device
- **Summary polylines** — routes appear on the map immediately from Strava's encoded summary polyline, before full GPS stream data downloads
- **Android Keystore encryption** — secrets stored via `react-native-encrypted-storage` (hardware-backed on supported devices)
- **Swipe-to-close panels** — swipe down the handle bar to dismiss the Activities / Coach / Settings sheet
- **Strava OAuth via Chrome Custom Tab** — uses Android deep-link `strava2earth://auth/callback`; no WebView

---

## Tech stack

### Web

| Layer      | Tool                                                            |
| ---------- | --------------------------------------------------------------- |
| Backend    | Python · Flask                                                  |
| Map        | Leaflet.js · OSM / OpenTopoMap / CartoDB / Esri tiles           |
| Charts     | Chart.js                                                        |
| Geocoding  | Nominatim (OSM)                                                 |
| Encryption | `cryptography` (Fernet / AES-128-CBC + HMAC-SHA256)             |
| Auth       | Strava OAuth 2.0                                                |
| AI coach   | DeepSeek API (optional)                                         |

### Android

| Layer        | Tool                                                          |
| ------------ | ------------------------------------------------------------- |
| Framework    | React Native 0.85 · TypeScript                                |
| Map          | MapLibre React Native v11                                     |
| Tiles        | OSM · Esri World Imagery · Esri World Topo · CartoDB Dark     |
| State        | Zustand                                                       |
| Storage      | `react-native-fs` (cache) · `react-native-encrypted-storage` |
| OAuth        | Chrome Custom Tabs via `react-native-inappbrowser-reborn`     |
| Geocoding    | Nominatim (OSM)                                               |
| AI coach     | DeepSeek API (optional)                                       |
| Charts       | `react-native-chart-kit`                                      |

---

## Setup

### Strava API app (required for both clients)

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an app (any name / website)
3. Set **Authorization Callback Domain**:
   - Web: `localhost`
   - Android: `auth`
4. Note your **Client ID** and **Client Secret**

---

<a name="web"></a>
### Web

#### Install

```bash
pip install -r web/requirements.txt
```

#### Run

```bash
python web/run.py
```

Open [http://localhost:5001](http://localhost:5001).

#### First-time flow

1. **Setup** — enter Strava Client ID, Secret, optional Nominatim contact email, and optional DeepSeek API key
2. **Connect** — click _Connect with Strava_ to complete OAuth
3. **Sync** — click _Sync New_ to fetch activities; _Sync All_ to force full re-download
4. **Explore** — use filters and the sidebar to navigate your routes

---

<a name="android"></a>
### Android

#### Prerequisites

- Android SDK + platform-tools
- Java 17+
- Node 18+
- A connected Android device or emulator

#### Build and install

```bash
cd android
npm install

# Terminal 1 — Metro bundler
npx react-native start --port 8081

# Terminal 2 — build and install
JAVA_HOME=/path/to/jdk npx react-native run-android

# Physical device — forward Metro port
adb reverse tcp:8081 tcp:8081
```

#### First-time flow in the app

1. Open the app — you will see the credential setup screen
2. Enter **Strava Client ID**, **Client Secret**, optional **OSM contact email**, and optional **DeepSeek API key**
3. Tap **Connect with Strava** — a Chrome Custom Tab opens; after authorising, the tab closes and you land on the map
4. Tap **Sync** to download your activity list and GPS streams

Routes appear immediately from summary polylines. Full GPS data (elevation, heart rate) downloads in the background.

---

## Project layout

```
strava2earth/
├── shared/                       # Pure Python business logic
│   ├── config.py                 # Paths, constants, sport colours
│   ├── credentials.py            # Fernet-encrypted credential storage
│   ├── strava_client.py          # Outbound Strava API calls
│   ├── cache_manager.py          # Activity cache, sync, GeoJSON queries
│   └── geocoding.py              # Nominatim reverse geocode
├── web/                          # Flask web app
│   ├── app.py                    # API routes
│   ├── auth.py                   # OAuth token management
│   ├── run.py                    # Launch script
│   ├── requirements.txt
│   └── static/
│       └── index.html            # Single-file frontend (Leaflet + JS)
├── android/                      # React Native Android app
│   ├── src/
│   │   ├── App.tsx               # Root navigator, startup auth restore
│   │   ├── screens/
│   │   │   ├── LoginScreen.tsx   # Credential setup + Strava OAuth
│   │   │   ├── MainScreen.tsx    # Map + bottom sheet (Activities / Coach / Settings)
│   │   │   └── ActivityDetailScreen.tsx
│   │   ├── services/
│   │   │   ├── secureStorage.ts  # Android Keystore wrapper
│   │   │   ├── stravaAuth.ts     # OAuth flow, token refresh
│   │   │   ├── stravaApi.ts      # Strava REST API
│   │   │   ├── cacheManager.ts   # Cache, sync, GeoJSON queries
│   │   │   ├── geocoding.ts      # Nominatim
│   │   │   └── deepseek.ts       # DeepSeek chat API
│   │   ├── stores/
│   │   │   └── appStore.ts       # Zustand: auth, sync, theme, base map
│   │   └── components/
│   └── android/                  # Native Gradle project
├── cache/                        # Runtime data — gitignored
│   ├── .key
│   ├── credentials.enc
│   ├── token.json
│   ├── activities.json
│   └── streams/
└── pyproject.toml
```

---

## Privacy

All activity data stays local. Outbound connections:

| Destination | Purpose | Both clients |
| ----------- | ------- | ------------ |
| Strava API | Fetch activities, push edits | ✓ |
| Map tile provider | Render base map (OSM / Esri / CartoDB) | ✓ |
| Nominatim (OSM) | Reverse-geocode activity start points | ✓ |
| DeepSeek API | AI coach responses — only if a key is configured | ✓ |

When the AI coach is active, activity summaries (names, dates, distances, heart rate) are sent to DeepSeek. If you do not enter a DeepSeek key, no data is sent to any AI service.

**Web:** credentials are Fernet-encrypted on disk; deleting `cache/` removes everything.  
**Android:** secrets live in Android Keystore; tap _Delete credentials & cache_ in Settings to wipe everything.

---

## Rate limits

Strava: 100 requests per 15 minutes, 1 000 per day. The sync sleeps 0.5 s between stream fetches and skips already-cached activities.  
Nominatim: the sync enforces a 1 req/s delay to comply with OSM usage policy.

---

## License

MIT
