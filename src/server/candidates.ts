/**
 * Candidate selection before the AI step. Pure, so it is unit-testable.
 *
 * Geosearch returns places nearest-first and stops at its result limit, so in
 * a dense area (central London) 150 results reach only ~300 m of a 1500 m
 * radius. To cover the whole radius the job searches the pin and, only when
 * that search was cut off, 6 more points on a ring (`ringPoints`). The merged
 * results are then sampled evenly from three distance bands.
 */

import { destinationPoint, distanceMeters, type LatLng } from '../lib/geo'
import type { Place } from './wikipedia'

export const MAX_CANDIDATES = 40
export const RING_POINTS = 6

/**
 * A center search that returned fewer results than the limit already holds
 * every place in the radius (sparse area); one that hit the limit was cut off,
 * so the ring is needed.
 */
export function shouldSearchRing(centerCount: number, limit: number): boolean {
  return centerCount >= limit
}

/** RING_POINTS points at 2/3 of the radius, evenly spaced, starting north. */
export function ringPoints(pin: LatLng, radiusMeters: number): LatLng[] {
  return Array.from({ length: RING_POINTS }, (_, i) =>
    destinationPoint(pin, (360 / RING_POINTS) * i, (radiusMeters * 2) / 3),
  )
}

const byDist = (a: Place, b: Place) => a.dist - b.dist || a.pageid - b.pageid

/**
 * Merges several geosearch result lists: dedupes by pageid, recomputes `dist`
 * from the pin (ring results carry distance from their own center), drops
 * anything beyond the radius, and sorts nearest first.
 */
export function mergePlaces(lists: Place[][], pin: LatLng, radiusMeters: number): Place[] {
  const byId = new Map<number, Place>()
  for (const list of lists) {
    for (const place of list) {
      if (byId.has(place.pageid)) continue
      const dist = distanceMeters(pin, place)
      if (dist > radiusMeters) continue
      byId.set(place.pageid, { ...place, dist })
    }
  }
  return [...byId.values()].sort(byDist)
}

/** Two chosen stops closer than this are treated as the same spot. */
export const NEAR_DUPLICATE_METERS = 50

/**
 * Drops any place within `minMeters` of a place kept earlier in the list, so
 * the model's higher-ranked choice wins (for example two parts of one abbey).
 */
export function dropNearDuplicates<T extends LatLng>(ranked: T[], minMeters = NEAR_DUPLICATE_METERS): T[] {
  const kept: T[] = []
  for (const place of ranked) {
    if (kept.every((k) => distanceMeters(k, place) >= minMeters)) kept.push(place)
  }
  return kept
}

/**
 * Picks up to `max` places spread across the radius. Places are split into
 * inner / middle / outer thirds of the radius by `dist`; each band gets an
 * equal share, and share a short band can't use goes to the others. Within a
 * band the picks are evenly spaced by distance rank, not just the nearest.
 * Returns places sorted nearest first.
 */
export function sampleByBands(places: Place[], radiusMeters: number, max = MAX_CANDIDATES): Place[] {
  const bands: Place[][] = [[], [], []]
  for (const place of [...places].sort(byDist)) {
    const band = Math.min(2, Math.max(0, Math.floor((place.dist / radiusMeters) * 3)))
    bands[band].push(place)
  }

  const alloc = [0, 0, 0]
  let left = Math.min(max, places.length)
  while (left > 0) {
    // Outer bands first, so a remainder of 1-2 goes away from the pin.
    const open = [2, 1, 0].filter((b) => alloc[b] < bands[b].length)
    const share = Math.max(1, Math.floor(left / open.length))
    for (const b of open) {
      const give = Math.min(share, bands[b].length - alloc[b], left)
      alloc[b] += give
      left -= give
      if (left === 0) break
    }
  }

  const out: Place[] = []
  bands.forEach((band, b) => {
    const k = alloc[b]
    for (let i = 0; i < k; i++) out.push(band[Math.floor((i * band.length) / k)])
  })
  return out.sort(byDist)
}
