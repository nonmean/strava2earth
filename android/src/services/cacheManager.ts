import RNFS from 'react-native-fs';
import { fetchAllActivities, fetchStream, updateActivity } from './stravaApi';
import { reverseGeocode } from './geocoding';
import { loadCredentials } from './secureStorage';
import type { RawActivity, RawStream } from './stravaApi';
import type { GeoJSON, GeoFeature, RouteProperties, Stream, RouteParams, ActivityStat } from './types';

const DOCS = RNFS.DocumentDirectoryPath;
const ACTIVITIES_FILE = `${DOCS}/activities.json`;
const STREAMS_DIR = `${DOCS}/streams`;
const MEMORY_FILE = `${DOCS}/memory.json`;
const ACTIVITIES_TTL_MS = 60 * 60 * 1000; // 1 hour

const SPORT_COLORS: Record<string, string> = {
  Run: '#e74c3c',
  TrailRun: '#c0392b',
  Ride: '#3498db',
  MountainBikeRide: '#2980b9',
  GravelRide: '#1abc9c',
  Swim: '#00bcd4',
  Walk: '#2ecc71',
  Hike: '#27ae60',
  AlpineSki: '#9b59b6',
  NordicSki: '#8e44ad',
  Kayaking: '#16a085',
  Rowing: '#0e6655',
  Workout: '#f39c12',
  VirtualRide: '#7f8c8d',
  VirtualRun: '#95a5a6',
};
const DEFAULT_COLOR = '#7f8c8d';

export function sportColor(sport: string): string {
  return SPORT_COLORS[sport] ?? DEFAULT_COLOR;
}

// ── Sync state (module-level mirror; Zustand store is source of truth in UI) ──
let _syncRunning = false;

export interface SyncStatus {
  running: boolean;
  total: number;
  done: number;
  errors: number;
  last_error: string;
}

let _syncState: SyncStatus = { running: false, total: 0, done: 0, errors: 0, last_error: '' };
let _syncListeners: ((s: SyncStatus) => void)[] = [];

function _updateSync(patch: Partial<SyncStatus>) {
  _syncState = { ..._syncState, ...patch };
  _syncListeners.forEach(fn => fn({ ..._syncState }));
}

export function onSyncUpdate(fn: (s: SyncStatus) => void): () => void {
  _syncListeners.push(fn);
  return () => { _syncListeners = _syncListeners.filter(f => f !== fn); };
}

export function syncStatus(): SyncStatus {
  return { ..._syncState };
}

export function tryStartSync(): boolean {
  if (_syncRunning) return false;
  _syncRunning = true;
  _updateSync({ running: true, errors: 0, last_error: '' });
  return true;
}

export function resetSync() {
  _syncRunning = false;
  _updateSync({ running: false });
}

// ── File helpers ─────────────────────────────────────────────────────────────

async function ensureStreamsDir() {
  const exists = await RNFS.exists(STREAMS_DIR);
  if (!exists) await RNFS.mkdir(STREAMS_DIR);
}

function streamPath(id: number) {
  return `${STREAMS_DIR}/${id}.json`;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const exists = await RNFS.exists(path);
    if (!exists) return null;
    const text = await RNFS.readFile(path, 'utf8');
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, data: unknown) {
  await RNFS.writeFile(path, JSON.stringify(data), 'utf8');
}

// ── Activity list ─────────────────────────────────────────────────────────────

interface SlimActivity {
  id: number;
  athlete_id: number;
  name: string;
  sport_type: string;
  start_date: string;
  start_latlng: [number, number] | null;
  summary_polyline?: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
  average_watts?: number;
  pr_count: number;
  location_country: string;
  location_city: string;
}

