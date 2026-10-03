/**
 * build-tour job — runs in the AppJobRoom (worker.ts) via src/jobs.ts.
 *
 * finding:  Wikipedia geosearch over the whole radius -> code filters ->
 *           up to 40 candidates spread across distance bands -> intro extracts.
 * choosing: Claude picks 5-8 stops; code drops invented/duplicate pageids,
 *           orders them as a one-way nearest-neighbor route from the pin, and writes
 *           the stops at once so they appear on the map.
 * writing:  Claude narrates each stop from its extract; code updates each stop
 *           and the tour title.
 *
 * Everything is written through the owner context, so stops and status
 * stream to the UI over the normal record subscriptions. Only "fewer than 4
 * places/stops" gives too_few_places; any Wikipedia or AI error gives failed.
 */

import { buildCronContext } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { TourData, TourStatus } from '../schemas/tours-schema'
import type { StopData } from '../schemas/stops-schema'
import { MAX_SELECTED, validateNarration, validateSelection } from './ai-json'
import { dropNearDuplicates, sampleByBands } from './candidates'
import { askJson } from './claude'
import { SELECT_EXTRACT_CHARS, narratePrompt, selectPrompt } from './prompts'
import { orderNearestNeighbor } from './route-order'
import { routeLengthMeters } from '../lib/geo'
import { validateTour } from './tour-validation'
import { RADIUS_METERS, fetchExtracts, filterPlaces, pageUrl, searchAround, type Place } from './wikipedia'

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

  const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const { records, integrations } = ctx

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

  const pin = { lat: tour.lat, lng: tour.lng }
  const radius = RADIUS_METERS[tour.minutes]

  try {
    // --- finding -----------------------------------------------------------
    await setStatus('finding')
    jobCtx.progress(0.05, 'finding places')

    const search = await searchAround(pin, radius, jobCtx.signal)
    const sampled = sampleByBands(filterPlaces(search.places), radius)
    const extracts = await fetchExtracts(
      sampled.map((p) => p.pageid),
      jobCtx.signal,
    )
    // A place with no intro text gives the narrator nothing to work from.
    const candidates = sampled.filter((p) => extracts.has(p.pageid))
    const found = {
      found: search.places.length,
      ringSearched: search.ringSearched,
      ringFailures: search.ringFailures,
      candidates: candidates.length,
    }
    if (candidates.length < MIN_STOPS) {
      await setStatus('too_few_places')
      return { ...found, status: 'too_few_places' }
    }

    // --- choosing ----------------------------------------------------------
    await setStatus('choosing')
    jobCtx.progress(0.3, 'choosing stops')

    const byId = new Map<number, Place>(candidates.map((p) => [p.pageid, p]))
    const selection = await askJson(
      integrations,
      selectPrompt(
        tour.theme,
        tour.minutes,
        candidates.map((p) => ({
          pageid: p.pageid,
          title: p.title,
          distance_m: Math.round(p.dist),
          extract: extracts.get(p.pageid)!.slice(0, SELECT_EXTRACT_CHARS),
        })),
      ),
      (obj) => validateSelection(obj, new Set(byId.keys())),
      'stop selection',
    )
    // Model order is its ranking, so near-duplicates lose to the earlier pick.
    const picked = selection.value.map((s) => byId.get(s.pageid)!)
    const chosen = dropNearDuplicates(picked).slice(0, MAX_SELECTED)
    if (chosen.length < MIN_STOPS) {
      await setStatus('too_few_places')
      return { ...found, picked: picked.length, chosen: chosen.length, selectMs: selection.ms, status: 'too_few_places' }
    }

    const ordered = orderNearestNeighbor(pin, chosen)
    const stopIds = new Map<number, string>()
    for (const [i, place] of ordered.entries()) {
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
      const created = (await records.create('stops', stop as unknown as Record<string, unknown>)) as { recordId: string }
      stopIds.set(place.pageid, created.recordId)
    }

    // --- writing -----------------------------------------------------------
    await setStatus('writing')
    jobCtx.progress(0.6, 'writing narration')

    const narration = await askJson(
      integrations,
      narratePrompt(
        tour.theme,
        tour.minutes,
        ordered.map((p, i) => ({ order: i + 1, pageid: p.pageid, title: p.title, extract: extracts.get(p.pageid)! })),
      ),
      (obj) =>
        validateNarration(
          obj,
          ordered.map((p) => p.pageid),
        ),
      'narration',
    )
    for (const [pageid, text] of narration.value.byPageid) {
      await records.update('stops', stopIds.get(pageid)!, { narration: text.narration, transition: text.transition })
    }
    if (narration.value.title) await records.update('tours', tourId, { title: narration.value.title })

    await setStatus('done')
    const result = {
      ...found,
      status: 'done',
      picked: picked.length,
      stops: ordered.length,
      routeMeters: Math.round(routeLengthMeters(pin, ordered)),
      timings: { selectMs: selection.ms, narrateMs: narration.ms },
      attempts: { select: selection.attempts, narrate: narration.attempts },
    }
    console.info(`[build-tour] ${tourId} ${JSON.stringify(result)}`)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[build-tour] ${tourId} failed: ${message}`)
    await setStatus('failed', `Could not build this tour: ${message}`)
    return { failed: message }
  }
}
