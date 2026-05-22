const STRAVA_BASE = 'https://www.strava.com/api/v3';

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export interface RawActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed: number;
  max_speed: number;
  start_latlng: [number, number] | null;
  map?: { summary_polyline?: string };
}

export interface RawStream {
  latlng?: { data: [number, number][] };
  altitude?: { data: number[] };
  distance?: { data: number[] };
  heartrate?: { data: number[] };
  velocity_smooth?: { data: number[] };
}

export async function fetchAllActivities(token: string): Promise<RawActivity[]> {
  const all: RawActivity[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${STRAVA_BASE}/athlete/activities?per_page=200&page=${page}`,
      { headers: headers(token) },
    );
    if (!res.ok) throw new Error(`Strava activities fetch failed: ${res.status}`);
    const batch: RawActivity[] = await res.json();
    if (batch.length === 0) break;
    all.push(...batch);
    page++;
  }
  return all;
}

export async function fetchStream(token: string, activityId: number): Promise<RawStream | null> {
  const res = await fetch(
    `${STRAVA_BASE}/activities/${activityId}/streams?keys=latlng,altitude,distance,heartrate,velocity_smooth&key_by_type=true`,
    { headers: headers(token) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Stream fetch failed: ${res.status}`);
  return res.json();
}

export async function updateActivity(
  token: string,
  activityId: number,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRAVA_BASE}/activities/${activityId}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (res.status === 403) throw new Error('Permission denied: cannot edit this activity');
  if (!res.ok) throw new Error(`Update activity failed: ${res.status}`);
  return res.json();
}
