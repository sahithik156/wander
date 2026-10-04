/**
 * build-tour job — runs in the AppJobRoom (worker.ts) via src/jobs.ts.
 *
 * Sight themes (History, Architecture, Art & museums, Temples & sacred
 * places, Nature & parks, Highlights):
 * finding:  Wikipedia geosearch over the whole radius -> code filters ->
 *           up to 40 candidates spread across distance bands -> intro extracts.
 *           Thin (< 8 candidates): widen to 1.5x, then 2x the radius. Still
 *           thin: one Google Maps search with the theme's query, merged in.
 * choosing: Claude picks 5-8 stops with the theme's guidance; code drops
 *           invented/duplicate ids and same-site places. If fewer than 5
 *           remain and Wikipedia was thin, search Maps once and pick again.
 *           Code orders the stops one way from the pin, drops stops until the
 *           route fits the time budget (never below 3), optionally adds one
 *           place to eat at the end ("Include a food stop"), and writes the
 *           stops at once so they appear on the map. Code writes every
 *           transition and the text of Maps stops, because the AI kept adding
 *           claims.
 * writing:  Claude narrates the Wikipedia stops from their extracts and titles
 *           the tour.
 *
 * Food theme: places to eat from one Maps search, chosen and ordered by code
 * (ratings, at most one sweets shop); separately, 3-5 dishes picked by Claude
 * from the regional cuisine article on Wikipedia, kept only if they appear in
 * it word for word. Places and dishes are never linked.
 *
 * Everything is written through the owner context, so stops and status
 * stream to the UI over the normal record subscriptions. Only "fewer than 3
 * places/stops" gives too_few_places; a Wikipedia or AI error gives failed;
 * an error in an optional step (Maps fallback, food stop, dishes) is logged
 * and the tour continues without it.
 */

import { buildCronContext } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../../worker'
import { THEME_LABEL, normalizeTheme, type TourData, type TourStatus } from '../schemas/tours-schema'
import type { StopData } from '../schemas/stops-schema'
import { MAX_SELECTED, validateNarration, validateSelection } from './ai-json'
import type { Candidate } from './candidate'
import { THIN_CANDIDATES, dropSameSite, sampleByBands, widenRadii } from './candidates'
import { askJson } from './claude'
import {
  CUISINE_TEXT_CHARS,
  FOOD_STOPS,
  FOOD_STOP_WIDE_METERS,
  foodStopTiers,
  cuisineQueries,
  pickCuisineTitle,
  pickFoodStopNear,
  needsSweetsSearch,
  pickFoodStops,
  regionFromAddresses,
  validateDishes,
} from './food'
import { searchMapsPlaces } from './maps'
import { filterMapsPlaces, mapsCandidate, mergeSources, type MapsPlace } from './maps-places'
import { mapsNarration, mapsOnlyTitle, removeFiller, transitionText } from './narration-text'
import { SELECT_EXTRACT_CHARS, dishesPrompt, narratePrompt, selectPrompt } from './prompts'
import { trimToBudget } from './route-order'
import { FOOD_SWEETS_QUERY, THEME_CONFIG } from './theme-config'
import { distanceMeters, pathLengthMeters, type LatLng } from '../lib/geo'
import { FOOD_MINUTES_PER_STOP } from '../lib/route-budget'
import { validateTour } from './tour-validation'
import {
  RADIUS_METERS,
  fetchArticle,
  fetchExtracts,
  filterPlaces,
  searchAround,
  searchTitles,
  wikiCandidate,
} from './wikipedia'