function decodePoly(encoded: string): [number, number][] {
  const result: [number, number][] = [];
  let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b: number, shift = 0, val = 0;
    do { b = encoded.charCodeAt(idx++) - 63; val |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += val & 1 ? ~(val >> 1) : val >> 1;
    shift = 0; val = 0;
    do { b = encoded.charCodeAt(idx++) - 63; val |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += val & 1 ? ~(val >> 1) : val >> 1;
    result.push([lat / 1e5, lng / 1e5]);
  }
  return result;
}

async function activitiesStale(): Promise<boolean> {
  try {
    const stat = await RNFS.stat(ACTIVITIES_FILE);
    const age = Date.now() - new Date(stat.mtime).getTime();
    return age > ACTIVITIES_TTL_MS;
  } catch {
    return true;
  }
}

export async function loadActivities(
  token: string,
  athleteId: number,
  force = false,
): Promise<SlimActivity[]> {
  if (!force && !(await activitiesStale())) {
    const cached = await readJson<SlimActivity[]>(ACTIVITIES_FILE);
    if (cached) return cached;
  }

  const raw = await fetchAllActivities(token);
  const slim: SlimActivity[] = raw.map((a: RawActivity) => ({
    id: a.id,
    athlete_id: athleteId,
    name: a.name ?? '',
    sport_type: a.sport_type ?? 'Other',
    start_date: a.start_date ?? '',
    start_latlng: a.start_latlng,
    summary_polyline: a.map?.summary_polyline || undefined,
    distance: a.distance ?? 0,
    elapsed_time: a.elapsed_time ?? 0,
    moving_time: a.moving_time ?? 0,
    total_elevation_gain: a.total_elevation_gain,
    average_speed: a.average_speed,
    max_speed: a.max_speed,
    average_heartrate: a.average_heartrate,
    max_heartrate: a.max_heartrate,
    pr_count: 0,
    location_country: '',
    location_city: '',
  }));

  await writeJson(ACTIVITIES_FILE, slim);
  return slim;
}

// ── GPS streams ───────────────────────────────────────────────────────────────

interface CachedStream {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  total_elevation_gain?: number;
  average_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  pr_count: number;
  hr_zones?: Record<string, number>;
  avg_speed_kmh?: number;
  location_country: string;
  location_city: string;
  latlng: [number, number][];
  altitude: number[];
  distance_stream: number[];
}

function downsample<T>(arr: T[], maxPoints = 500): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, i) => arr[Math.floor(i * step)]);
}

function computeHrZones(
  heartrate: number[],
  maxHr?: number,
): Record<string, number> | undefined {
  if (!heartrate.length) return undefined;
  const effective = maxHr || Math.max(...heartrate);
  if (!effective) return undefined;
  const thresholds = [0.60, 0.70, 0.80, 0.90, 1.01];
  const counts = [0, 0, 0, 0, 0];
  for (const hr of heartrate) {
    const pct = hr / effective;
    for (let i = 0; i < thresholds.length; i++) {
      if (pct <= thresholds[i]) { counts[i]++; break; }
    }
  }
  const total = heartrate.length;
  return Object.fromEntries(counts.map((c, i) => [`z${i + 1}`, Math.round(c / total * 100)]));
}

async function streamCached(id: number): Promise<boolean> {
  try {
    const data = await readJson<CachedStream>(streamPath(id));
    return !!(data?.latlng?.length);
  } catch {
    return false;
  }
}

