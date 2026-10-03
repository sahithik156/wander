import { describe, expect, it } from 'vitest'
import { MAX_CANDIDATES, dropNearDuplicates, mergePlaces, ringPoints, sampleByBands, shouldSearchRing } from './candidates'
import { destinationPoint, distanceMeters } from '../lib/geo'
import type { Place } from './wikipedia'

const pin = { lat: 51.5074, lng: -0.1278 }
const R = 1500

/** A place `dist` meters north of the pin. */
const at = (pageid: number, dist: number): Place => ({
  pageid,
  title: `P${pageid}`,
  ...destinationPoint(pin, 0, dist),
  dist,
})
/** n places evenly spread from `from` up to (not including) `to` meters. */
const spread = (startId: number, n: number, from: number, to: number) =>
  Array.from({ length: n }, (_, i) => at(startId + i, from + ((to - from) * i) / n))
const bandCounts = (places: Place[]) => {
  const c = [0, 0, 0]
  for (const p of places) c[Math.min(2, Math.floor((p.dist / R) * 3))]++
  return c
}

describe('shouldSearchRing', () => {
  it('searches the ring only when the center search hit the limit', () => {
    expect(shouldSearchRing(0, 150)).toBe(false)
    expect(shouldSearchRing(149, 150)).toBe(false)
    expect(shouldSearchRing(150, 150)).toBe(true)
  })
})

describe('ringPoints', () => {
  it('returns 6 points at 2/3 of the radius', () => {
    const pts = ringPoints(pin, R)
    expect(pts).toHaveLength(6)
    for (const p of pts) expect(distanceMeters(pin, p)).toBeCloseTo(1000, 0)
  })
})

describe('mergePlaces', () => {
  it('dedupes by pageid, recomputes distance, drops places beyond the radius', () => {
    const fromRing = { ...at(1, 100), dist: 5 } // dist from a ring center, not the pin
    const merged = mergePlaces([[fromRing, at(2, 1400)], [at(1, 100), at(3, 1600), at(4, 700)]], pin, R)
    expect(merged.map((p) => p.pageid)).toEqual([1, 4, 2])
    expect(merged[0].dist).toBeCloseTo(100, 0)
  })

  it('handles empty input', () => {
    expect(mergePlaces([], pin, R)).toEqual([])
    expect(mergePlaces([[], []], pin, R)).toEqual([])
  })
})

describe('dropNearDuplicates', () => {
  it('drops a stop within 50 m of an earlier one, keeping the higher-ranked', () => {
    const abbey = { id: 'abbey', ...destinationPoint(pin, 0, 500) }
    const chapter = { id: 'chapter house', ...destinationPoint(abbey, 90, 30) }
    const square = { id: 'square', ...destinationPoint(pin, 0, 100) }
    expect(dropNearDuplicates([abbey, square, chapter]).map((p) => p.id)).toEqual(['abbey', 'square'])
    expect(dropNearDuplicates([chapter, abbey, square]).map((p) => p.id)).toEqual(['chapter house', 'square'])
  })

  it('keeps stops 50 m or more apart, and handles empty input', () => {
    const a = { id: 'a', ...pin }
    const b = { id: 'b', ...destinationPoint(pin, 0, 51) }
    expect(dropNearDuplicates([a, b]).map((p) => p.id)).toEqual(['a', 'b'])
    expect(dropNearDuplicates([])).toEqual([])
  })
})

describe('sampleByBands', () => {
  it('splits evenly across three full bands', () => {
    const places = [...spread(1, 100, 0, 500), ...spread(200, 100, 500, 1000), ...spread(400, 100, 1000, 1500)]
    const out = sampleByBands(places, R)
    expect(out).toHaveLength(MAX_CANDIDATES)
    expect(bandCounts(out)).toEqual([13, 13, 14]) // the remainder goes to the outer band
  })

  it('spreads picks within a band instead of taking only the nearest', () => {
    const out = sampleByBands(spread(1, 100, 0, 500), R, 10)
    expect(out[out.length - 1].dist).toBeGreaterThan(400)
  })

  it('gives a short band’s unused share to the other bands', () => {
    const places = [...spread(1, 100, 0, 500), ...spread(200, 5, 500, 1000)]
    const out = sampleByBands(places, R)
    expect(out).toHaveLength(MAX_CANDIDATES)
    expect(bandCounts(out)).toEqual([35, 5, 0])
  })

  it('returns everything when there are fewer places than the max', () => {
    const places = spread(1, 12, 0, 1500)
    expect(sampleByBands(places, R).map((p) => p.pageid)).toEqual(places.map((p) => p.pageid))
  })

  it('never duplicates and returns nothing for empty input', () => {
    expect(sampleByBands([], R)).toEqual([])
    const out = sampleByBands([...spread(1, 50, 0, 500), ...spread(100, 50, 1000, 1500)], R)
    expect(out).toHaveLength(MAX_CANDIDATES)
    expect(new Set(out.map((p) => p.pageid)).size).toBe(out.length)
  })
})
