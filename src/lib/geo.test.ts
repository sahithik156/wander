import { describe, expect, it } from 'vitest'
import { destinationPoint, distanceMeters, routeLengthMeters } from './geo'

const pin = { lat: 51.5074, lng: -0.1278 }

describe('geo', () => {
  it('measures distance with haversine', () => {
    expect(distanceMeters(pin, pin)).toBe(0)
    // One degree of latitude is ~111.2 km.
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2)
  })

  it('destinationPoint round-trips with distanceMeters', () => {
    for (const bearing of [0, 60, 135, 270]) {
      const p = destinationPoint(pin, bearing, 1000)
      expect(distanceMeters(pin, p)).toBeCloseTo(1000, 0)
    }
    expect(destinationPoint(pin, 0, 1000).lat).toBeGreaterThan(pin.lat)
    expect(destinationPoint(pin, 90, 1000).lng).toBeGreaterThan(pin.lng)
  })

  it('routeLengthMeters measures one way, ending at the last stop', () => {
    expect(routeLengthMeters(pin, [])).toBe(0)
    const a = destinationPoint(pin, 0, 500)
    expect(routeLengthMeters(pin, [a])).toBeCloseTo(500, 0)
    const b = destinationPoint(a, 0, 300)
    expect(routeLengthMeters(pin, [a, b])).toBeCloseTo(800, 0)
  })
})
