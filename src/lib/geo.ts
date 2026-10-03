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
 * Straight-line length of the one-way route pin -> stops in order (it ends at
 * the last stop; no walk back). Real walking is longer (streets aren't
 * straight), so the UI labels it "≈".
 */
export function routeLengthMeters(pin: LatLng, stops: LatLng[]): number {
  const points = [pin, ...stops]
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i])
  return total
}
