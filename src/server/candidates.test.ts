import { describe, expect, it } from 'vitest'
import { MAX_CANDIDATES, widenRadii, dropSameSite, mergePlaces, ringPoints, sampleByBands, shouldSearchRing } from './candidates'
import { destinationPoint, distanceMeters } from '../lib/geo'
import type { Place } from './wikipedia'

const pin = { lat: 51.5074, lng: -0.1278 }
const ll = (p: { lat: number; lng: number }): [number, number] => [p.lat, p.lng]
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

describe('widenRadii', () => {
  it('tries the base radius, then 1.5x, then 2x', () => {
    expect(widenRadii(1500)).toEqual([1500, 2250, 3000])
    expect(widenRadii(800)).toEqual([800, 1200, 1600])
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

describe('dropSameSite', () => {
  const w = (id: string, lat: number, lng: number) => ({ id, source: 'wikipedia' as const, lat, lng })
  const m = (id: string, lat: number, lng: number) => ({ id, source: 'maps' as const, lat, lng })
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

  it('Warangal Fort: drops the Maps gateway 65 m from the fort; Kush Mahal (180-244 m away) stays', () => {
    // Real coordinates from the coverage run, in the model's ranking order.
    const baavi = m('Anthastula Baavi', 17.9689177, 79.599715)
    const kush = m('Kush Mahal', 17.956231, 79.6130842)
    const gate = m('Kaakatiya Kalaa Thoranam 1', 17.9563742, 79.6147811)
    const fort = m('Warangal Fort', 17.9562932, 79.6153916)
    expect(ids(dropSameSite([baavi, kush, gate, fort]))).toEqual(['Anthastula Baavi', 'Kush Mahal', 'Kaakatiya Kalaa Thoranam 1'])
  })

  it('Fasil Ghebbi: drops the Maps chapel 62 m away and keeps the Wikipedia stop, whatever the ranking', () => {
    const battle = w('Battle of Gondar', 12.6, 37.4666667)
    const fasil = w('Fasil Ghebbi', 12.6075, 37.47)
    const chapel = m("Emperor's Chapel", 12.6079065, 37.4703876)
    expect(ids(dropSameSite([battle, fasil, chapel]))).toEqual(['Battle of Gondar', 'Fasil Ghebbi'])
    expect(ids(dropSameSite([chapel, battle, fasil]))).toEqual(['Battle of Gondar', 'Fasil Ghebbi'])
  })

  it('keeps the 50 m rule for Wikipedia-only pairs', () => {
    const abbey = w('abbey', ...ll(destinationPoint(pin, 0, 500)))
    const chapter = w('chapter house', ...ll(destinationPoint(abbey, 90, 30)))
    const nearby = w('nearby church', ...ll(destinationPoint(abbey, 90, 120)))
    // 30 m: same spot, later-ranked goes. 120 m between Wikipedia stops: both stay.
    expect(ids(dropSameSite([abbey, chapter, nearby]))).toEqual(['abbey', 'nearby church'])
    expect(ids(dropSameSite([chapter, abbey]))).toEqual(['chapter house'])
  })

  it('keeps Maps stops 150 m or more from everything, and handles empty input', () => {
    const a = m('a', pin.lat, pin.lng)
    const b = m('b', ...ll(destinationPoint(pin, 0, 151)))
    expect(ids(dropSameSite([a, b]))).toEqual(['a', 'b'])
    expect(dropSameSite([])).toEqual([])
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
