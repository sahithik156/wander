/**
 * Wikipedia geosearch — worker-side only (never imported by browser code).
 * The platform wikipedia integration has no geosearch, so this calls the
 * public API directly (see SPEC.md "Data source").
 */

const API = 'https://en.wikipedia.org/w/api.php'

/** Wikipedia asks API clients to identify themselves. */
const USER_AGENT = 'Wander/0.1 (https://wander.app.space; walking-tour app)'

export const RADIUS_METERS: Record<number, number> = { 30: 800, 60: 1500, 90: 2200 }
export const GEOSEARCH_LIMIT = 150

export interface Place {
  pageid: number
  title: string
  lat: number
  lng: number
  /** Meters from the search point. Results arrive nearest first. */
  dist: number
}

interface GeosearchResponse {
  query?: { geosearch?: Array<{ pageid: number; title: string; lat: number; lon: number; dist: number }> }
  error?: { code?: string; info?: string }
}

export async function geosearch(
  lat: number,
  lng: number,
  radiusMeters: number,
  signal?: AbortSignal,
): Promise<Place[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'geosearch',
    gscoord: `${lat}|${lng}`,
    gsradius: String(radiusMeters),
    gslimit: String(GEOSEARCH_LIMIT),
    format: 'json',
    formatversion: '2',
  })
  const res = await fetch(`${API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Error(`Wikipedia geosearch failed: HTTP ${res.status}`)
  const body = (await res.json()) as GeosearchResponse
  if (body.error) throw new Error(`Wikipedia geosearch error: ${body.error.info ?? body.error.code}`)
  return (body.query?.geosearch ?? []).map((g) => ({
    pageid: g.pageid,
    title: g.title,
    lat: g.lat,
    lng: g.lon,
    dist: g.dist,
  }))
}

export function pageUrl(pageid: number): string {
  return `https://en.wikipedia.org/?curid=${pageid}`
}

// ---------------------------------------------------------------------------
// Code filters (SPEC.md "Filtering before AI")
// ---------------------------------------------------------------------------

/** Titles containing any of these (case-insensitive) are dropped. */
const DROP_SUBSTRINGS = ['constituency', '(uk parliament', ' road', 'built-up area']

const isStation = (title: string) => /\brailway station\b|\bstation$/i.test(title)
const isSchool = (title: string) => /\bschool\b/i.test(title)

/**
 * Drops noise titles, then keeps at most one railway station and one school
 * (the first of each, i.e. the nearest). Order is preserved.
 *
 * Deliberately NO town/district rule: dropping a landmark such as
 * "Trafalgar Square" or "Statue of Charles James Napier, Trafalgar Square"
 * is worse than keeping a district; the AI selection step removes districts.
 */
export function filterPlaces(places: Place[]): Place[] {
  let stationKept = false
  let schoolKept = false
  const out: Place[] = []
  for (const place of places) {
    const lower = place.title.toLowerCase()
    if (DROP_SUBSTRINGS.some((s) => lower.includes(s))) continue
    if (isStation(place.title)) {
      if (stationKept) continue
      stationKept = true
    } else if (isSchool(place.title)) {
      if (schoolKept) continue
      schoolKept = true
    }
    out.push(place)
  }
  return out
}
