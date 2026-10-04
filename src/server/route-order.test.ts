import { describe, expect, it } from 'vitest'
import { orderNearestNeighbor, trimToBudget } from './route-order'
import { destinationPoint } from '../lib/geo'

const pin = { lat: 51.5074, lng: -0.1278 }
const stop = (id: string, bearing: number, meters: number) => ({ id, ...destinationPoint(pin, bearing, meters) })
const ids = (s: { id: string }[]) => s.map((x) => x.id)

describe('orderNearestNeighbor', () => {
  it('starts at the stop nearest the pin and walks to the nearest unvisited stop', () => {
    const a = stop('a', 0, 200) // north, near
    const b = stop('b', 0, 600) // north, further
    const c = stop('c', 90, 500) // east
    const d = stop('d', 180, 300) // south
    // From the pin: a (200 m). From a: b (400 m) beats d (500 m). From b: c, then d.
    expect(ids(orderNearestNeighbor(pin, [c, d, b, a]))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores the way back: the route ends at the last stop, wherever it is', () => {
    const near = stop('near', 0, 100)
    const mid = stop('mid', 0, 400)
    const far = stop('far', 0, 1200)
    expect(ids(orderNearestNeighbor(pin, [far, mid, near]))).toEqual(['near', 'mid', 'far'])
  })

  it('returns a permutation of the input', () => {
    const stops = [0, 45, 90, 135, 180, 225, 270, 315].map((b, i) => stop(`s${i}`, b, 100 + i * 150))
    expect(ids(orderNearestNeighbor(pin, stops)).sort()).toEqual(ids(stops).sort())
  })

  it('handles empty input, a single stop, and ties in input order', () => {
    expect(orderNearestNeighbor(pin, [])).toEqual([])
    const only = stop('only', 0, 100)
    expect(orderNearestNeighbor(pin, [only])).toEqual([only])
    // Two stops at exactly the same spot: the first one listed wins.
    const first = stop('first', 90, 300)
    const second = { ...first, id: 'second' }
    expect(ids(orderNearestNeighbor(pin, [first, second]))).toEqual(['first', 'second'])
    expect(ids(orderNearestNeighbor(pin, [second, first]))).toEqual(['second', 'first'])
  })
})

describe('trimToBudget', () => {
  it('keeps every stop when the route already fits', () => {
    const stops = [0, 72, 144, 216, 288].map((b, i) => stop(`s${i}`, b, 200))
    const out = trimToBudget(pin, stops, 60, 4)
    expect(out.dropped).toEqual([])
    expect(out.stops).toHaveLength(5)
    expect(out.fits).toBe(true)
  })

  it('drops the far-flung stop that costs the most distance', () => {
    const near = [100, 200, 300, 400].map((m, i) => stop(`near${i}`, 0, m))
    const far = stop('far', 90, 3000)
    const out = trimToBudget(pin, [near[0], far, near[1], near[2], near[3]], 60, 4)
    expect(ids(out.dropped)).toEqual(['far'])
    expect(ids(out.stops)).toEqual(['near0', 'near1', 'near2', 'near3'])
    expect(out.fits).toBe(true)
    expect(out.meters).toBeLessThanOrEqual(out.budget)
  })

  it('never goes below the minimum, and reports when the route still does not fit', () => {
    const spread = [0, 90, 180, 270].map((b, i) => stop(`s${i}`, b, 1500))
    const extra = stop('extra', 45, 1500)
    const out = trimToBudget(pin, [...spread, extra], 60, 4)
    expect(out.stops).toHaveLength(4)
    expect(out.dropped).toHaveLength(1)
    expect(out.fits).toBe(false)
    expect(out.meters).toBeGreaterThan(out.budget)
  })

  it('can trim down to a minimum of 3 stops', () => {
    const spread = [0, 90, 180, 270, 45].map((b, i) => stop(`s${i}`, b, 1500))
    const out = trimToBudget(pin, spread, 60, 3)
    expect(out.stops).toHaveLength(3)
    expect(out.dropped).toHaveLength(2)
  })
})
