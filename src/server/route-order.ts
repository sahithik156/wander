/**
 * Orders tour stops as a one-way nearest-neighbor route: start at the pin and
 * always walk to the nearest unvisited stop. The tour ends at the last stop;
 * there is no return leg. Pure; ties keep the input order.
 */

import { distanceMeters, type LatLng } from '../lib/geo'

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
