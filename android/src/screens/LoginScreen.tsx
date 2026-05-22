import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { saveCredentials, loadCredentials, loadToken } from '../services/secureStorage';
import { loginWithStrava } from '../services/stravaAuth';
import { useAppStore } from '../stores/appStore';
import { useTheme } from '../components/ThemeProvider';

export function LoginScreen() {
  const theme = useTheme();
  const setAuthenticated = useAppStore(s => s.setAuthenticated);
  const setDeepseekApiKey = useAppStore(s => s.setDeepseekApiKey);

  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [osmAgent, setOsmAgent] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [creds, token] = await Promise.all([loadCredentials(), loadToken()]);
      if (token) {
        // Already authenticated — App.tsx should have set authenticated=true,
        // but just in case the initial load hasn't propagated yet:
        setAuthenticated(true, token.athlete_name, token.athlete_id);
        if (creds?.deepseek_api_key) setDeepseekApiKey(creds.deepseek_api_key);
        return;
      }
      if (creds) {
        setConfigured(true);
        if (creds.deepseek_api_key) setDeepseekApiKey(creds.deepseek_api_key);
      }
      setChecking(false);
    })();
  }, []);

  async function saveSetup() {
    if (!clientId.trim() || !clientSecret.trim()) {
      Alert.alert('Error', 'Strava Client ID and Client Secret are required.');
      return;
    }
    setSaving(true);
    try {
      await saveCredentials({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        osm_user_agent: osmAgent.trim(),
        deepseek_api_key: deepseekKey.trim(),
      });
      if (deepseekKey.trim()) setDeepseekApiKey(deepseekKey.trim());
      setConfigured(true);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  }

  async function connectStrava() {
    setConnecting(true);
    try {
      const token = await loginWithStrava();
      setAuthenticated(true, token.athlete_name, token.athlete_id);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'OAuth failed');
    } finally {
      setConnecting(false);
    }
  }

  if (checking) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={[styles.screen, { backgroundColor: theme.bg }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: theme.accent }]}>strava2earth</Text>
      <Text style={[styles.subtitle, { color: theme.textMuted }]}>
        Your Strava activities on a map
      </Text>

      {!configured && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Setup</Text>
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Enter your Strava API credentials. You can get them from{' '}
            <Text style={{ color: theme.accent }}>strava.com/settings/api</Text>.
          </Text>

          <Text style={[styles.label, { color: theme.textMuted }]}>Strava Client ID *</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgSecondary, color: theme.text, borderColor: theme.border }]}
            value={clientId}
            onChangeText={setClientId}
            placeholder="e.g. 12345"
            placeholderTextColor={theme.textMuted}
            keyboardType="numeric"
          />

          <Text style={[styles.label, { color: theme.textMuted }]}>Strava Client Secret *</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgSecondary, color: theme.text, borderColor: theme.border }]}
            value={clientSecret}
            onChangeText={setClientSecret}
            placeholder="Your Strava app secret"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
          />

          <Text style={[styles.label, { color: theme.textMuted }]}>
            OSM contact email (for Nominatim geocoding)
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgSecondary, color: theme.text, borderColor: theme.border }]}
            value={osmAgent}
            onChangeText={setOsmAgent}
            placeholder="your@email.com"
            placeholderTextColor={theme.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={[styles.label, { color: theme.textMuted }]}>
            DeepSeek API key (optional, for AI coach)
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgSecondary, color: theme.text, borderColor: theme.border }]}
            value={deepseekKey}
            onChangeText={setDeepseekKey}
            placeholder="sk-…"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.accent }, saving && styles.disabled]}
            onPress={saveSetup}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.buttonText}>Save & Continue</Text>
            }
          </TouchableOpacity>
        </View>
      )}

      {configured && (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Connect to Strava</Text>
          <Text style={[styles.bodyText, { color: theme.textMuted }]}>
            Tap below to authorize strava2earth to read your activities.
          </Text>
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Make sure{' '}
            <Text style={{ color: theme.accent }}>strava2earth://auth/callback</Text>
            {' '}is listed as an authorized redirect URI in your Strava API app settings.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: '#fc4c02' }, connecting && styles.disabled]}
            onPress={connectStrava}
            disabled={connecting}
          >
            {connecting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.buttonText}>Connect with Strava</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backLink}
            onPress={() => setConfigured(false)}
          >
            <Text style={{ color: theme.textMuted, fontSize: 13 }}>Update credentials</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, paddingTop: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 32 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  hint: { fontSize: 12, marginBottom: 10, lineHeight: 16 },
  label: { fontSize: 12, marginBottom: 4, marginTop: 10 },
  input: {
    height: 44, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, fontSize: 14,
  },
  button: {
    height: 48, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 20,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.6 },
  bodyText: { fontSize: 14, marginBottom: 8, lineHeight: 20 },
  backLink: { alignItems: 'center', marginTop: 12, paddingVertical: 4 },
});
