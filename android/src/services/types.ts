export interface AppStatus {
  configured: boolean;
  client_id: string;
  osm_user_agent: string;
  has_deepseek_key: boolean;
  authenticated: boolean;
  athlete_name: string;
  sync: SyncStatus;
}

export interface SyncStatus {
  running: boolean;
  total: number;
  done: number;
  errors: number;
  last_error: string;
}

export interface Activity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  location_city?: string;
  location_country?: string;
}

export interface ActivityStat extends Activity {
  distance_km: number;
  average_speed_kmh?: number;
  max_heartrate?: number;
  suffer_score?: number;
  average_watts?: number;
  pr_count: number;
  hr_zones?: Record<string, number>;
}

export interface RouteProperties {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance_km: number;
  elapsed_time: number;
  moving_time: number;
  total_elevation_gain?: number;
  average_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  country: string;
  city: string;
  color: string;
}

export interface GeoFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: RouteProperties;
}

export interface GeoJSON {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface Stream {
  altitude: number[];
  distance_stream: number[];
}

export interface RouteParams {
  from?: string;
  to?: string;
  sport_type?: string;
  country?: string;
  city?: string;
}

export interface CredentialsPayload {
  client_id: string;
  client_secret: string;
  osm_user_agent?: string;
  deepseek_api_key?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Memory {
  messages?: ChatMessage[];
  notes?: string;
  [key: string]: any;
}
