import { InAppBrowser } from 'react-native-inappbrowser-reborn';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadCredentials } from './secureStorage';
import type { TokenData } from './secureStorage';
import { saveToken, clearToken } from './secureStorage';

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const REDIRECT_URI = 'strava2earth://auth/callback';
const OAUTH_STATE_KEY = 'strava2earth_oauth_state';

export async function loginWithStrava(): Promise<TokenData> {
  const creds = await loadCredentials();
  if (!creds) throw new Error('Credentials not configured');

  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  const state = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
  await AsyncStorage.setItem(OAUTH_STATE_KEY, state);

  const authUrl =
    `${STRAVA_AUTH_URL}?client_id=${creds.client_id}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&approval_prompt=auto` +
    `&scope=read,activity:read_all,activity:write` +
    `&state=${state}`;

  const result = await InAppBrowser.openAuth(authUrl, REDIRECT_URI, {
    showTitle: false,
    enableUrlBarHiding: true,
    enableDefaultShare: false,
    ephemeralWebSession: false,
  });

  if (result.type !== 'success') {
    throw new Error('OAuth cancelled');
  }

  const url = new URL(result.url);
  const returnedState = url.searchParams.get('state');
  const savedState = await AsyncStorage.getItem(OAUTH_STATE_KEY);
  await AsyncStorage.removeItem(OAUTH_STATE_KEY);

  if (returnedState !== savedState) throw new Error('OAuth state mismatch — possible CSRF');

  const code = url.searchParams.get('code');
  if (!code) throw new Error('No authorization code returned');

  const token = await exchangeCode(code, creds.client_id, creds.client_secret);
  await saveToken(token);
  return token;
}

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenData> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete_id: data.athlete.id,
    athlete_name: `${data.athlete.firstname} ${data.athlete.lastname}`.trim(),
  };
}

export async function refreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<TokenData> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    // athlete info not returned on refresh — caller must supply existing values
    athlete_id: 0,
    athlete_name: '',
  };
}

export async function getValidToken(): Promise<string> {
  const { loadToken } = await import('./secureStorage');
  const token = await loadToken();
  if (!token) throw new Error('Not authenticated');

  if (Date.now() / 1000 < token.expires_at - 60) {
    return token.access_token;
  }

  const creds = await loadCredentials();
  if (!creds) throw new Error('Credentials missing');

  const refreshed = await refreshToken(token.refresh_token, creds.client_id, creds.client_secret);
  const updated: TokenData = {
    ...refreshed,
    athlete_id: token.athlete_id,
    athlete_name: token.athlete_name,
  };
  await saveToken(updated);
  return updated.access_token;
}

export async function logout(): Promise<void> {
  await clearToken();
}
