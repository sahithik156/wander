/**
 * build-tour job — runs in the AppJobRoom (worker.ts) via src/jobs.ts.
 *
 * finding:  Wikipedia geosearch over the whole radius -> code filters ->
 *           up to 40 candidates spread across distance bands -> intro extracts.
 *           Thin (< 8 candidates): widen to 1.5x, then 2x the radius. Still
 *           thin: one Google Maps search (serpapi/places-search), merged in.
 * choosing: Claude picks 5-8 stops; code drops invented/duplicate ids and
 *           near-duplicate places. If fewer than 5 remain and Maps hasn't been
 *           searched yet, search it once and pick again (thin areas only).
 *           Code orders the stops one way from the pin, drops stops until the
 *           route fits the time budget (never below 3), and writes them at
 *           once so they appear on the map.
 *           Code also writes each transition (direction and distance to the
 *           next stop) and the text of Maps stops (name, category, address,
 *           description restated), because the AI kept adding claims.
 * writing:  Claude narrates the Wikipedia stops from their extracts and titles
 *           the tour; code updates those stops and the title.
 *
 * Everything is written through the owner context, so stops and status
 * stream to the UI over the normal record subscriptions. Only "fewer than 3
 * places/stops" gives too_few_places; a Wikipedia or AI error gives failed;
 * a Maps error is logged and the tour continues with Wikipedia only.
 */

import { buildCronContext } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { TourData, TourStatus } from '../schemas/tours-schema'
import type { StopData } from '../schemas/stops-schema'
import { MAX_SELECTED, validateNarration, validateSelection } from './ai-json'
import type { Candidate } from './candidate'
import { THIN_CANDIDATES, dropSameSite, sampleByBands, widenRadii } from './candidates'
import { askJson } from './claude'
import { searchMapsPlaces } from './maps'
import { filterMapsPlaces, mapsCandidate, mergeSources } from './maps-places'
import { mapsNarration, mapsOnlyTitle, transitionText } from './narration-text'
import { SELECT_EXTRACT_CHARS, narratePrompt, selectPrompt } from './prompts'
import { trimToBudget } from './route-order'
import { distanceMeters } from '../lib/geo'
import { validateTour } from './tour-validation'
import { RADIUS_METERS, fetchExtracts, filterPlaces, searchAround, wikiCandidate } from './wikipedia'

/**
 * Fewer valid stops than this -> too_few_places; trimming never goes below it.
 * SPEC.md says 4; lowered to 3 because a 3-stop tour beats no tour in thin
 * areas (Warangal).
 */
export const MIN_STOPS = 3
/** Fewer chosen stops than this triggers the one-time Maps second chance... */
const SECOND_CHANCE_BELOW = 5
/**
 * ...but only where Wikipedia is thin. With this many candidates, a short
 * pick reflects quality, and Maps places were rarely used (Dubuque).
 */
const SECOND_CHANCE_MAX_WIKI = 20

interface Envelope<T> {
  recordId: string
  data: T
}