/**
 * Fewer valid stops than this -> too_few_places; trimming never goes below it.
 * Lowered from SPEC.md's original 4 because a 3-stop tour beats no tour in
 * thin areas (Warangal).
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

const foodCandidate = (p: MapsPlace, pin: LatLng): Candidate => ({ ...mapsCandidate(p, pin), role: 'food' })

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
  // Tours built before the theme list changed may say "surprise me".
  const theme = normalizeTheme(tour.theme)
  const started = Date.now()

  // Everything the job learns goes into one log line on every exit.
  let radius = RADIUS_METERS[tour.minutes]
  let serpapiCalls = 0
  let candidates: Candidate[] = []
  const timings: Record<string, number> = {}
  const log: Record<string, unknown> & { food?: { meals: number; sweets?: number } } = { theme }
  const report = (status: string, extra: Record<string, unknown> = {}) => {
    const result = {
      status,
      radiusUsed: radius,
      serpapiCalls,
      candidates: countBySource(candidates),
      ...log,
      ...extra,
      timings,
      totalMs: Date.now() - started,
    }
    console.info(`[build-tour] ${tourId} ${JSON.stringify(result)}`)
    return result
  }

  // One line per phase, so a job that never finishes still shows where it stopped.
  const phase = (name: string) => console.info(`[build-tour] ${tourId} phase=${name} t=${Date.now() - started}ms`)

  /** One Maps search for places to eat: meals by default, or sweet shops. */
  const searchFood = async (center: LatLng, searchRadius: number, query = THEME_CONFIG.food.mapsQuery) => {
    serpapiCalls++
    phase('food-search')
    return searchMapsPlaces(integrations, center, searchRadius, query)
  }

  /** One Google Maps search with the theme's query, merged into `candidates`. Returns how many it added. */
  const addMaps = async (): Promise<number> => {
    serpapiCalls++
    phase('maps')
    try {
      const places = await searchMapsPlaces(integrations, pin, radius, THEME_CONFIG[theme].mapsQuery)
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
        theme,
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

  /** Writes the stops in order; transitions and Maps-stop text come from code. Returns stop record ids by candidate id. */
  const writeStops = async (ordered: Candidate[]) => {
    const stopIds = new Map<string, string>()
    for (const [i, c] of ordered.entries()) {
      const next = ordered[i + 1]
      const stop: StopData = {
        ownerId: tour.ownerId,
        tourId,
        order: i,
        source: c.source,
        role: c.role ?? 'sight',
        ...(c.pageid !== undefined && { pageid: c.pageid }),
        ...(c.externalId !== undefined && { externalId: c.externalId }),
        ...(c.category !== undefined && { category: c.category }),
        ...(c.source === 'maps' && c.rating !== undefined && { rating: c.rating }),
        ...(c.source === 'maps' && c.reviews !== undefined && { reviews: c.reviews }),
        ...(c.price !== undefined && { price: c.price }),
        name: c.title,
        lat: c.lat,
        lng: c.lng,
        sourceUrl: c.link,
        transition: transitionText(c, next && { ...next, name: next.title }),
        ...(c.source === 'maps' && {
          narration: mapsNarration({ category: c.category, address: c.address, description: c.text }),
        }),
        audioStatus: 'none',
        isPublic: tour.isPublic,
      }
      const created = (await records.create('stops', stop as unknown as Record<string, unknown>)) as { recordId: string }
      stopIds.set(c.id, created.recordId)
    }
    return stopIds
  }

  /**
   * Food theme: up to 5 dishes from the regional cuisine article, found from
   * the Maps addresses' city/state/country. Optional: any failure is logged
   * and the section is skipped.
   */
  const saveDishes = async (places: MapsPlace[]) => {
    try {
      phase('dishes')
      const region = regionFromAddresses(places.map((p) => p.address).filter((a): a is string => Boolean(a)))
      let article: Awaited<ReturnType<typeof fetchArticle>>
      for (const { query, level } of cuisineQueries(region)) {
        const title = pickCuisineTitle(query, level, await searchTitles(query, jobCtx.signal))
        if (title) {
          article = await fetchArticle(title, CUISINE_TEXT_CHARS, jobCtx.signal)
          if (article) break
        }
      }
      if (!article) {
        log.dishes = { region, article: null }
        return
      }
      const found = await askJson(
        integrations,
        dishesPrompt(article.title, article.text),
        (obj) => validateDishes(obj, article.text),
        'dishes',
      )
      timings.dishesMs = found.ms
      await records.update('tours', tourId, {
        dishes: found.value,
        cuisineTitle: article.title,
        cuisineUrl: article.url,
      })
      log.dishes = { region, article: article.title, dishes: found.value.map((d) => d.name) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[build-tour] ${tourId} dishes skipped: ${message}`)
      log.dishesError = message
    }
  }

  const buildFoodTour = async () => {
    await setStatus('finding')
    jobCtx.progress(0.05, 'finding places to eat')
    // Maps is the only source of places for this theme, so an error fails the tour.
    let places = await searchFood(pin, radius)
    log.food = { meals: places.length }
    // Too few meals: also search sweet shops so one can still be the variety pick.
    if (needsSweetsSearch(places, pin, radius)) {
      try {
        const sweets = await searchFood(pin, radius, FOOD_SWEETS_QUERY)
        places = [...places, ...sweets]
        log.food = { meals: log.food.meals, sweets: sweets.length }
      } catch (err) {
        log.sweetsError = err instanceof Error ? err.message : String(err)
      }
    }

    await setStatus('choosing')
    jobCtx.progress(0.3, 'choosing places and dishes')
    await saveDishes(places)

    const picked = pickFoodStops(places, pin, radius, FOOD_STOPS[tour.minutes] ?? 4)
    candidates = picked.map((p) => foodCandidate(p, pin))
    if (candidates.length < MIN_STOPS) {
      await setStatus('too_few_places')
      return report('too_few_places')
    }
    phase('trim')
    const trim = trimToBudget(pin, candidates, tour.minutes, MIN_STOPS, FOOD_MINUTES_PER_STOP)
    log.budget = { budgetMeters: Math.round(trim.budget), dropped: trim.dropped.map((c) => c.title), spreadOut: !trim.fits }
    await writeStops(trim.stops)
    await records.update('tours', tourId, { title: mapsOnlyTitle(THEME_LABEL.food, trim.stops[0].title) })
    await setStatus('done')
    return report('done', {
      stops: trim.stops.map((c) => `${c.title} (${c.category}, ${c.rating}★ ${c.reviews})`),
      routeMeters: Math.round(trim.meters),
      startMeters: Math.round(distanceMeters(pin, trim.stops[0])),
    })
  }

  /** "Include a food stop": one place to eat near the end of the route, added last. Optional. */
  const addFoodStop = async (ordered: Candidate[], spreadOut: boolean): Promise<Candidate[]> => {
    const last = ordered[ordered.length - 1]
    const middle = ordered[Math.floor((ordered.length - 1) / 2)]
    // Never fail silently: when nothing qualifies, the panel says so.
    const missing = async () => {
      await records.update('tours', tourId, { foodStopMissing: true })
      return ordered
    }
    try {
      const tiers = foodStopTiers(last, middle, spreadOut)
      // One search around the last stop, wide enough for every tier.
      const places = await searchFood(last, FOOD_STOP_WIDE_METERS)
      const taken = new Set(ordered.map((c) => c.externalId).filter((id): id is string => Boolean(id)))
      const found = pickFoodStopNear(places, tiers, taken)
      if (!found) {
        log.foodStop = { none: 'no well-rated place to eat in any tier', tiers: tiers.map((t) => t.meters), returned: places.length }
        return await missing()
      }
      const { place, tier } = found
      log.foodStop = {
        name: place.title,
        category: place.type,
        rating: place.rating,
        reviews: place.reviews,
        tier: `${tier.anchor === last ? 'last' : 'middle'} stop, ${tier.meters} m`,
        fromLast: Math.round(distanceMeters(last, place)),
      }
      return [...ordered, foodCandidate(place, pin)]
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[build-tour] ${tourId} food stop skipped: ${message}`)
      log.foodStopError = message
      return await missing()
    }
  }

  try {
    if (theme === 'food') return await buildFoodTour()

    // --- finding -----------------------------------------------------------
    await setStatus('finding')
    jobCtx.progress(0.05, 'finding places')

    phase('wikipedia')
    const extracts = new Map<number, string>()
    const noExtract = new Set<number>()
    for (const r of widenRadii(radius)) {
      radius = r
      const search = await searchAround(pin, r, jobCtx.signal)
      const sampled = sampleByBands(filterPlaces(search.places, { keepWater: theme === 'nature' }), r)
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
    timings.selectMs = selectMs
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
      return report('too_few_places', { chosen: chosen.length })
    }

    phase('trim')
    // The prompt asks for a fitting route; this enforces it.
    const trim = trimToBudget(pin, chosen, tour.minutes, MIN_STOPS)
    log.budget = { budgetMeters: Math.round(trim.budget), dropped: trim.dropped.map((c) => c.title), spreadOut: !trim.fits }
    const ordered = tour.includeFood ? await addFoodStop(trim.stops, !trim.fits) : trim.stops
    const stopIds = await writeStops(ordered)

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
          theme,
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
      const extractOf = new Map(wikiStops.map((c) => [c.id, c.text]))
      const removed: string[] = []
      for (const [id, text] of narration.value.byId) {
        // Filler sentences ("...legacy shaped modern London.") are cut in code.
        const cleaned = removeFiller(text, extractOf.get(id) ?? '')
        if (cleaned !== text) removed.push(id)
        await records.update('stops', stopIds.get(id)!, { narration: cleaned })
      }
      if (removed.length > 0) log.fillerRemovedFrom = removed
      if (narration.value.title) await records.update('tours', tourId, { title: narration.value.title })
    } else {
      // No Wikipedia stops means no AI call, so the title comes from code.
      await records.update('tours', tourId, { title: mapsOnlyTitle(THEME_LABEL[theme], ordered[0].title) })
    }

    await setStatus('done')
    return report('done', {
      stops: countBySource(ordered),
      routeMeters: Math.round(pathLengthMeters(ordered)),
      startMeters: Math.round(distanceMeters(pin, ordered[0])),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await setStatus('failed', `Could not build this tour: ${message}`)
    return report('failed', { error: message })
  }
}
