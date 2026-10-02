/** Pure tour validation, kept free of worker imports so it is unit-testable. */

import type { TourData } from '../schemas/tours-schema'
import { RADIUS_METERS } from './wikipedia'

/** Returns an error message for an invalid tour, or null when it is valid. */
export function validateTour(tour: Pick<TourData, 'minutes' | 'lat' | 'lng'>): string | null {
  const { minutes, lat, lng } = tour
  if (typeof minutes !== 'number' || !(minutes in RADIUS_METERS)) {
    return `Invalid tour length (${String(minutes)}): must be 30, 60, or 90 minutes.`
  }
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return `Invalid latitude (${String(lat)}): must be between -90 and 90.`
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return `Invalid longitude (${String(lng)}): must be between -180 and 180.`
  }
  return null
}
