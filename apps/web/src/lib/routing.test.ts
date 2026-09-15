import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapboxRouting, StraightLineRouting, setRoutingProvider } from './routing';

const VENUE = { lat: 40.7188, lng: -73.9938 };
const FROM = { lat: 40.7338, lng: -73.9938 };
const NOW = Date.UTC(2026, 8, 10, 23, 30, 0);

afterEach(() => setRoutingProvider(undefined));

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('StraightLineRouting', () => {
  it('always answers, and always says the answer is an estimate', async () => {
    const [eta] = await new StraightLineRouting().routeMany(
      [{ from: FROM, mode: 'driving' }], VENUE, NOW,
    );
    expect(eta?.source).toBe('straight_line');
  });

  it('returns one result per request, in order', async () => {
    const results = await new StraightLineRouting().routeMany(
      [
        { from: FROM, mode: 'driving' },
        { from: { lat: 40.79, lng: -73.99 }, mode: 'driving' },
      ],
      VENUE, NOW,
    );
    expect(results).toHaveLength(2);
    // Same mode, further away: the second must take longer, and the results
    // must not have been reordered.
    expect(results[0]?.durationS).toBeLessThan(results[1]?.durationS ?? 0);
  });

  it('handles an empty request list', async () => {
    expect(await new StraightLineRouting().routeMany([], VENUE, NOW)).toEqual([]);
  });
});

describe('MapboxRouting', () => {
  it('asks the traffic-aware profile for driving (FR-11)', async () => {
    const fetchImpl = vi.fn((input: string) => {
      void input;
      return Promise.resolve(
        jsonResponse({ code: 'Ok', durations: [[540]], distances: [[2400]] }),
      );
    });
    await new MapboxRouting('tok', fetchImpl as unknown as typeof fetch)
      .routeMany([{ from: FROM, mode: 'driving' }], VENUE, NOW);

    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain('driving-traffic');
    expect(url).toContain('sources=0');
    expect(url).toContain('destinations=1');
    expect(url).toContain(`${FROM.lng},${FROM.lat}`);
    expect(url).toContain(`${VENUE.lng},${VENUE.lat}`);
  });

  it('turns a matrix duration into a routed ETA', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ code: 'Ok', durations: [[540]], distances: [[2400]] })),
    );
    const [eta] = await new MapboxRouting('tok', fetchImpl as unknown as typeof fetch)
      .routeMany([{ from: FROM, mode: 'driving' }], VENUE, NOW);

    expect(eta).toEqual({
      etaAt: NOW + 540_000,
      distanceM: 2400,
      durationS: 540,
      source: 'routed',
      computedAt: NOW,
    });
  });

  it('sends one call per travel mode, not one per person', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({
        code: 'Ok', durations: [[300], [600]], distances: [[1000], [2000]],
      })),
    );
    await new MapboxRouting('tok', fetchImpl as unknown as typeof fetch).routeMany(
      [
        { from: FROM, mode: 'driving' },
        { from: { lat: 40.75, lng: -73.99 }, mode: 'driving' },
        { from: { lat: 40.76, lng: -73.98 }, mode: 'walking' },
      ],
      VENUE, NOW,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps results aligned with their requests across modes', async () => {
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('walking')
          ? jsonResponse({ code: 'Ok', durations: [[1800]], distances: [[2000]] })
          : jsonResponse({ code: 'Ok', durations: [[300]], distances: [[1000]] }),
      ),
    );
    const results = await new MapboxRouting('tok', fetchImpl as unknown as typeof fetch)
      .routeMany(
        [{ from: FROM, mode: 'walking' }, { from: FROM, mode: 'driving' }],
        VENUE, NOW,
      );
    expect(results[0]?.durationS).toBe(1800);
    expect(results[1]?.durationS).toBe(300);
  });

  it('returns null where no route exists, rather than inventing a number', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ code: 'Ok', durations: [[null]], distances: [[null]] })),
    );
    const [eta] = await new MapboxRouting('tok', fetchImpl as unknown as typeof fetch)
      .routeMany([{ from: FROM, mode: 'driving' }], VENUE, NOW);
    expect(eta).toBeNull();
  });

  it('degrades to the estimate when routing is down, so the group still sees movement', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('network gone')));
    const [eta] = await new MapboxRouting('tok', fetchImpl as unknown as typeof fetch)
      .routeMany([{ from: FROM, mode: 'driving' }], VENUE, NOW);
    expect(eta?.source).toBe('straight_line');
  });

  it('degrades on an HTTP error too', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}, false)));
    const [eta] = await new MapboxRouting('tok', fetchImpl as unknown as typeof fetch)
      .routeMany([{ from: FROM, mode: 'walking' }], VENUE, NOW);
    expect(eta?.source).toBe('straight_line');
  });

  it('degrades when Mapbox reports a non-Ok code', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ code: 'ProfileNotFound' })),
    );
    const [eta] = await new MapboxRouting('tok', fetchImpl as unknown as typeof fetch)
      .routeMany([{ from: FROM, mode: 'driving' }], VENUE, NOW);
    expect(eta?.source).toBe('straight_line');
  });
});
