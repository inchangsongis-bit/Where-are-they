import Mapbox, { Camera, MarkerView, MapView } from '@rnmapbox/maps';
import { mapMarkers, mapViewport, type Participant } from '@wat/core';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * FR-13 — the map tab on native.
 *
 * Shares mapMarkers and mapViewport with the web surface, so the two cannot
 * disagree about which dots to draw or how stale is too stale. No route lines:
 * six overlapping polylines is noise, not information.
 */

const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
if (token !== '') Mapbox.setAccessToken(token);

export default function EventMap({
  participants, venue, selectedId, onSelect, now,
}: {
  participants: Participant[];
  venue: { name: string; lat: number; lng: number };
  selectedId: string | null;
  onSelect: (participantId: string | null) => void;
  now: number;
}) {
  const dots = useMemo(() => mapMarkers(participants, now), [participants, now]);
  const bounds = useMemo(() => mapViewport(venue, dots), [venue, dots]);

  if (token === '') {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingTitle}>The map needs a Mapbox token.</Text>
        <Text style={styles.missingBody}>
          Set EXPO_PUBLIC_MAPBOX_TOKEN and rebuild. The list has the same
          information, sorted by who arrives first.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView style={styles.map} onPress={() => onSelect(null)}>
        <Camera
          {...(bounds === null
            ? {}
            : {
                bounds: {
                  ne: [bounds.east, bounds.north] as [number, number],
                  sw: [bounds.west, bounds.south] as [number, number],
                },
              })}
          padding={{
            paddingTop: 48, paddingBottom: 48, paddingLeft: 48, paddingRight: 48,
          }}
          animationDuration={600}
        />

        <MarkerView id="venue" coordinate={[venue.lng, venue.lat]}>
          <View style={styles.venue} accessibilityLabel={`Venue: ${venue.name}`} />
        </MarkerView>

        {dots.map((dot) => (
          <MarkerView key={dot.participantId}
            id={dot.participantId}
            coordinate={[dot.position.lng, dot.position.lat]}>
            <Pressable onPress={() => onSelect(dot.participantId)}
              accessibilityLabel={
                `${dot.displayName}, ${dot.travelMode}` +
                (dot.state === 'stale' ? ', last position is out of date' : '')
              }
              style={[
                styles.dot,
                { backgroundColor: dot.color },
                dot.state === 'stale' && styles.dotStale,
                dot.participantId === selectedId && styles.dotSelected,
              ]}>
              <Text style={styles.dotText}>
                {dot.displayName.slice(0, 1).toUpperCase()}
              </Text>
            </Pressable>
          </MarkerView>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { height: 420, width: '100%' },
  map: { flex: 1 },
  missing: { padding: 20, gap: 8 },
  missingTitle: { fontWeight: '700', fontSize: 15 },
  missingBody: { fontSize: 14, opacity: 0.75, lineHeight: 20 },
  venue: {
    width: 18, height: 18, borderRadius: 3,
    backgroundColor: '#141F1D', borderWidth: 3, borderColor: '#FBFCFA',
  },
  dot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FBFCFA',
  },
  dotStale: { opacity: 0.45 },
  dotSelected: { borderColor: '#0B6E63', borderWidth: 3 },
  dotText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
