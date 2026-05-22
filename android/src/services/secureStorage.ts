import EncryptedStorage from 'react-native-encrypted-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Credentials {
  client_id: string;
  client_secret: string;
  osm_user_agent: string;
  deepseek_api_key: string;
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete_id: number;
  athlete_name: string;
}

const KEYS = {
  CLIENT_SECRET: 'strava2earth_client_secret',
  DEEPSEEK_KEY: 'strava2earth_deepseek_key',
  REFRESH_TOKEN: 'strava2earth_refresh_token',
  ACCESS_TOKEN: 'strava2earth_access_token',
  CLIENT_ID: 'strava2earth_client_id',
  OSM_AGENT: 'strava2earth_osm_agent',
  TOKEN_META: 'strava2earth_token_meta',
};

export async function saveCredentials(creds: Credentials): Promise<void> {
  await EncryptedStorage.setItem(KEYS.CLIENT_SECRET, creds.client_secret);
  await EncryptedStorage.setItem(KEYS.DEEPSEEK_KEY, creds.deepseek_api_key);
  await AsyncStorage.setItem(KEYS.CLIENT_ID, creds.client_id);
  await AsyncStorage.setItem(KEYS.OSM_AGENT, creds.osm_user_agent);
}

export async function loadCredentials(): Promise<Credentials | null> {
  const [client_id, osm_user_agent, client_secret, deepseek_api_key] = await Promise.all([
    AsyncStorage.getItem(KEYS.CLIENT_ID),
    AsyncStorage.getItem(KEYS.OSM_AGENT),
    EncryptedStorage.getItem(KEYS.CLIENT_SECRET),
    EncryptedStorage.getItem(KEYS.DEEPSEEK_KEY),
  ]);
  if (!client_id || !client_secret) return null;
  return {
    client_id: client_id ?? '',
    client_secret: client_secret ?? '',
    osm_user_agent: osm_user_agent ?? '',
    deepseek_api_key: deepseek_api_key ?? '',
  };
}

export async function clearCredentials(): Promise<void> {
  await EncryptedStorage.removeItem(KEYS.CLIENT_SECRET);
  await EncryptedStorage.removeItem(KEYS.DEEPSEEK_KEY);
  await Promise.all([AsyncStorage.removeItem(KEYS.CLIENT_ID), AsyncStorage.removeItem(KEYS.OSM_AGENT)]);
}

export async function saveToken(token: TokenData): Promise<void> {
  await EncryptedStorage.setItem(KEYS.ACCESS_TOKEN, token.access_token);
  await EncryptedStorage.setItem(KEYS.REFRESH_TOKEN, token.refresh_token);
  await AsyncStorage.setItem(KEYS.TOKEN_META, JSON.stringify({
    expires_at: token.expires_at,
    athlete_id: token.athlete_id,
    athlete_name: token.athlete_name,
  }));
}

export async function loadToken(): Promise<TokenData | null> {
  const [access_token, refresh_token, metaStr] = await Promise.all([
    EncryptedStorage.getItem(KEYS.ACCESS_TOKEN),
    EncryptedStorage.getItem(KEYS.REFRESH_TOKEN),
    AsyncStorage.getItem(KEYS.TOKEN_META),
  ]);
  if (!access_token || !refresh_token || !metaStr) return null;
  const meta = JSON.parse(metaStr);
  return { access_token, refresh_token, ...meta };
}

export async function clearToken(): Promise<void> {
  await EncryptedStorage.removeItem(KEYS.ACCESS_TOKEN);
  await EncryptedStorage.removeItem(KEYS.REFRESH_TOKEN);
  await AsyncStorage.removeItem(KEYS.TOKEN_META);
}
