# strava2earth — Android App

A standalone Android app that pulls your Strava activities and renders every GPS route on an interactive map. No server required — all logic runs on the device.

## Features

- **Interactive map** — all GPS routes rendered as colored polylines; sport type is colour-coded (Run = red, Ride = blue, Hike = green, Ski = purple, …)
- **Base map selector** — switch between Street (OSM), Satellite (Esri), Terrain (Esri Topo), and Dark (CartoDB) from the Settings panel; persists across sessions
- **Select & isolate** — tap any route in the Activities list to fly the camera to it; all other routes are hidden and the selected route is highlighted with a white glow
- **Activities panel** — searchable, newest-first list with sport type color dot; swipe down the handle bar to close
- **Filters** — sport type, date range (from/to), country, and city; city list is scoped to the selected country
- **Activity details** — distance, moving time, elapsed time, elevation gain, avg/max heart rate, city/country; elevation profile chart; inline rename; sport type reassignment
- **AI coach** — chat panel backed by DeepSeek V4 Flash or V4 Pro; your recent activity stats are included as context; conversation persists between sessions
- **Sync** — downloads Strava activity list and GPS streams in the background with a live progress bar; resumes where it left off; routes appear immediately from summary polylines before full stream data arrives
- **Four UI themes** — Default (dark navy), Cyberpunk (neon), Classical (gold), Alp (forest green)
- **Encrypted secrets** — Strava client secret and DeepSeek API key stored in Android Keystore via `react-native-encrypted-storage`; never stored in plain text

## Tech stack

| Layer        | Tool                                                          |
| ------------ | ------------------------------------------------------------- |
| Framework    | React Native 0.85 · TypeScript                                |
| Map          | MapLibre React Native v11                                     |
| Tiles        | OSM · Esri World Imagery · Esri World Topo · CartoDB Dark     |
| State        | Zustand                                                       |
| Storage      | `react-native-fs` (cache) · `react-native-encrypted-storage` |
| OAuth        | Chrome Custom Tabs via `react-native-inappbrowser-reborn`     |
| Geocoding    | Nominatim (OSM) — free, no key needed                         |
| AI coach     | DeepSeek API (optional)                                       |
| Charts       | `react-native-chart-kit`                                      |

## Setup

### 1. Create a Strava API app

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Create an app (any name / website)
3. Set **Authorization Callback Domain** to `auth`
4. Note your **Client ID** and **Client Secret**

### 2. Build and install

Prerequisites: Android SDK, Java 17+, Node 18+, a connected Android device or emulator.

```bash
# Install JS dependencies
cd android
npm install

# Start Metro bundler (terminal 1)
npx react-native start --port 8081

# Build and install debug APK (terminal 2)
JAVA_HOME=/path/to/jdk npx react-native run-android

# On a physical device, forward the Metro port
adb reverse tcp:8081 tcp:8081
```

### 3. First-time setup in the app

1. Open the app — you will see the Setup screen
2. Enter your **Strava Client ID**, **Client Secret**, an **OSM contact email** (for Nominatim), and an optional **DeepSeek API key**
3. Tap **Connect with Strava** — a Chrome Custom Tab opens for OAuth; after authorising, the tab closes automatically
4. Tap **Sync** on the map screen to download your activity list and GPS streams

Routes from `summary_polyline` appear on the map immediately. Full GPS stream data (elevation, heart rate) downloads in the background.

## Privacy

All data is stored locally on the device:

- **Strava API** — activity list, GPS streams, and name/type edits
- **Map tile providers** — OSM, Esri, or CartoDB depending on the selected base map
- **Nominatim (OSM)** — reverse-geocodes the start coordinate of each activity to determine city and country; rate-limited to 1 request/second
- **DeepSeek API** _(only if a key is configured)_ — activity summaries (names, dates, distances, heart rate) are sent to DeepSeek for AI coaching responses

Credentials are stored in Android Keystore. Tapping **Delete credentials & cache** wipes everything.

## Project layout

```
android/
├── src/
│   ├── App.tsx                   # Root navigator, startup auth restore
│   ├── screens/
│   │   ├── LoginScreen.tsx       # Credential setup + Strava OAuth
│   │   ├── MainScreen.tsx        # Map + bottom sheet (Activities / Coach / Settings)
│   │   ├── ActivityDetailScreen.tsx
│   │   └── ChatScreen.tsx        # Standalone chat (unused in main nav)
│   ├── services/
│   │   ├── secureStorage.ts      # Android Keystore wrapper
│   │   ├── stravaAuth.ts         # OAuth flow, token refresh
│   │   ├── stravaApi.ts          # Strava REST API calls
│   │   ├── cacheManager.ts       # Activity + stream cache, sync, GeoJSON queries
│   │   ├── geocoding.ts          # Nominatim reverse geocode
│   │   └── deepseek.ts           # DeepSeek chat API
│   ├── stores/
│   │   └── appStore.ts           # Zustand: auth, sync state, theme, base map
│   └── components/
│       ├── ThemeProvider.tsx
│       ├── ElevationChart.tsx
│       ├── ActivityCard.tsx
│       └── SyncProgress.tsx
└── android/                      # Native Android Gradle project
```