const countBySource = (cs: Candidate[]) => ({
  wikipedia: cs.filter((c) => c.source === 'wikipedia').length,
  maps: cs.filter((c) => c.source === 'maps').length,
})

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
  const started = Date.now()

  // Everything the job learns goes into one log line on every exit.
  let radius = RADIUS_METERS[tour.minutes]
  let serpapiCalls = 0
  let candidates: Candidate[] = []
  const log: Record<string, unknown> = {}
  const report = (status: string, extra: Record<string, unknown> = {}) => {
    const result = {
      status,
      radiusUsed: radius,
      serpapiCalls,
      candidates: countBySource(candidates),
      ...log,
      ...extra,
      totalMs: Date.now() - started,
    }
    console.info(`[build-tour] ${tourId} ${JSON.stringify(result)}`)
    return result
  }

  // One line per phase, so a job that never finishes still shows where it stopped.
  const phase = (name: string) => console.info(`[build-tour] ${tourId} phase=${name} t=${Date.now() - started}ms`)

  /** One Google Maps search, merged into `candidates`. Returns how many it added. */
  const addMaps = async (): Promise<number> => {
    serpapiCalls++
    phase('maps')
    try {
      const places = await searchMapsPlaces(integrations, pin, radius, tour.theme)
      const kept = filterMapsPlaces(places, pin, radius).map((p) => mapsCandidate(p, pin))
      const before = candidates.length
      candidates = mergeSources(candidates, kept)
      log.maps = { returned: places.length, kept: kept.length, added: candidates.length - before }
      return candidates.length - before
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[build-tour] ${tourId} serpapi failed, continuing with Wikipedia only: ${message}`)
      log.mapsError = message
      return 0
    }
  }

  const select = async () => {
    phase('select')
    const byId = new Map(candidates.map((c) => [c.id, c]))
    const selection = await askJson(
      integrations,
      selectPrompt(
        tour.theme,
        tour.minutes,
        candidates.map((c) => ({
          id: c.id,
          source: c.source,
          title: c.title,
          category: c.category,
          distance_m: Math.round(c.dist),
          text: c.text.slice(0, SELECT_EXTRACT_CHARS),
          rating: c.rating,
          reviews: c.reviews,
        })),
      ),
      (obj) => validateSelection(obj, new Set(byId.keys())),
      'stop selection',
    )
    // Model order is its ranking, so near-duplicates lose to the earlier pick.
    const picked = selection.value.map((s) => byId.get(s.id)!)
    return { picked, chosen: dropSameSite(picked).slice(0, MAX_SELECTED), ms: selection.ms }
  }

  try {
    // --- finding -----------------------------------------------------------
    await setStatus('finding')
    jobCtx.progress(0.05, 'finding places')

    phase('wikipedia')
    const extracts = new Map<number, string>()
    const noExtract = new Set<number>()
    for (const r of widenRadii(radius)) {
      radius = r
      const search = await searchAround(pin, r, jobCtx.signal)
      const sampled = sampleByBands(filterPlaces(search.places), r)
      const unseen = sampled.map((p) => p.pageid).filter((id) => !extracts.has(id) && !noExtract.has(id))
      const got = await fetchExtracts(unseen, jobCtx.signal)
      for (const id of unseen) {
        const text = got.get(id)
        if (text) extracts.set(id, text)
        else noExtract.add(id)
      }
      // A place with no intro text gives the narrator nothing to work from.
      candidates = sampled.filter((p) => extracts.has(p.pageid)).map((p) => wikiCandidate(p, extracts.get(p.pageid)!))
      log.wikipedia = { found: search.places.length, ringSearched: search.ringSearched, ringFailures: search.ringFailures }
      if (candidates.length >= THIN_CANDIDATES) break
    }
    if (candidates.length < THIN_CANDIDATES) await addMaps()

    if (candidates.length < MIN_STOPS) {
      await setStatus('too_few_places')
      return report('too_few_places')
    }

    // --- choosing ----------------------------------------------------------
    await setStatus('choosing')
    jobCtx.progress(0.3, 'choosing stops')

    let { picked, chosen, ms: selectMs } = await select()
    const timings: Record<string, number> = { selectMs }
    const wikiCandidates = countBySource(candidates).wikipedia
    if (chosen.length < SECOND_CHANCE_BELOW && serpapiCalls === 0 && wikiCandidates < SECOND_CHANCE_MAX_WIKI) {
      log.secondChance = { chosenBefore: chosen.length }
      if ((await addMaps()) > 0) {
        ;({ picked, chosen, ms: selectMs } = await select())
        timings.reselectMs = selectMs
      }
    }
    log.picked = picked.length
    if (chosen.length < MIN_STOPS) {
      await setStatus('too_few_places')
      return report('too_few_places', { chosen: chosen.length, timings })
    }

    phase('trim')
    // The prompt asks for a fitting route; this enforces it.
    const trim = trimToBudget(pin, chosen, tour.minutes, MIN_STOPS)
    const ordered = trim.stops
    log.budget = {
      budgetMeters: Math.round(trim.budget),
      dropped: trim.dropped.map((c) => c.title),
      longWalk: !trim.fits,
    }
    const stopIds = new Map<string, string>()
    for (const [i, c] of ordered.entries()) {
      const stop: StopData = {
        ownerId: tour.ownerId,
        tourId,
        order: i,
        source: c.source,
        ...(c.pageid !== undefined && { pageid: c.pageid }),
        ...(c.externalId !== undefined && { externalId: c.externalId }),
        ...(c.category !== undefined && { category: c.category }),
        name: c.title,
        lat: c.lat,
        lng: c.lng,
        sourceUrl: c.link,
        // Written by code, not the AI, so they can't add claims.
        transition: transitionText(c, ordered[i + 1] && { ...ordered[i + 1], name: ordered[i + 1].title }),
        ...(c.source === 'maps' && {
          narration: mapsNarration({ name: c.title, category: c.category, address: c.address, description: c.text }),
        }),
        audioStatus: 'none',
        isPublic: tour.isPublic,
      }
      const created = (await records.create('stops', stop as unknown as Record<string, unknown>)) as { recordId: string }
      stopIds.set(c.id, created.recordId)
    }

    // --- writing -----------------------------------------------------------
    phase('narrate')
    await setStatus('writing')
    jobCtx.progress(0.6, 'writing narration')

    // Only Wikipedia stops get AI narration; Maps stops and transitions were
    // written by code with the stops above.
    const wikiStops = ordered.filter((c) => c.source === 'wikipedia')
    if (wikiStops.length > 0) {
      const narration = await askJson(
        integrations,
        narratePrompt(
          tour.theme,
          tour.minutes,
          wikiStops.map((c) => ({ order: ordered.indexOf(c) + 1, id: c.id, title: c.title, extract: c.text })),
          ordered.map((c) => c.title),
        ),
        (obj) =>
          validateNarration(
            obj,
            wikiStops.map((c) => c.id),
          ),
        'narration',
      )
      timings.narrateMs = narration.ms
      for (const [id, text] of narration.value.byId) {
        await records.update('stops', stopIds.get(id)!, { narration: text })
      }
      if (narration.value.title) await records.update('tours', tourId, { title: narration.value.title })
    } else {
      // No Wikipedia stops means no AI call, so the title comes from code.
      await records.update('tours', tourId, { title: mapsOnlyTitle(tour.theme, ordered[0].title) })
    }

    await setStatus('done')
    return report('done', {
      stops: countBySource(ordered),
      routeMeters: Math.round(trim.meters),
      startMeters: Math.round(distanceMeters(pin, ordered[0])),
      timings,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setStatus('failed', `Could not build this tour: ${message}`)
    return report('failed', { error: message })
  }
}
