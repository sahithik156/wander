/**
 * Orders tour stops as a one-way nearest-neighbor route: start at the pin and
 * always walk to the nearest unvisited stop. The tour ends at the last stop;
 * there is no return leg. Pure; ties keep the input order.
 */

import { distanceMeters, pathLengthMeters, type LatLng } from '../lib/geo'
import { budgetMeters } from '../lib/route-budget'

export function orderNearestNeighbor<T extends LatLng>(pin: LatLng, stops: T[]): T[] {
  const left = [...stops]
  const out: T[] = []
  let here: LatLng = pin
  while (left.length > 0) {
    let best = 0
    let bestDist = Infinity
    left.forEach((stop, i) => {
      const d = distanceMeters(here, stop)
      if (d < bestDist) {
        best = i
        bestDist = d
      }
    })
    const [next] = left.splice(best, 1)
    out.push(next)
    here = next
  }
  return out
}

export interface TrimResult<T> {
  /** Kept stops in walking order. `meters` runs from the first stop to the last. */
  stops: T[]
  dropped: T[]
  meters: number
  budget: number
  /** False when even `minStops` stops are longer than the budget. */
  fits: boolean
}

/**
 * Drops stops until the one-way route fits the time budget, but never below
 * `minStops`. Each round removes the stop whose removal shortens the route
 * most (ties: the lower-ranked one, i.e. later in `ranked`), then reorders.
 * The budget grows as stops are dropped, since less time goes to stops.
 */
export function trimToBudget<T extends LatLng>(
  pin: LatLng,
  ranked: T[],
  minutes: number,
  minStops: number,
): TrimResult<T> {
  let kept = [...ranked]
  const dropped: T[] = []
  let ordered = orderNearestNeighbor(pin, kept)
  // The walk from the pin to the first stop doesn't count against the budget.
  let meters = pathLengthMeters(ordered)
  while (meters > budgetMeters(minutes, kept.length) && kept.length > minStops) {
    let bestIndex = -1
    let bestMeters = Infinity
    kept.forEach((_, i) => {
      const without = kept.filter((__, j) => j !== i)
      const m = pathLengthMeters(orderNearestNeighbor(pin, without))
      if (m <= bestMeters) {
        bestIndex = i
        bestMeters = m
      }
    })
    dropped.push(kept[bestIndex])
    kept = kept.filter((_, j) => j !== bestIndex)
    ordered = orderNearestNeighbor(pin, kept)
    meters = pathLengthMeters(ordered)
  }
  const budget = budgetMeters(minutes, kept.length)
  return { stops: ordered, dropped, meters, budget, fits: meters <= budget }
}
