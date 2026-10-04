/**
 * Food theme and "Include a food stop" (SPEC.md "Food theme"). Pure, so it
 * is unit-testable; the worker calls are in build-tour.ts.
 *
 * Places to eat come from Google Maps; dishes come only from the regional
 * cuisine article on Wikipedia. The two are never linked: nothing here (or in
 * the UI) says a place serves a dish, because the Maps data doesn't say so.
 */

import { distanceMeters, type LatLng } from '../lib/geo'
import { AiJsonError } from './ai-json'
import type { MapsPlace } from './maps-places'
import type { Dish } from '../schemas/tours-schema'

/** Food stops per tour length (SPEC.md). */
export const FOOD_STOPS: Record<number, number> = { 30: 3, 60: 4, 90: 5 }
export const MIN_RATING = 4.0
/** "Enough reviews"; relaxed to RELAXED_MIN_REVIEWS when too few places qualify. */
export const MIN_REVIEWS = 20
export const RELAXED_MIN_REVIEWS = 5
/** How far from the anchor stop the added food stop may be: near first, then wider. */
export const FOOD_STOP_NEAR_METERS = 600
export const FOOD_STOP_WIDE_METERS = 1500

export interface FoodStopTier {
  anchor: LatLng
  meters: number
}

/**
 * Where to look for the added food stop, in order (SPEC.md "Include a food
 * stop"): within 600 m of the last stop, then of the middle stop, then up to
 * 1.5 km of the last stop. A spread-out tour starts at 1.5 km.
 */
export function foodStopTiers(last: LatLng, middle: LatLng, spreadOut: boolean): FoodStopTier[] {
  const wide = { anchor: last, meters: FOOD_STOP_WIDE_METERS }
  if (spreadOut) return [wide]
  return [{ anchor: last, meters: FOOD_STOP_NEAR_METERS }, { anchor: middle, meters: FOOD_STOP_NEAR_METERS }, wide]
}

const tokens = (s: string): string[] =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const hasAny = (text: string, words: ReadonlySet<string>) => tokens(text).some((t) => words.has(t))

/** Google types that mean you can sit down or buy something to eat there. */
const EAT_WORDS = new Set([
  'restaurant', 'food', 'snack', 'sweet', 'sweets', 'candy', 'bakery', 'dessert', 'cafe', 'coffee', 'tea',
  'juice', 'ice', 'dhaba', 'eatery', 'diner', 'pub', 'bistro', 'brasserie', 'canteen', 'takeaway', 'confectionery',
  'mithai', 'chaat', 'tiffin',
])
/** Primary types that sell food but aren't places to eat. */
const NOT_EAT_WORDS = new Set(['supplier', 'wholesaler', 'caterer', 'grocery', 'supermarket', 'distributor', 'manufacturer'])
/** Words that mark a sweet or dessert place, not a meal (variety rule). */
const SWEETS_WORDS = new Set([
  'sweet', 'sweets', 'candy', 'bakery', 'bakers', 'dessert', 'desserts', 'confectionery', 'confectioner', 'mithai',
  'chocolate', 'chocolatier', 'waffle', 'waffles', 'gelato', 'gelateria', 'patisserie', 'pastry', 'cake', 'cakes',
  'cupcake', 'donut', 'doughnut', 'jalebi',
])
const hasIceCream = (text: string) => / ice cream /.test(` ${tokens(text).join(' ')} `)

/** A place whose types say it serves food, excluding suppliers, caterers, and shops. */
export function isPlaceToEat(p: Pick<MapsPlace, 'type' | 'types'>): boolean {
  if (p.type && hasAny(p.type, NOT_EAT_WORDS)) return false
  return [p.type ?? '', ...p.types].some((t) => hasAny(t, EAT_WORDS) || hasIceCream(t))
}

/**
 * Sweets shop, candy store, bakery, chocolate, ice cream, or dessert place,
 * judged by its primary type OR its name: a "Cafe" called "May's Sweet Bite"
 * that sells waffles is a dessert stop, not a meal.
 */
export function isSweetsPlace(p: Pick<MapsPlace, 'type' | 'types' | 'title'>): boolean {
  const type = p.type ?? p.types[0] ?? ''
  return [type, p.title].some((t) => hasAny(t, SWEETS_WORDS) || hasIceCream(t))
}

/**
 * Chain name without the branch: "Amorino Gelato - London Covent Garden" and
 * "Amorino Gelato (Soho)" are both "amorino gelato". One branch per chain.
 */
