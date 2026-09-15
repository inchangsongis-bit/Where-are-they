import { positionFreshness } from './freshness';
import type { LatLng, Participant } from './types';

/**
 * FR-13 — what goes on the map.
 *
 * The staleness rules that govern the list govern the map too, and for the same
 * reason: a dot sitting confidently on a street corner is a stronger claim than
 * a line of text, so it has to expire sooner rather than later. Faded at two
 * minutes, gone at ten.
 */

export interface MapMarker {
  participantId: string;
  displayName: string;
  color: string;
  position: LatLng;
  /** Faded markers are still worth showing; expired ones are not shown at all. */
  state: 'fresh' | 'stale';
  travelMode: Participant['travelMode'];
}

export function mapMarkers(
  participants: readonly Participant[],
  now: number,
): MapMarker[] {
  const markers: MapMarker[] = [];

  for (const participant of participants) {
    // People who have arrived are at the venue pin by definition, and their
    // last fix is usually the car park. A second dot there says nothing.
    if (participant.status !== 'en_route') continue;

    const position = participant.lastPosition;
    if (position === null) continue;

    const freshness = positionFreshness(position.recordedAt, now);
    if (freshness === 'expired') continue;

    markers.push({
      participantId: participant.id,
      displayName: participant.displayName,
      color: participant.color,
      position: { lat: position.lat, lng: position.lng },
      state: freshness,
      travelMode: participant.travelMode,
    });
  }

  return markers;
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * A box containing every point, padded so nothing sits on the edge of the
 * screen, and never smaller than `minSpanDegrees` — otherwise a single marker
 * at the venue zooms the map to maximum and shows the viewer a doorway.
 *
 * Assumes the points are local to one another, which for a dinner they are.
 * A group spanning the antimeridian would get a box the wrong way round; that
 * is a documented limitation rather than a silent one.
 */
export function boundsFor(
  points: readonly LatLng[],
  options: { paddingRatio?: number; minSpanDegrees?: number } = {},
): Bounds | null {
  if (points.length === 0) return null;

  const paddingRatio = options.paddingRatio ?? 0.2;
  const minSpan = options.minSpanDegrees ?? 0.004; // roughly 400m of latitude

  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;

  for (const point of points) {
    north = Math.max(north, point.lat);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lng);
    west = Math.min(west, point.lng);
  }

  const latSpan = Math.max(north - south, minSpan);
  const lngSpan = Math.max(east - west, minSpan);
  const latCentre = (north + south) / 2;
  const lngCentre = (east + west) / 2;

  const latHalf = (latSpan / 2) * (1 + paddingRatio);
  const lngHalf = (lngSpan / 2) * (1 + paddingRatio);

  return {
    north: Math.min(90, latCentre + latHalf),
    south: Math.max(-90, latCentre - latHalf),
    east: Math.min(180, lngCentre + lngHalf),
    west: Math.max(-180, lngCentre - lngHalf),
  };
}

/** Everything the map should frame: the venue plus whoever is visibly moving. */
export function mapViewport(
  venue: LatLng,
  markers: readonly MapMarker[],
): Bounds | null {
  return boundsFor([venue, ...markers.map((marker) => marker.position)]);
}
