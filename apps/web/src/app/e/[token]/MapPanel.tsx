'use client';

import { mapMarkers, mapViewport, type MapMarker, type Participant } from '@wat/core';
import { useEffect, useMemo, useRef } from 'react';
import type { Map as MapboxMap, Marker as MapboxMarker } from 'mapbox-gl';

/**
 * FR-13 — the map tab.
 *
 * Secondary to the list on purpose: the list answers "should we order?", and a
 * map is what people expect to see, which is not the same thing. So this is a
 * second tab, it draws no route lines (six overlapping polylines is noise), and
 * it inherits the list's staleness rules exactly — faded at two minutes, gone
 * at ten.
 */

const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';

function markerElement(marker: MapMarker, selected: boolean): HTMLElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `map-dot${marker.state === 'stale' ? ' stale' : ''}${selected ? ' selected' : ''}`;
  element.style.background = marker.color;
  element.textContent = marker.displayName.slice(0, 1).toUpperCase();
  // Colour alone never carries meaning (NFR accessibility).
  element.setAttribute(
    'aria-label',
    `${marker.displayName}, ${marker.travelMode}` +
      (marker.state === 'stale' ? ', last position is out of date' : ''),
  );
  return element;
}

export default function MapPanel({
  participants, venue, selectedId, onSelect,
}: {
  participants: Participant[];
  venue: { name: string; address: string; lat: number; lng: number };
  selectedId: string | null;
  onSelect: (participantId: string | null) => void;
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapboxMap | null>(null);
  const markers = useRef<Map<string, MapboxMarker>>(new Map());

  // Recomputed from the same rules the list uses, so the two can never disagree
  // about whether someone's position is worth believing.
  const now = Date.now();
  const dots = useMemo(() => mapMarkers(participants, now), [participants, now]);

  useEffect(() => {
    if (token === '' || container.current === null || map.current !== null) return;

    let cancelled = false;
    void (async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      if (cancelled || container.current === null) return;

      mapboxgl.accessToken = token;
      const instance = new mapboxgl.Map({
        container: container.current,
        style: MAP_STYLE,
        center: [venue.lng, venue.lat],
        zoom: 13,
        attributionControl: true,
      });

      const venueElement = document.createElement('div');
      venueElement.className = 'map-venue';
      venueElement.setAttribute('aria-label', `Venue: ${venue.name}`);
      new mapboxgl.Marker({ element: venueElement })
        .setLngLat([venue.lng, venue.lat])
        .addTo(instance);

      // Tapping empty map clears the selection, which is how you get back to
      // seeing everyone.
      instance.on('click', () => onSelect(null));

      map.current = instance;
    })();

    return () => {
      cancelled = true;
    };
  }, [token, venue, onSelect]);

  useEffect(() => {
    return () => {
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  // Reconcile markers rather than rebuilding them: recreating every dot on each
  // five-second poll makes the map flicker and throws away any open popup.
  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;

    void (async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      const seen = new Set<string>();

      for (const dot of dots) {
        seen.add(dot.participantId);
        const existing = markers.current.get(dot.participantId);
        const element = markerElement(dot, dot.participantId === selectedId);
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          onSelect(dot.participantId);
        });

        if (existing === undefined) {
          const created = new mapboxgl.Marker({ element })
            .setLngLat([dot.position.lng, dot.position.lat])
            .addTo(instance);
          markers.current.set(dot.participantId, created);
        } else {
          existing.setLngLat([dot.position.lng, dot.position.lat]);
          existing.getElement().replaceWith(element);
          // Mapbox keeps its own reference to the element, so swap it too.
          (existing as unknown as { _element: HTMLElement })._element = element;
        }
      }

      for (const [id, marker] of markers.current) {
        if (!seen.has(id)) {
          marker.remove();
          markers.current.delete(id);
        }
      }

      const bounds = mapViewport(venue, dots);
      if (bounds !== null) {
        instance.fitBounds(
          [[bounds.west, bounds.south], [bounds.east, bounds.north]],
          { padding: 48, duration: 600, maxZoom: 15 },
        );
      }
    })();
  }, [dots, selectedId, venue, onSelect]);

  if (token === '') {
    // No token, no map. Saying so plainly beats a grey rectangle or a fake one,
    // and the list upstairs still answers the question people came for.
    return (
      <div className="map-missing">
        <p>
          <strong>The map needs a Mapbox token.</strong>
        </p>
        <p>
          Set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> and reload. Until then the
          list is the live view — it has the same information, sorted by who
          arrives first.
        </p>
        <p className="hint">
          {dots.length === 0
            ? 'Nobody is sharing a position right now.'
            : `${dots.length} ${dots.length === 1 ? 'person is' : 'people are'} sharing a position.`}
        </p>
      </div>
    );
  }

  return <div className="map" ref={container} aria-label="Map of everyone on their way" />;
}
