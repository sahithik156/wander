import { describe, expect, it } from 'vitest'
import { validateTour } from './tour-validation'

describe('validateTour', () => {
  it('accepts valid tours, including the coordinate limits', () => {
    expect(validateTour({ minutes: 30, lat: 51.5, lng: -0.12 })).toBeNull()
    expect(validateTour({ minutes: 60, lat: -90, lng: 180 })).toBeNull()
    expect(validateTour({ minutes: 90, lat: 90, lng: -180 })).toBeNull()
  })

  it('rejects lengths other than 30, 60, 90', () => {
    for (const minutes of [0, 45, 120, NaN, '60' as unknown as number]) {
      expect(validateTour({ minutes, lat: 0, lng: 0 })).toMatch(/length/)
    }
  })

  it('rejects out-of-range or non-finite coordinates', () => {
    expect(validateTour({ minutes: 30, lat: 90.1, lng: 0 })).toMatch(/latitude/)
    expect(validateTour({ minutes: 30, lat: -91, lng: 0 })).toMatch(/latitude/)
    expect(validateTour({ minutes: 30, lat: NaN, lng: 0 })).toMatch(/latitude/)
    expect(validateTour({ minutes: 30, lat: 0, lng: 180.5 })).toMatch(/longitude/)
    expect(validateTour({ minutes: 30, lat: 0, lng: -181 })).toMatch(/longitude/)
    expect(validateTour({ minutes: 30, lat: 0, lng: Infinity })).toMatch(/longitude/)
  })
})
