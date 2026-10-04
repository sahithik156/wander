import { describe, expect, it } from 'vitest'
import { budgetMeters } from './route-budget'

describe('budgetMeters', () => {
  it('takes stop time out of the tour and converts walking time to straight-line meters', () => {
    // 60 min, 5 stops: 45 min at 4.5 km/h = 3375 m on streets, / 1.3 straight-line.
    expect(budgetMeters(60, 5)).toBeCloseTo(3375 / 1.3, 0)
  })

  it('allows 10 minutes per stop for food tours', () => {
    // 60 min, 4 food stops: 20 min at 4.5 km/h = 1500 m on streets, / 1.3 straight-line.
    expect(budgetMeters(60, 4, 10)).toBeCloseTo(1500 / 1.3, 0)
  })

  it('grows as stops are dropped, and never goes negative', () => {
    expect(budgetMeters(60, 4)).toBeGreaterThan(budgetMeters(60, 5))
    expect(budgetMeters(30, 20)).toBe(0)
  })
})