async function fetchStreamForActivity(
  token: string,
  activity: SlimActivity,
  osmUserAgent: string,
): Promise<boolean> {
  const aid = activity.id;
  if (await streamCached(aid)) return false;
  if (!activity.start_latlng) return false;

  const raw: RawStream | null = await fetchStream(token, aid);
  if (!raw?.latlng?.data?.length) return false;

  const latlng = downsample(raw.latlng.data);
  const altitude = raw.altitude?.data ? downsample(raw.altitude.data) : [];
  const distance = raw.distance?.data ? downsample(raw.distance.data) : [];
  const hrData = raw.heartrate?.data ?? [];
  const velData = raw.velocity_smooth?.data ?? [];

  const hrZones = computeHrZones(hrData, activity.max_heartrate);
  const avgSpeedKmh = velData.length
    ? Math.round((velData.reduce((a, b) => a + b, 0) / velData.length) * 3.6 * 100) / 100
    : undefined;

  let country = activity.location_country;
  let city = activity.location_city;
  if ((!country || !city) && latlng.length) {
    const [lat, lng] = latlng[0];
    const [gc, gco] = await reverseGeocode(lat, lng, osmUserAgent);
    if (!city && gc) city = gc;
    if (!country && gco) country = gco;
  }

  const stream: CachedStream = {
    id: aid,
    name: activity.name,
    sport_type: activity.sport_type,
    start_date: activity.start_date,
    distance: activity.distance,
    elapsed_time: activity.elapsed_time,
    moving_time: activity.moving_time,
    total_elevation_gain: activity.total_elevation_gain,
    average_speed: activity.average_speed,
    average_heartrate: activity.average_heartrate,
    max_heartrate: activity.max_heartrate,
    pr_count: activity.pr_count,
    hr_zones: hrZones,
    avg_speed_kmh: avgSpeedKmh,
    location_country: country,
    location_city: city,
    latlng,
    altitude,
    distance_stream: distance,
  };

  await ensureStreamsDir();
  await writeJson(streamPath(aid), stream);
  _invalidateRouteCache();
  return true;
}

// ── Sync ──────────────────────────────────────────────────────────────────────

export async function sync(
  token: string,
  athleteId: number,
  forceStreams = false,
): Promise<void> {
  const creds = await loadCredentials();
  const osmUserAgent = creds?.osm_user_agent
    ? `strava2earth/1.0 (${creds.osm_user_agent})`
    : 'strava2earth/1.0';

  try {
    const activities = await loadActivities(token, athleteId, true);
    const gpsActivities = activities.filter(a => a.start_latlng);

    await ensureStreamsDir();
    const streamFiles = await RNFS.readDir(STREAMS_DIR);
    const cachedIds = new Set(streamFiles.map(f => parseInt(f.name.replace('.json', ''), 10)));

    const initialDone = forceStreams ? 0 : gpsActivities.filter(a => cachedIds.has(a.id)).length;
    _updateSync({ total: gpsActivities.length, done: initialDone });

    if (forceStreams) {
      for (const f of streamFiles) await RNFS.unlink(f.path);
      _invalidateRouteCache();
    }

    for (const activity of gpsActivities) {
      if (!forceStreams && cachedIds.has(activity.id)) continue;

      try {
        await fetchStreamForActivity(token, activity, osmUserAgent);
        _updateSync({ done: _syncState.done + 1 });
      } catch (e: any) {
        _updateSync({ errors: _syncState.errors + 1, last_error: e.message ?? 'Unknown error' });
        if (e.message?.includes('429')) {
          _updateSync({ last_error: 'Strava rate limit exceeded. Try again later.' });
          return;
        }
      }

      await new Promise<void>(r => setTimeout(r, 500));
    }

    await backfillCitiesNominatim(osmUserAgent);
  } finally {
    _syncRunning = false;
    _updateSync({ running: false });
  }
}

async function backfillCitiesNominatim(osmUserAgent: string) {
  let files: RNFS.ReadDirItem[];
  try {
    files = await RNFS.readDir(STREAMS_DIR);
  } catch { return; }

  for (const f of files) {
    const data = await readJson<CachedStream>(f.path);
    if (!data?.latlng?.length) continue;
    if ((data.location_city ?? '').trim()) continue;

    const [lat, lng] = data.latlng[0];
    const [gc, gco] = await reverseGeocode(lat, lng, osmUserAgent);
    await new Promise<void>(r => setTimeout(r, 1100));
    if (!gc && !gco) continue;

    if (gc) data.location_city = gc;
    if (!data.location_country && gco) data.location_country = gco;
    await writeJson(f.path, data);
  }
}

// ── In-memory route cache ─────────────────────────────────────────────────────

let _routeData: CachedStream[] = [];
let _routeDataMtime = 0;

function _invalidateRouteCache() {
  _routeDataMtime = 0;
}

