import { straightLineEta, type Eta, type LatLng, type TravelMode } from '@wat/core';

/**
 * FR-11 — where ETAs come from.
 *
 * The interface takes a *list* on purpose. Routing is the one metered cost in
 * the product, and the plan caps it by computing every participant of an event
 * in a single call. R1.2 computes on position ingest, so the list usually holds
 * one entry; the batching path is already here for the timer that replaces it.
 */

export interface RouteRequest {
  from: LatLng;
  mode: TravelMode;
}

export interface RoutingProvider {
  readonly name: string;
  /** One result per request, in order. Null where no route could be found. */
  routeMany(requests: readonly RouteRequest[], to: LatLng, now: number): Promise<(Eta | null)[]>;
}

/**
 * The fallback, and the only provider that works without a Mapbox token. It is
 * honest about what it is: every ETA it produces is labelled `straight_line`
 * all the way to the UI.
 */
export class StraightLineRouting implements RoutingProvider {
  readonly name = 'straight_line';

  routeMany(
    requests: readonly RouteRequest[],
    to: LatLng,
    now: number,
  ): Promise<(Eta | null)[]> {
    return Promise.resolve(
      requests.map((request) => straightLineEta(request.from, to, request.mode, now)),
    );
  }
}

const MAPBOX_PROFILE: Record<TravelMode, string> = {
  driving: 'mapbox/driving-traffic', // traffic-aware, per FR-11
  walking: 'mapbox/walking',
  cycling: 'mapbox/cycling',
  // Mapbox has no transit profile. Driving is the closest available shape for
  // a city journey; the UI labels transit ETAs as approximate either way.
  transit: 'mapbox/driving',
};

interface MatrixResponse {
  code?: string;
  durations?: (number | null)[][];
  distances?: (number | null)[][];
}

export class MapboxRouting implements RoutingProvider {
  readonly name = 'mapbox';

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async routeMany(
    requests: readonly RouteRequest[],
    to: LatLng,
    now: number,
  ): Promise<(Eta | null)[]> {
    if (requests.length === 0) return [];

    // Mapbox has one profile per request, so group by travel mode and send one
    // Matrix call per group rather than one call per person.
    const byMode = new Map<TravelMode, number[]>();
    requests.forEach((request, index) => {
      const existing = byMode.get(request.mode);
      if (existing === undefined) byMode.set(request.mode, [index]);
      else existing.push(index);
    });

    const results: (Eta | null)[] = new Array(requests.length).fill(null);

    await Promise.all(
      [...byMode.entries()].map(async ([mode, indexes]) => {
        const group = indexes.map((i) => requests[i]).filter((r) => r !== undefined);
        const etas = await this.matrix(group as RouteRequest[], to, mode, now);
        indexes.forEach((originalIndex, position) => {
          results[originalIndex] = etas[position] ?? null;
        });
      }),
    );

    return results;
  }

  private async matrix(
    requests: readonly RouteRequest[],
    to: LatLng,
    mode: TravelMode,
    now: number,
  ): Promise<(Eta | null)[]> {
    // Sources are the participants; the single destination is the venue.
    const coordinates = [
      ...requests.map((r) => `${r.from.lng},${r.from.lat}`),
      `${to.lng},${to.lat}`,
    ].join(';');
    const destinationIndex = requests.length;

    const url =
      `https://api.mapbox.com/directions-matrix/v1/${MAPBOX_PROFILE[mode]}/${coordinates}` +
      `?sources=${requests.map((_, i) => i).join(';')}` +
      `&destinations=${destinationIndex}` +
      `&annotations=duration,distance` +
      `&access_token=${encodeURIComponent(this.token)}`;

    let body: MatrixResponse;
    try {
      const response = await this.fetchImpl(url);
      if (!response.ok) throw new Error(`Mapbox returned ${response.status}`);
      body = (await response.json()) as MatrixResponse;
    } catch (error) {
      // A routing outage must not stop the group seeing each other move, so we
      // degrade to the estimate rather than showing nothing.
      console.warn('Routing failed, falling back to straight line:', error);
      return requests.map((r) => straightLineEta(r.from, to, r.mode, now));
    }

    if (body.code !== undefined && body.code !== 'Ok') {
      return requests.map((r) => straightLineEta(r.from, to, r.mode, now));
    }

    return requests.map((request, index) => {
      const durationS = body.durations?.[index]?.[0] ?? null;
      const distance = body.distances?.[index]?.[0] ?? null;

      // No route between these points (an island, a bad fix). Say so rather
      // than substituting a number that looks authoritative.
      if (durationS === null) return null;

      return {
        etaAt: now + Math.round(durationS) * 1_000,
        distanceM: Math.round(distance ?? 0),
        durationS: Math.round(durationS),
        source: 'routed' as const,
        computedAt: now,
      };
    });
  }
}

let provider: RoutingProvider | undefined;

export function getRoutingProvider(): RoutingProvider {
  if (provider !== undefined) return provider;

  const token = process.env.MAPBOX_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  provider =
    token === undefined || token === ''
      ? new StraightLineRouting()
      : new MapboxRouting(token);
  return provider;
}

/** Test seam. */
export function setRoutingProvider(next: RoutingProvider | undefined): void {
  provider = next;
}
