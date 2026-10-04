/**
 * Google Maps places through the platform serpapi/places-search integration
 * (worker only, billed to the app owner, $0.0325 per call). Called only where
 * Wikipedia is thin; see build-tour.ts for when.
 */

import type { CronContext } from 'deepspace/worker'
import type { LatLng } from '../lib/geo'
import { parseMapsResults, type MapsPlace } from './maps-places'
import { withDeadline } from './deadline'

const SERPAPI_TIMEOUT_MS = 20_000

/** Map zoom for SerpApi's `ll`: the viewport should roughly cover the radius. */
const zoomFor = (radiusMeters: number) => (radiusMeters <= 1500 ? 15 : 14)

export async function searchMapsPlaces(
  integrations: CronContext['integrations'],
  pin: LatLng,
  radiusMeters: number,
  /** From THEME_CONFIG (theme-config.ts). */
  query: string,
): Promise<MapsPlace[]> {
  const data = await withDeadline(
    integrations.call('serpapi/places-search', {
      q: query,
      ll: `@${pin.lat},${pin.lng},${zoomFor(radiusMeters)}z`,
      hl: 'en',
    }),
    SERPAPI_TIMEOUT_MS,
    'Google Maps search',
  )
  // A comma-list query can come back as one place, or as an empty result.
  const reply = (data ?? {}) as { local_results?: unknown; place_results?: { title?: string }; error?: string }
  if (!reply.local_results) {
    console.warn(
      `[maps] "${query}" returned no list: ${reply.place_results ? `one place (${reply.place_results.title})` : reply.error ?? 'empty'}`,
    )
  }
  return parseMapsResults(data)
}
