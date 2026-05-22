import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../App';
import { getStream, updateActivityName, updateActivitySportType } from '../services/cacheManager';
import { getValidToken } from '../services/stravaAuth';
import { useTheme } from '../components/ThemeProvider';
import { ElevationChart } from '../components/ElevationChart';
import { SPORT_TYPES } from '../services/sportTypes';
import type { Stream, RouteProperties } from '../services/types';

type Props = NativeStackScreenProps<MainStackParamList, 'ActivityDetail'>;

function StatRow({ label, value, accent }: { label: string; value: string; accent: string }) {
  const theme = useTheme();
  return (
    <View style={styles.statRow}>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ActivityDetailScreen({ route, navigation }: Props) {
  const theme = useTheme();
  const { activityId, properties: initProps } = route.params;

  const [props, setProps] = useState<RouteProperties>(initProps);
  const [stream, setStream] = useState<Stream | null>(null);
  const [loadingStream, setLoadingStream] = useState(true);

  // Edit name
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(initProps.name);
  const [savingName, setSavingName] = useState(false);

  // Edit sport type
  const [sportModalVisible, setSportModalVisible] = useState(false);
  const [savingSport, setSavingSport] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: props.name });
    getStream(activityId)
      .then(setStream)
      .catch(() => setStream(null))
      .finally(() => setLoadingStream(false));
  }, [activityId]);

  async function saveName() {
    if (!nameInput.trim() || nameInput === props.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      const token = await getValidToken();
      const newName = await updateActivityName(token, activityId, nameInput.trim());
      setProps(p => ({ ...p, name: newName }));
      navigation.setOptions({ title: newName });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to update name');
    } finally {
      setSavingName(false);
      setEditingName(false);
    }
  }

  async function saveSportType(type: string) {
    setSavingSport(true);
    setSportModalVisible(false);
    try {
      const token = await getValidToken();
      const result = await updateActivitySportType(token, activityId, type);
      setProps(p => ({
        ...p,
        sport_type: result.sport_type,
        color: result.color,
      }));
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to update sport type');
    } finally {
      setSavingSport(false);
    }
  }

  return (
    <ScrollView style={[styles.screen, { backgroundColor: theme.bg }]} contentContainerStyle={styles.content}>
      {/* Name row */}
      <View style={styles.nameRow}>
        {editingName ? (
          <TextInput
            style={[styles.nameInput, { color: theme.text, borderColor: theme.accent, backgroundColor: theme.bgSecondary }]}
            value={nameInput}
            onChangeText={setNameInput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={saveName}
          />
        ) : (
          <Text style={[styles.activityName, { color: theme.text }]}>{props.name}</Text>
        )}
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => editingName ? saveName() : setEditingName(true)}
          disabled={savingName}
        >
          <Text style={{ color: theme.accent, fontSize: 13 }}>
            {editingName ? (savingName ? '…' : 'Save') : 'Edit'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sport type row */}
      <View style={[styles.nameRow, { marginTop: 4 }]}>
        <View style={[styles.sportDot, { backgroundColor: props.color }]} />
        <Text style={[styles.sportType, { color: theme.textMuted }]}>{props.sport_type}</Text>
        <TouchableOpacity onPress={() => setSportModalVisible(true)} disabled={savingSport}>
          <Text style={{ color: theme.accent, fontSize: 13, marginLeft: 8 }}>
            {savingSport ? '…' : 'Edit'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <StatRow label="Date" value={new Date(props.start_date).toLocaleDateString()} accent={theme.accent} />
        <StatRow label="Distance" value={`${props.distance_km} km`} accent={theme.accent} />
        <StatRow label="Moving time" value={formatDuration(props.moving_time)} accent={theme.accent} />
        <StatRow label="Elapsed time" value={formatDuration(props.elapsed_time)} accent={theme.accent} />
        {props.total_elevation_gain != null && (
          <StatRow label="Elevation gain" value={`${Math.round(props.total_elevation_gain)} m`} accent={theme.accent} />
        )}
        {props.average_heartrate != null && (
          <StatRow label="Avg HR" value={`${Math.round(props.average_heartrate)} bpm`} accent={theme.accent} />
        )}
        {props.max_heartrate != null && (
          <StatRow label="Max HR" value={`${Math.round(props.max_heartrate)} bpm`} accent={theme.accent} />
        )}
        {props.city ? <StatRow label="City" value={props.city} accent={theme.accent} /> : null}
        {props.country ? <StatRow label="Country" value={props.country} accent={theme.accent} /> : null}
      </View>

      {/* Elevation chart */}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Elevation Profile</Text>
        {loadingStream ? (
          <ActivityIndicator color={theme.accent} style={{ marginVertical: 20 }} />
        ) : stream ? (
          <ElevationChart altitude={stream.altitude} distance={stream.distance_stream} />
        ) : (
          <Text style={{ color: theme.textMuted, textAlign: 'center', paddingVertical: 16 }}>
            No elevation data available
          </Text>
        )}
      </View>

      {/* Sport type modal */}
      <Modal visible={sportModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Select Sport Type</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {SPORT_TYPES.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.sportOption, props.sport_type === t && { backgroundColor: theme.accent + '30' }]}
                  onPress={() => saveSportType(t)}
                >
                  <Text style={{ color: theme.text, fontSize: 15 }}>{t}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.button, { backgroundColor: theme.border }]}
              onPress={() => setSportModalVisible(false)}
            >
              <Text style={{ color: theme.text, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  activityName: { flex: 1, fontSize: 20, fontWeight: '700' },
  nameInput: {
    flex: 1, fontSize: 18, fontWeight: '700', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 10, height: 40,
  },
  editBtn: { paddingLeft: 10, paddingVertical: 4 },
  sportDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  sportType: { fontSize: 14 },
  card: { padding: 14, borderRadius: 12, borderWidth: 1, marginTop: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 8 },
  statRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  statLabel: { fontSize: 13 },
  statValue: { fontSize: 13, fontWeight: '500' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalCard: {
    padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16,
    borderWidth: 1, paddingBottom: 36,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  sportOption: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8 },
  button: {
    height: 48, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 12,
  },
});