async function loadRouteData(): Promise<CachedStream[]> {
  let files: RNFS.ReadDirItem[];
  try {
    files = await RNFS.readDir(STREAMS_DIR);
  } catch {
    return [];
  }

  if (!files.length) return [];

  const maxMtime = Math.max(...files.map(f => new Date(f.mtime ?? 0).getTime()));
  if (maxMtime <= _routeDataMtime && _routeData.length) return _routeData;

  const data: CachedStream[] = [];
  for (const f of files) {
    const stream = await readJson<CachedStream>(f.path);
    if (stream?.latlng?.length) data.push(stream);
  }

  _routeData = data;
  _routeDataMtime = maxMtime;
  return _routeData;
}

// ── Query API ─────────────────────────────────────────────────────────────────

export async function getRoutes(filters: RouteParams = {}): Promise<GeoJSON> {
  const streams = await loadRouteData();
  const syncedIds = new Set(streams.map(s => s.id));
  const features: GeoFeature[] = [];

  // ── Activities with full GPS streams ────────────────────────────────────────
  for (const s of streams) {
    const startDate = (s.start_date ?? '').slice(0, 10);
    if (filters.from && startDate < filters.from) continue;
    if (filters.to && startDate > filters.to) continue;
    if (filters.sport_type && s.sport_type !== filters.sport_type) continue;

    const country = (s.location_country ?? '').trim();
    if (filters.country && !country.toLowerCase().includes(filters.country.toLowerCase())) continue;

    const city = (s.location_city ?? '').trim();
    if (filters.city && !city.toLowerCase().includes(filters.city.toLowerCase())) continue;

    const coords: [number, number][] = s.latlng.map(([lat, lng]) => [lng, lat]);
    const color = sportColor(s.sport_type);

    const props: RouteProperties = {
      id: s.id,
      name: s.name,
      sport_type: s.sport_type,
      start_date: s.start_date,
      distance_km: Math.round(s.distance / 1000 * 100) / 100,
      elapsed_time: s.elapsed_time,
      moving_time: s.moving_time,
      total_elevation_gain: s.total_elevation_gain,
      average_speed: s.average_speed,
      average_heartrate: s.average_heartrate,
      max_heartrate: s.max_heartrate,
      country,
      city,
      color,
    };

    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: props,
    });
  }

  // ── Fallback: activities without streams, use summary polyline ───────────────
  const activities = await readJson<SlimActivity[]>(ACTIVITIES_FILE);
  if (activities) {
    for (const a of activities) {
      if (syncedIds.has(a.id)) continue;
      if (!a.summary_polyline) continue;

      const startDate = (a.start_date ?? '').slice(0, 10);
      if (filters.from && startDate < filters.from) continue;
      if (filters.to && startDate > filters.to) continue;
      if (filters.sport_type && a.sport_type !== filters.sport_type) continue;
      if (filters.country || filters.city) continue;

      const latlng = decodePoly(a.summary_polyline);
      if (latlng.length < 2) continue;

      const coords: [number, number][] = latlng.map(([lat, lng]) => [lng, lat]);
      const color = sportColor(a.sport_type);

      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {
          id: a.id,
          name: a.name,
          sport_type: a.sport_type,
          start_date: a.start_date,
          distance_km: Math.round(a.distance / 1000 * 100) / 100,
          elapsed_time: a.elapsed_time,
          moving_time: a.moving_time,
          total_elevation_gain: a.total_elevation_gain,
          average_speed: a.average_speed,
          average_heartrate: a.average_heartrate,
          max_heartrate: undefined,
          country: '',
          city: '',
          color,
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

export async function getCountries(): Promise<string[]> {
  const streams = await loadRouteData();
  const set = new Set(streams.map(s => (s.location_country ?? '').trim()).filter(Boolean));
  return [...set].sort();
}

export async function getCities(country?: string): Promise<string[]> {
  const streams = await loadRouteData();
  const set = new Set(
    streams
      .filter(s => !country || (s.location_country ?? '').toLowerCase().includes(country.toLowerCase()))
      .map(s => (s.location_city ?? '').trim())
      .filter(Boolean),
  );
  return [...set].sort();
}

export async function getStream(activityId: number): Promise<Stream | null> {
  const data = await readJson<CachedStream>(streamPath(activityId));
  if (!data) return null;
  return { altitude: data.altitude, distance_stream: data.distance_stream };
}

export async function getActivityStats(): Promise<ActivityStat[]> {
  let activities: SlimActivity[] = [];
  const cached = await readJson<SlimActivity[]>(ACTIVITIES_FILE);
  if (cached) activities = cached;
  else return [];

  const result: ActivityStat[] = [];
  for (const a of activities) {
    const extra = await readJson<CachedStream>(streamPath(a.id));
    result.push({
      id: a.id,
      name: a.name,
      sport_type: a.sport_type,
      start_date: a.start_date,
      distance: a.distance,
      elapsed_time: a.elapsed_time,
      moving_time: a.moving_time,
      total_elevation_gain: a.total_elevation_gain,
      average_heartrate: a.average_heartrate,
      distance_km: Math.round(a.distance / 1000 * 100) / 100,
      average_speed_kmh: a.average_speed ? Math.round(a.average_speed * 3.6 * 100) / 100 : undefined,
      max_heartrate: a.max_heartrate,
      pr_count: a.pr_count,
      hr_zones: extra?.hr_zones,
      location_city: a.location_city,
      location_country: a.location_country,
    });
  }
  return result;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function updateActivityName(
  token: string,
  activityId: number,
  newName: string,
): Promise<string> {
  const result = await updateActivity(token, activityId, { name: newName });
  const actualName = (result.name as string) ?? newName;

  const stream = await readJson<CachedStream>(streamPath(activityId));
  if (stream) {
    stream.name = actualName;
    await writeJson(streamPath(activityId), stream);
  }

  const activities = await readJson<SlimActivity[]>(ACTIVITIES_FILE);
  if (activities) {
    const a = activities.find(x => x.id === activityId);
    if (a) { a.name = actualName; await writeJson(ACTIVITIES_FILE, activities); }
  }

  _invalidateRouteCache();
  return actualName;
}

export async function updateActivitySportType(
  token: string,
  activityId: number,
  sportType: string,
): Promise<{ sport_type: string; color: string }> {
  const result = await updateActivity(token, activityId, { sport_type: sportType });
  const actualSportType = (result.sport_type as string) ?? sportType;
  const color = sportColor(actualSportType);

  const stream = await readJson<CachedStream>(streamPath(activityId));
  if (stream) {
    stream.sport_type = actualSportType;
    await writeJson(streamPath(activityId), stream);
  }

  const activities = await readJson<SlimActivity[]>(ACTIVITIES_FILE);
  if (activities) {
    const a = activities.find(x => x.id === activityId);
    if (a) { a.sport_type = actualSportType; await writeJson(ACTIVITIES_FILE, activities); }
  }

  _invalidateRouteCache();
  return { sport_type: actualSportType, color };
}

export async function clearCache(): Promise<void> {
  try { await RNFS.unlink(ACTIVITIES_FILE); } catch {}
  try {
    const files = await RNFS.readDir(STREAMS_DIR);
    await Promise.all(files.map(f => RNFS.unlink(f.path)));
  } catch {}
  _routeData = [];
  _routeDataMtime = 0;
}

export async function getSportTypes(): Promise<string[]> {
  const seen = new Set<string>();
  // Sport types from activities that have a GPS stream on disk
  const streams = await loadRouteData();
  for (const s of streams) { if (s.sport_type) seen.add(s.sport_type); }
  // Sport types from activities that have a summary polyline (shown as fallback routes)
  const activities = await readJson<SlimActivity[]>(ACTIVITIES_FILE);
  if (activities) {
    for (const a of activities) {
      if (a.summary_polyline && a.sport_type) seen.add(a.sport_type);
    }
  }
  return Array.from(seen).sort();
}

// ── Memory (AI coach) ─────────────────────────────────────────────────────────

export async function loadMemory(): Promise<Record<string, unknown>> {
  return (await readJson<Record<string, unknown>>(MEMORY_FILE)) ?? {};
}

export async function saveMemory(data: Record<string, unknown>): Promise<void> {
  await writeJson(MEMORY_FILE, data);
}
