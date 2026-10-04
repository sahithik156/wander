import { describe, expect, it } from 'vitest'
import { bearingDegrees, compassDirection, destinationPoint, distanceMeters, pathLengthMeters, walkingDistance } from './geo'

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

  it('pathLengthMeters runs from the first stop to the last, not from the pin', () => {
    expect(pathLengthMeters([])).toBe(0)
    const a = destinationPoint(pin, 0, 500)
    expect(pathLengthMeters([a])).toBe(0)
    const b = destinationPoint(a, 0, 300)
    expect(pathLengthMeters([a, b])).toBeCloseTo(300, 0)
  })

  it('gives the bearing and eight-point compass direction', () => {
    expect(bearingDegrees(pin, destinationPoint(pin, 120, 500))).toBeCloseTo(120, 0)
    expect(compassDirection(pin, destinationPoint(pin, 0, 300))).toBe('north')
    expect(compassDirection(pin, destinationPoint(pin, 225, 300))).toBe('southwest')
    expect(compassDirection(pin, destinationPoint(pin, 100, 300))).toBe('east')
    expect(compassDirection(pin, destinationPoint(pin, 350, 300))).toBe('north')
  })
})

describe('walkingDistance', () => {
  it('rounds to walking-friendly numbers', () => {
    expect(walkingDistance(4)).toBe('10 meters')
    expect(walkingDistance(64)).toBe('60 meters')
    expect(walkingDistance(189)).toBe('200 meters')
    expect(walkingDistance(883)).toBe('900 meters')
    expect(walkingDistance(1000)).toBe('1 km')
    expect(walkingDistance(1975)).toBe('2 km')
    expect(walkingDistance(1249)).toBe('1.2 km')
  })
})
