import { describe, expect, it } from 'vitest'
import { orderNearestNeighbor } from './route-order'
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
