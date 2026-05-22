import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from './ThemeProvider';
import type { SyncStatus } from '../services/types';

interface Props {
  status: SyncStatus;
}

export function SyncProgress({ status }: Props) {
  const theme = useTheme();
  const pct = status.total > 0 ? status.done / status.total : 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.bgSecondary }]}>
      <Text style={[styles.label, { color: theme.text }]}>
        Syncing… {status.done}/{status.total}
        {status.errors > 0 ? `  (${status.errors} errors)` : ''}
      </Text>
      <View style={[styles.track, { backgroundColor: theme.border }]}>
        <View style={[styles.fill, { backgroundColor: theme.accent, width: `${Math.round(pct * 100)}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 8,
  },
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
});
