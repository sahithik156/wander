/**
 * Small spherical-geometry helpers. Pure and free of worker imports, so both
 * the build-tour job and the browser (route length in the panel) use them.
 */

export interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_M = 6_371_000
const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** Great-circle (haversine) distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The point `meters` away from `origin` along `bearingDeg` (0 = north, 90 = east). */
export function destinationPoint(origin: LatLng, bearingDeg: number, meters: number): LatLng {
  const d = meters / EARTH_RADIUS_M
  const brng = toRad(bearingDeg)
  const lat1 = toRad(origin.lat)
  const lng1 = toRad(origin.lng)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng))
  const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 }
}

/**
 * Straight-line length of the tour from the first stop to the last, in order.
 * The walk from the pin to the first stop is not part of the tour (the panel
 * shows it separately). Real walking is longer (streets aren't straight), so
 * the UI labels it "≈".
 */
export function pathLengthMeters(stops: LatLng[]): number {
  let total = 0
  for (let i = 1; i < stops.length; i++) total += distanceMeters(stops[i - 1], stops[i])
  return total
}

/** Rounded for walking: nearest 10 m under 100 m, nearest 50 m under 1 km, else 0.1 km. */
export function walkingDistance(meters: number): string {
  if (meters < 100) return `${Math.max(10, Math.round(meters / 10) * 10)} meters`
  if (meters < 1000) return `${Math.round(meters / 50) * 50} meters`
  return `${(Math.round(meters / 100) / 10).toFixed(1).replace(/\.0$/, '')} km`
}

/** Initial compass bearing from a to b in degrees (0 = north, 90 = east). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

/** Eight-point compass direction from a to b, e.g. "southwest". */
export function compassDirection(a: LatLng, b: LatLng): string {
  return COMPASS[Math.round(bearingDegrees(a, b) / 45) % 8]
}
