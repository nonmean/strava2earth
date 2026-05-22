import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { useTheme } from './ThemeProvider';

const MAX_POINTS = 80;

function downsample(arr: number[], max: number): number[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  return Array.from({ length: max }, (_, i) => arr[Math.floor(i * step)]);
}

interface Props {
  altitude: number[];
  distance: number[];
}

export function ElevationChart({ altitude, distance }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const { altDs, labels } = useMemo(() => {
    const altDs = downsample(altitude, MAX_POINTS);
    const distDs = downsample(distance, MAX_POINTS);
    const labels = distDs.map((d, i) =>
      i % Math.floor(MAX_POINTS / 5) === 0 ? (d / 1000).toFixed(1) : '',
    );
    return { altDs, labels };
  }, [altitude, distance]);

  if (!altDs.length) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: theme.textMuted }}>No elevation data</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <Text style={[styles.title, { color: theme.textMuted }]}>Elevation (m) · Distance (km)</Text>
      {width > 0 && <LineChart
        data={{ labels, datasets: [{ data: altDs }] }}
        width={width}
        height={160}
        withDots={false}
        withInnerLines={false}
        withOuterLines={false}
        chartConfig={{
          backgroundColor: theme.bgSecondary,
          backgroundGradientFrom: theme.bgSecondary,
          backgroundGradientTo: theme.bgSecondary,
          color: () => theme.accent,
          labelColor: () => theme.textMuted,
          propsForLabels: { fontSize: 10 },
          fillShadowGradient: theme.accent,
          fillShadowGradientOpacity: 0.3,
        }}
        bezier
        style={{ borderRadius: 8 }}
      />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
  },
  title: {
    fontSize: 12,
    marginBottom: 4,
    marginLeft: 4,
  },
  empty: {
    padding: 20,
    alignItems: 'center',
  },
});