export function chainKey(title: string): string {
  return tokens(title.split(/\s[-–|]\s|\(/)[0]).join(' ')
}

/**
 * Rating that trusts many reviews more than a few: the average is pulled
 * toward MIN_RATING by 20 phantom reviews, so 4.8 from 6 reviews ranks below
 * 4.5 from 300.
 */
export function foodScore(p: Pick<MapsPlace, 'rating' | 'reviews'>): number {
  const rating = p.rating ?? 0
  const reviews = p.reviews ?? 0
  const prior = 20
  return (rating * reviews + MIN_RATING * prior) / (reviews + prior)
}

const qualifies = (p: MapsPlace, minReviews: number) =>
  isPlaceToEat(p) && (p.rating ?? 0) >= MIN_RATING && (p.reviews ?? 0) >= minReviews

/**
 * Good-rated places to eat within the radius, best first, one branch per
 * chain; reviews relaxed when fewer than `need` qualify.
 */
export function rankPlacesToEat(places: MapsPlace[], pin: LatLng, radiusMeters: number, need: number): MapsPlace[] {
  const near = places.filter((p) => distanceMeters(pin, p) <= radiusMeters)
  let ok = near.filter((p) => qualifies(p, MIN_REVIEWS))
  if (ok.length < need) ok = near.filter((p) => qualifies(p, RELAXED_MIN_REVIEWS))
  const seen = new Set<string>()
  return ok
    .sort((a, b) => foodScore(b) - foodScore(a))
    .filter((p) => {
      const key = chainKey(p.title)
      if (seen.has(p.placeId) || seen.has(key)) return false
      seen.add(p.placeId).add(key)
      return true
    })
}

/** Meals needed from the meal search before the extra sweets search is skipped. */
export const MIN_MEALS = 3

/**
 * The Food theme searches meals first ("restaurants and street food"); only
 * when fewer than MIN_MEALS good meal places qualify does it also search
 * sweet shops, so one can still be the variety pick.
 */
export function needsSweetsSearch(mealResults: MapsPlace[], pin: LatLng, radiusMeters: number): boolean {
  return rankPlacesToEat(mealResults, pin, radiusMeters, MIN_MEALS).filter((p) => !isSweetsPlace(p)).length < MIN_MEALS
}

/** Best places for a food tour, with at most one sweets shop / candy store / bakery so there are real meals. */
export function pickFoodStops(places: MapsPlace[], pin: LatLng, radiusMeters: number, count: number): MapsPlace[] {
  const out: MapsPlace[] = []
  let sweets = 0
  for (const p of rankPlacesToEat(places, pin, radiusMeters, count)) {
    if (isSweetsPlace(p)) {
      if (sweets >= 1) continue
      sweets++
    }
    out.push(p)
    if (out.length === count) break
  }
  return out
}

/**
 * One place to eat for "Include a food stop": the best-rated place in the
 * first tier that has one (foodStopTiers). A real meal is preferred over a
 * sweets shop. Returns the tier used, for the log.
 */
export function pickFoodStopNear(
  places: MapsPlace[],
  tiers: FoodStopTier[],
  excludeIds: ReadonlySet<string>,
): { place: MapsPlace; tier: FoodStopTier } | undefined {
  for (const tier of tiers) {
    const ranked = rankPlacesToEat(places, tier.anchor, tier.meters, 1).filter((p) => !excludeIds.has(p.placeId))
    const pick = ranked.find((p) => !isSweetsPlace(p)) ?? ranked[0]
    if (pick) return { place: pick, tier }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Region and cuisine article
// ---------------------------------------------------------------------------

/** Address part without postcodes ("Telangana 506002" -> "Telangana", "London WC2N 5DN" -> "London"). */
const withoutPostcode = (part: string) =>
  part
    .split(/\s+/)
    .filter((w) => !/\d/.test(w))
    .join(' ')
    .trim()

const mostCommon = (values: string[]): string | undefined => {
  const counts = new Map<string, number>()
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
}

export interface Region {
  city?: string
  state?: string
  country?: string
}

/**
 * Most common city, state, and country across Maps addresses, which end
 * "..., <city>, <state> <postcode>, <country>". UK addresses end
 * "..., <street>, <city> <postcode>, <country>", so there "city" is a street
 * and "state" is the city; the stem check in pickCuisineTitle rejects the
 * street, so the search still lands on the right article.
 */
export function regionFromAddresses(addresses: string[]): Region {
  const rows = addresses.map((a) =>
    a
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  )
  const at = (fromEnd: number) => mostCommon(rows.map((r) => withoutPostcode(r[r.length - fromEnd] ?? '')))
  return { city: at(3), state: at(2), country: at(1) }
}

/** The order to search Wikipedia for a cuisine article: most local first. */
export function cuisineQueries(region: Region): { query: string; level: 'local' | 'country' }[] {
  const out: { query: string; level: 'local' | 'country' }[] = []
  for (const name of [region.city, region.state]) if (name) out.push({ query: `${name} cuisine`, level: 'local' })
  if (region.country) out.push({ query: `${region.country} cuisine`, level: 'country' })
  return out
}

/**
 * Picks the cuisine article from Wikipedia search results. Local searches
 * accept only a "cuisine" title that shares the place name's stem
 * ("Hyderabad" -> "Hyderabadi cuisine"); the country search accepts the top
 * "cuisine" title ("United Kingdom" -> "British cuisine").
 */
export function pickCuisineTitle(query: string, level: 'local' | 'country', titles: string[]): string | undefined {
  const stem = tokens(query)[0]?.slice(0, 5) ?? ''
  return titles.find((t) => {
    const words = tokens(t)
    if (!words.includes('cuisine')) return false
    return level === 'country' || words.some((w) => w.startsWith(stem))
  })
}

// ---------------------------------------------------------------------------
// Dishes (AI picks, code checks)
// ---------------------------------------------------------------------------

export const MAX_DISHES = 5
/** Article text sent to the AI is capped (British cuisine is ~69k characters). */
export const CUISINE_TEXT_CHARS = 15_000

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** A heading line in Wikipedia plain text, e.g. "== Desserts ==". */
const HEADING = /^\s*=+[^=].*=+\s*$/
/** A full sentence ends in . ! or ? (optionally followed by a closing quote or bracket). */
const FULL_SENTENCE = /[.!?]["'”’)\]]*$/
const MIN_SENTENCE_WORDS = 4

/**
 * A list entry rather than a sentence: a short label, then a dash, then a
 * description ("Qubani ka meetha (Khubani-ka-meetha) - Apricot pudding, ...").
 */
const LIST_LINE = /^[^.!?]{1,80}?\s[-–—]\s/

/** Collapses spacing and drops unbalanced double quotes left over from Wikipedia markup. */
export function tidySentence(sentence: string): string {
  let s = sentence.replace(/\s+/g, ' ').trim()
  const straight = (s.match(/"/g) ?? []).length
  if (straight % 2 === 1) s = s.replace(/"/g, '')
  const opens = (s.match(/“/g) ?? []).length
  const closes = (s.match(/”/g) ?? []).length
  if (opens !== closes) s = s.replace(/[“”]/g, '')
  return s.replace(/\s+([,.;:!?])/g, '$1')
}

/** Full sentences of the article, skipping headings, list entries, and fragments. */
export function articleSentences(articleText: string): string[] {
  const out: string[] = []
  for (const line of articleText.split('\n')) {
    if (!line.trim() || HEADING.test(line)) continue
    for (const raw of line.trim().split(/(?<=[.!?]["'”’)\]]*)\s+(?=[A-Z0-9"'“‘(])/)) {
      const sentence = tidySentence(raw)
      if (!FULL_SENTENCE.test(sentence) || LIST_LINE.test(sentence)) continue
      if (sentence.split(/\s+/).length >= MIN_SENTENCE_WORDS) out.push(sentence)
    }
  }
  return out
}

/**
 * The note for a dish: a full sentence of the article containing its name,
 * preferring one that starts with the name, and never a sentence in `used`
 * (already given to another dish). '' if there is none.
 */
export function dishSentence(name: string, articleText: string, used: ReadonlySet<string> = new Set()): string {
  const key = squash(name)
  const candidates = articleSentences(articleText).filter((s) => !used.has(s) && squash(s).includes(key))
  return candidates.find((s) => squash(s).startsWith(key)) ?? candidates[0] ?? ''
}

/**
 * Keeps only dishes whose name appears word for word in the article text
 * (case- and spacing-insensitive), up to MAX_DISHES. Each dish's note is
 * chosen by code, not the AI (dishSentence): a full sentence of the article
 * containing the dish name, preferring one that starts with it, never a
 * heading or list entry, and never one already used for another dish; or
 * none. Zero valid dishes is an AiJsonError so the call is retried once.
 */
export function validateDishes(obj: unknown, articleText: string): Dish[] {
  if (typeof obj !== 'object' || obj === null || !Array.isArray((obj as { dishes?: unknown }).dishes)) {
    throw new AiJsonError('reply has no "dishes" array')
  }
  const text = squash(articleText)
  const seen = new Set<string>()
  const usedSentences = new Set<string>()
  const out: Dish[] = []
  for (const item of (obj as { dishes: unknown[] }).dishes) {
    if (typeof item !== 'object' || item === null) continue
    const { name } = item as { name?: unknown }
    if (typeof name !== 'string' || !name.trim()) continue
    const key = squash(name)
    if (seen.has(key) || !text.includes(key)) continue
    seen.add(key)
    const note = dishSentence(name, articleText, usedSentences)
    if (note) usedSentences.add(note)
    out.push({ name: name.trim(), note })
    if (out.length === MAX_DISHES) break
  }
  if (out.length === 0) throw new AiJsonError('no dish name appeared in the article')
  return out
}
