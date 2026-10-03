/**
 * Wikipedia geosearch — worker-side only (never imported by browser code).
 * The platform wikipedia integration has no geosearch, so this calls the
 * public API directly (see SPEC.md "Data source").
 */

import { mergePlaces, ringPoints, shouldSearchRing } from './candidates'
import type { LatLng } from '../lib/geo'

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

// ---------------------------------------------------------------------------
// Searching the whole radius (dense areas) and fetching intro extracts
// ---------------------------------------------------------------------------

/** Ring searches run at most this many at a time, to be polite to Wikipedia. */
const RING_CONCURRENCY = 3

export interface SearchResult {
  places: Place[]
  ringSearched: boolean
  ringFailures: number
}

/**
 * Geosearch covering the whole radius. The center search always runs, and its
 * failure fails the tour. Only when it hit GEOSEARCH_LIMIT (dense area, so the
 * results were cut off near the pin) do the 6 ring searches run; a failed ring
 * search is logged and skipped. Results are merged by `mergePlaces`.
 */
export async function searchAround(pin: LatLng, radiusMeters: number, signal?: AbortSignal): Promise<SearchResult> {
  const center = await geosearch(pin.lat, pin.lng, radiusMeters, signal)
  if (!shouldSearchRing(center.length, GEOSEARCH_LIMIT)) {
    return { places: mergePlaces([center], pin, radiusMeters), ringSearched: false, ringFailures: 0 }
  }

  // Each ring point sits at 2/3 R; half the radius around it reaches the edge.
  const ringRadius = Math.round(radiusMeters / 2)
  const points = ringPoints(pin, radiusMeters)
  const lists: Place[][] = [center]
  let ringFailures = 0
  for (let i = 0; i < points.length; i += RING_CONCURRENCY) {
    const batch = points.slice(i, i + RING_CONCURRENCY)
    const settled = await Promise.allSettled(batch.map((p) => geosearch(p.lat, p.lng, ringRadius, signal)))
    settled.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        lists.push(result.value)
      } else {
        ringFailures++
        const p = batch[j]
        console.warn(`[wikipedia] ring geosearch at ${p.lat.toFixed(5)},${p.lng.toFixed(5)} failed: ${String(result.reason)}`)
      }
    })
  }
  return { places: mergePlaces(lists, pin, radiusMeters), ringSearched: true, ringFailures }
}

/** Intro extracts are limited to 20 pages per request by the API. */
export const EXTRACT_BATCH = 20

interface ExtractsResponse {
  query?: { pages?: Array<{ pageid?: number; extract?: string; missing?: boolean }> }
  error?: { code?: string; info?: string }
}

/** Plain-text intro extracts by pageid, fetched in sequential batches of 20. */
export async function fetchExtracts(pageids: number[], signal?: AbortSignal): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  for (let i = 0; i < pageids.length; i += EXTRACT_BATCH) {
    const batch = pageids.slice(i, i + EXTRACT_BATCH)
    const params = new URLSearchParams({
      action: 'query',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      exlimit: String(EXTRACT_BATCH),
      pageids: batch.join('|'),
      format: 'json',
      formatversion: '2',
    })
    const res = await fetch(`${API}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal,
    })
    if (!res.ok) throw new Error(`Wikipedia extracts failed: HTTP ${res.status}`)
    const body = (await res.json()) as ExtractsResponse
    if (body.error) throw new Error(`Wikipedia extracts error: ${body.error.info ?? body.error.code}`)
    for (const page of body.query?.pages ?? []) {
      const text = page.extract?.trim()
      if (page.pageid !== undefined && text) out.set(page.pageid, text)
    }
  }
  return out
}
