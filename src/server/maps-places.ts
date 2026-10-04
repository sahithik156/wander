/**
 * Google Maps places (serpapi/places-search) as a fallback where Wikipedia is
 * thin. Pure, so it is unit-testable; the worker call is in maps.ts.
 *
 * SerpApi reply (checked live for Vijayawada): `local_results[]` with title,
 * place_id, gps_coordinates {latitude, longitude}, type, types[], address,
 * rating, reviews, and sometimes description (3 of 20 had one).
 */

import { distanceMeters, type LatLng } from '../lib/geo'
import type { TourTheme } from '../schemas/tours-schema'
import type { Candidate } from './candidate'
import { isOrganizationTitle } from './wikipedia'

export interface MapsPlace {
  placeId: string
  title: string
  lat: number
  lng: number
  type?: string
  types: string[]
  address?: string
  rating?: number
  reviews?: number
  description?: string
}

const THEME_QUERY: Record<TourTheme, string> = {
  history: 'historical landmarks, temples, monuments',
  architecture: 'historic buildings and architecture',
  art: 'art galleries, museums, public art',
  'surprise me': 'tourist attractions and landmarks',
}

export const themeQuery = (theme: TourTheme): string => THEME_QUERY[theme] ?? THEME_QUERY['surprise me']

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Reads `local_results` (or a single `place_results`); skips rows without an id, name, or coordinates. */
export function parseMapsResults(data: unknown): MapsPlace[] {
  if (typeof data !== 'object' || data === null) return []
  const d = data as { local_results?: unknown; place_results?: unknown }
  const rows = Array.isArray(d.local_results) ? d.local_results : d.place_results ? [d.place_results] : []
  const out: MapsPlace[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue
    const r = row as Record<string, unknown>
    const gps = (r.gps_coordinates ?? {}) as Record<string, unknown>
    const placeId = str(r.place_id)
    // Some Maps names use a backtick for an apostrophe ("Emperor`s Chapel").
    const title = str(r.title)?.replace(/`/g, "'")
    const lat = num(gps.latitude)
    const lng = num(gps.longitude)
    if (!placeId || !title || lat === undefined || lng === undefined) continue
    out.push({
      placeId,
      title,
      lat,
      lng,
      type: str(r.type),
      types: Array.isArray(r.types) ? r.types.filter((t): t is string => typeof t === 'string') : [],
      address: str(r.address),
      rating: num(r.rating),
      reviews: num(r.reviews),
      description: str(r.description),
    })
  }
  return out
}

/** Lowercase word tokens with accents removed ("Café & Bar" -> ["cafe", "bar"]). */
const tokens = (s: string): string[] =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Food, drink, retail, and lodging. Matched as whole words / word sequences only. */
const BLOCKED_TYPE_WORDS: string[][] = [
  'restaurant', 'restaurants', 'cafe', 'coffee', 'bakery', 'sweet', 'sweets', 'bar', 'pub', 'food',
  'diner', 'eatery', 'dhaba', 'shop', 'store', 'mall', 'supermarket', 'boutique', 'hotel', 'motel',
  'lodge', 'resort', 'hostel', 'inn',
]
  .map((w) => [w])
  .concat([['guest', 'house'], ['ice', 'cream']])

function hasBlockedWord(text: string): boolean {
  const t = tokens(text)
  return BLOCKED_TYPE_WORDS.some((seq) => t.some((_, i) => seq.every((w, j) => t[i + j] === w)))
}

/** True when the place's Google type marks it as food, drink, retail, or lodging. */
export function isUnwantedType(place: Pick<MapsPlace, 'type' | 'types'>): boolean {
  return [place.type ?? '', ...place.types].some(hasBlockedWord)
}

/** Drops unwanted types, organizations, and anything farther from the pin than the radius. */
export function filterMapsPlaces(places: MapsPlace[], pin: LatLng, radiusMeters: number): MapsPlace[] {
  return places.filter(
    (p) => !isUnwantedType(p) && !isOrganizationTitle(p.title) && distanceMeters(pin, p) <= radiusMeters,
  )
}

/** For same-place matching across sources: no accents, case, punctuation, parentheses, or "the". */
export function normalizeName(s: string): string {
  return tokens(s.replace(/\([^)]*\)/g, ' '))
    .filter((w) => w !== 'the')
    .join(' ')
}

export const mapsLink = (p: Pick<MapsPlace, 'title' | 'placeId'>): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.title)}&query_place_id=${encodeURIComponent(p.placeId)}`

export function mapsCandidate(p: MapsPlace, pin: LatLng): Candidate {
  return {
    id: `m:${p.placeId}`,
    source: 'maps',
    title: p.title,
    lat: p.lat,
    lng: p.lng,
    dist: distanceMeters(pin, p),
    text: p.description ?? '',
    category: p.type ?? p.types[0],
    address: p.address,
    rating: p.rating,
    reviews: p.reviews,
    externalId: p.placeId,
    link: mapsLink(p),
  }
}

/** A maps place this close to a Wikipedia place is treated as the same place. */
export const SAME_PLACE_METERS = 50

/**
 * Wikipedia candidates, plus the maps candidates that are not already covered:
 * a maps place is dropped if a Wikipedia place has the same normalized name or
 * is within SAME_PLACE_METERS (the Wikipedia one is kept), and duplicate maps
 * places are dropped.
 */
export function mergeSources(wiki: Candidate[], maps: Candidate[]): Candidate[] {
  const wikiNames = new Set(wiki.map((w) => normalizeName(w.title)))
  const seen = new Set(wiki.map((w) => w.id))
  const out = [...wiki]
  for (const m of maps) {
    if (seen.has(m.id)) continue
    if (wikiNames.has(normalizeName(m.title))) continue
    if (wiki.some((w) => distanceMeters(w, m) < SAME_PLACE_METERS)) continue
    seen.add(m.id)
    out.push(m)
  }
  return out
}
