/**
 * Google Maps places through the platform serpapi/places-search integration
 * (worker only, billed to the app owner, $0.0325 per call). Called only where
 * Wikipedia is thin; see build-tour.ts for when.
 */

import type { CronContext } from 'deepspace/worker'
import type { LatLng } from '../lib/geo'
import type { TourTheme } from '../schemas/tours-schema'
import { parseMapsResults, themeQuery, type MapsPlace } from './maps-places'
import { withDeadline } from './deadline'

const SERPAPI_TIMEOUT_MS = 20_000

/** Map zoom for SerpApi's `ll`: the viewport should roughly cover the radius. */
const zoomFor = (radiusMeters: number) => (radiusMeters <= 1500 ? 15 : 14)

export async function searchMapsPlaces(
  integrations: CronContext['integrations'],
  pin: LatLng,
  radiusMeters: number,
  theme: TourTheme,
): Promise<MapsPlace[]> {
  const data = await withDeadline(
    integrations.call('serpapi/places-search', {
      q: themeQuery(theme),
      ll: `@${pin.lat},${pin.lng},${zoomFor(radiusMeters)}z`,
      hl: 'en',
    }),
    SERPAPI_TIMEOUT_MS,
    'Google Maps search',
  )
  return parseMapsResults(data)
}
