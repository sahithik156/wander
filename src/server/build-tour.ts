/**
 * build-tour job — runs in the AppJobRoom (worker.ts) via src/jobs.ts.
 *
 * Slice 1: Wikipedia geosearch near the pin -> code filters -> first 8
 * remaining places written as stops. No AI and no ordering yet, so the
 * `choosing` and `writing` statuses are not used. Stops are written one at a
 * time through the owner context so they stream to the UI over the normal
 * record subscription; the tour's `status` changes the same way.
 */

import { buildCronContext } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { TourData, TourStatus } from '../schemas/tours-schema'
import type { StopData } from '../schemas/stops-schema'
import { validateTour } from './tour-validation'
import { RADIUS_METERS, filterPlaces, geosearch, pageUrl } from './wikipedia'

export const MAX_STOPS = 8
/** SPEC: fewer than 4 valid stops -> too_few_places. */
export const MIN_STOPS = 4

interface Envelope<T> {
  recordId: string
  data: T
}

export async function buildTour(job: Job, jobCtx: JobContext, env: Env): Promise<unknown> {
  const { tourId } = (job.payload ?? {}) as { tourId?: unknown }
  if (typeof tourId !== 'string' || !tourId) throw new Error('build-tour: payload.tourId is required')
  // The SDK stamps enqueuedBy from the verified WebSocket session. Never fall
  // back to trusting the payload alone.
  if (!job.enqueuedBy) throw new Error('build-tour: job has no enqueuedBy; refusing to run')

  const records = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`).records

  // Only the enqueuing user's own tours are considered, so a tourId belonging
  // to someone else is simply "not found".
  const mine = (await records.query('tours', {
    where: { ownerId: job.enqueuedBy },
    limit: 1000,
  })) as Envelope<TourData>[]
  const tourRow = mine.find((r) => r.recordId === tourId)
  if (!tourRow) throw new Error(`build-tour: tour ${tourId} not found for user ${job.enqueuedBy}`)
  const tour = tourRow.data

  const setStatus = (status: TourStatus, errorMessage?: string) =>
    records.update('tours', tourId, errorMessage === undefined ? { status } : { status, errorMessage })

  // A re-enqueue must not duplicate stops.
  if (tour.status !== 'queued') return { skipped: `status is ${tour.status}` }

  const invalid = validateTour(tour)
  if (invalid) {
    await setStatus('failed', invalid)
    return { failed: invalid }
  }

  try {
    await setStatus('finding')
    jobCtx.progress(0.1, 'finding places')

    const found = await geosearch(tour.lat, tour.lng, RADIUS_METERS[tour.minutes], jobCtx.signal)
    const places = filterPlaces(found).slice(0, MAX_STOPS)

    if (places.length < MIN_STOPS) {
      await setStatus('too_few_places')
      return { stops: 0, found: found.length, status: 'too_few_places' }
    }

    for (const [i, place] of places.entries()) {
      const stop: StopData = {
        ownerId: tour.ownerId,
        tourId,
        order: i,
        pageid: place.pageid,
        name: place.title,
        lat: place.lat,
        lng: place.lng,
        sourceUrl: pageUrl(place.pageid),
        audioStatus: 'none',
        isPublic: tour.isPublic,
      }
      await records.create('stops', stop as unknown as Record<string, unknown>)
      jobCtx.progress(0.1 + (0.9 * (i + 1)) / places.length, `${i + 1}/${places.length} stops`)
    }

    await setStatus('done')
    return { stops: places.length, found: found.length, status: 'done' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setStatus('failed', `Could not build this tour: ${message}`)
    return { failed: message }
  }
}
