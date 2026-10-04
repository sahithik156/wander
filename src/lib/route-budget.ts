/**
 * How far a tour can walk. Shared by the build-tour job (which trims stops to
 * fit) and the UI (which flags a tour that still doesn't fit).
 *
 * Time at stops comes out of the tour length; the rest is walking at
 * WALK_KMH. Streets are about STREET_FACTOR longer than the straight lines we
 * measure, so the budget is in straight-line meters like `pathLengthMeters`
 * (first stop to last; the walk from the pin to the first stop isn't counted).
 * 60 min with 5 stops: 45 min walking = 3.4 km on streets = 2.6 km straight.
 */

export const MINUTES_PER_STOP = 3
/** Food stops take longer: you sit down and eat (SPEC.md "Food theme"). */
export const FOOD_MINUTES_PER_STOP = 10
export const WALK_KMH = 4.5
export const STREET_FACTOR = 1.3

/** Straight-line meters a one-way tour of `minutes` with `stops` stops can cover. */
export function budgetMeters(minutes: number, stops: number, minutesPerStop = MINUTES_PER_STOP): number {
  const walkingMinutes = Math.max(0, minutes - stops * minutesPerStop)
  return ((walkingMinutes / 60) * WALK_KMH * 1000) / STREET_FACTOR
}
