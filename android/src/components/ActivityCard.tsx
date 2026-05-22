import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from './ThemeProvider';
import type { RouteProperties } from '../services/types';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface Props {
  properties: RouteProperties;
  onPress: () => void;
}

export function ActivityCard({ properties, onPress }: Props) {
  const theme = useTheme();
  const date = new Date(properties.start_date).toLocaleDateString();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={styles.colorBar} pointerEvents="none">
        <View style={[styles.dot, { backgroundColor: properties.color }]} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {properties.name}
        </Text>
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {properties.sport_type} · {properties.distance_km} km · {formatDuration(properties.moving_time)}
        </Text>
        <Text style={[styles.date, { color: theme.textMuted }]}>{date}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  colorBar: {
    justifyContent: 'center',
    marginRight: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  content: {
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  meta: {
    fontSize: 13,
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
  },
});
