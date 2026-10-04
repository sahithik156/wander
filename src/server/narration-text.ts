/**
 * Narration text that code writes, not the AI, because the AI kept adding
 * claims that weren't in the data. Pure, so it is unit-testable.
 *
 * - Maps stops: the description if there is one, otherwise "A <category> in
 *   <area>" (SPEC.md "Maps stop text").
 * - Transitions: direction, distance, and minutes on foot to the next stop,
 *   computed from coordinates. The last stop says the tour ends.
 */

import { compassDirection, distanceMeters, walkingDistance, type LatLng } from '../lib/geo'
import { STREET_FACTOR, WALK_KMH } from '../lib/route-budget'

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')
const endWithPeriod = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`)

/**
 * Google descriptions often repeat a short summary before a longer version
 * ("Ornate Hindu temple & pilgrimage center. Ornate Hindu temple & pilgrimage
 * destination dedicated to ..."), so keep only the longest sentence.
 */
export function cleanDescription(description: string): string {
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (sentences.length === 0) return ''
  return endWithPeriod(sentences.reduce((a, b) => (b.length > a.length ? b : a)))
}

const PLUS_CODE = /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}$/
const POSTCODE = /\b\d{4,}\b/
/** UK postcodes such as "WC2E 9AR" or "SW1A 2AA" (numeric postcodes are handled by POSTCODE). */
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g

/**
 * Street and locality only, for reading aloud: drops plus codes, UK
 * postcodes, repeated parts, the trailing country, and a trailing "state +
 * postcode" part.
 * "Arjuna St, Mallikarjunapeta, Vijayawada, Andhra Pradesh 520001, India"
 * -> "Arjuna St, Mallikarjunapeta, Vijayawada";
 * "41 Garrick St, London WC2E 9AR, United Kingdom" -> "41 Garrick St, London".
 */
export function shortAddress(address: string): string {
  const parts: string[] = []
  for (const raw of address.split(',')) {
    const part = raw.replace(UK_POSTCODE, '').replace(/\s+/g, ' ').trim()
    if (!part || PLUS_CODE.test(part) || parts.includes(part)) continue
    parts.push(part)
  }
  if (parts.length > 2 && !/\d/.test(parts[parts.length - 1])) parts.pop() // country
  if (parts.length > 1 && POSTCODE.test(parts[parts.length - 1])) parts.pop() // state + postcode
  return parts.join(', ')
}

/**
 * Proper adjectives (religions, nationalities, regional cuisines) that keep
 * their capital at the start of a category ("a Hindu temple", "an Italian
 * restaurant", "a Sri Lankan restaurant").
 */
const PROPER_FIRST_WORDS = new Set([
  // Religions and traditions
  'hindu', 'buddhist', 'jain', 'sikh', 'muslim', 'islamic', 'jewish', 'christian', 'catholic', 'orthodox',
  'anglican', 'protestant', 'lutheran', 'baptist', 'methodist', 'presbyterian', 'evangelical', 'coptic',
  'shinto', 'taoist', 'roman', 'ottoman', 'mughal', 'mughlai',
  // Nationalities and regions
  'indian', 'italian', 'chinese', 'japanese', 'korean', 'thai', 'sri', 'nepali', 'nepalese', 'tibetan',
  'pakistani', 'bangladeshi', 'afghan', 'persian', 'iranian', 'arab', 'arabic', 'lebanese', 'turkish', 'greek',
  'israeli', 'egyptian', 'moroccan', 'ethiopian', 'african', 'american', 'mexican', 'cuban', 'caribbean',
  'jamaican', 'brazilian', 'peruvian', 'argentine', 'argentinian', 'latin', 'french', 'spanish', 'portuguese',
  'german', 'british', 'english', 'irish', 'scottish', 'welsh', 'polish', 'russian', 'ukrainian', 'georgian',
  'armenian', 'european', 'mediterranean', 'asian', 'vietnamese', 'malaysian', 'indonesian', 'filipino',
  'burmese', 'cantonese', 'sichuan', 'szechuan', 'hawaiian', 'andhra', 'hyderabadi', 'punjabi', 'gujarati',
  'rajasthani', 'bengali', 'kerala', 'chettinad', 'udupi', 'goan', 'kashmiri', 'parsi', 'telugu', 'tamil',
])
/** "South Indian restaurant", "Middle Eastern restaurant": the direction keeps its capital too. */
const DIRECTION_WORDS = new Set(['south', 'north', 'east', 'west', 'middle', 'southeast', 'northeast', 'central'])
const PROPER_SECOND_WORDS = new Set([...PROPER_FIRST_WORDS, 'eastern', 'western', 'asian', 'american', 'european'])

/**
 * Google categories come in sentence case ("Tourist attraction"); inside a
 * sentence they read better with a lowercase first letter ("a tourist
 * attraction"), unless they start with a proper adjective ("a Hindu temple",
 * "an Italian restaurant", "a South Indian restaurant").
 */
export function categoryInSentence(category: string): string {
  const [first = '', second = ''] = category.toLowerCase().split(/\s+/)
  const proper = PROPER_FIRST_WORDS.has(first) || (DIRECTION_WORDS.has(first) && PROPER_SECOND_WORDS.has(second))
  return proper ? category : category.charAt(0).toLowerCase() + category.slice(1)
}

/** Title for a tour with no Wikipedia stops (no AI call): "History tour near <first stop>". */
export function mapsOnlyTitle(themeLabel: string, firstStopName: string): string {
  return `${themeLabel.charAt(0).toUpperCase()}${themeLabel.slice(1)} tour near ${firstStopName}`
}

/** The last `n` comma-separated parts of an address ("…, Islampet, Vijayawada" -> "Islampet, Vijayawada"). */
const lastParts = (address: string, n: number) =>
  address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(-n)
    .join(', ')

export interface MapsStopData {
  category?: string
  address?: string
  description?: string
}

/**
 * Text for a Maps stop (SPEC.md "Maps stop text"), from its data only:
 * - with a description: the description alone (longest sentence);
 * - otherwise "A <category> in <last two parts of the short address>."
 */
export function mapsNarration({ category, address, description }: MapsStopData): string {
  const desc = description ? cleanDescription(description) : ''
  if (desc) return desc
  const area = address ? lastParts(shortAddress(address), 2) : ''
  const cat = category ? categoryInSentence(category) : ''
  const a = (word: string) => article(word).replace(/^a/, 'A')
  if (cat && area) return `${a(cat)} ${cat} in ${area}.`
  if (cat) return `${a(cat)} ${cat}.`
  if (area) return `In ${area}.`
  return ''
}

/** Words that mark an AI filler sentence (SPEC.md "Narration cleanup"). */
const FILLER_WORDS = ['legacy', 'significance', 'significant', 'iconic', 'testament', 'remarkable', 'shaped', 'renowned']

const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean)

/**
 * Removes every sentence of an AI narration that contains a filler word
 * (legacy, significance, significant, iconic, testament, remarkable, shaped,
 * renowned), unless that word also appears in the stop's source extract.
 * Words match whole ("shaped", not "shape"). Done in code because prompt
 * rules alone didn't stop these sentences.
 */
export function removeFiller(narration: string, sourceExtract: string): string {
  const allowed = new Set(words(sourceExtract))
  const banned = FILLER_WORDS.filter((w) => !allowed.has(w))
  return narration
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !words(sentence).some((w) => banned.includes(w)))
    .join(' ')
    .trim()
}

/**
 * Walking minutes for a straight-line distance, using the same street factor
 * and pace as the time budget (route-budget.ts): 2.2 km -> 38 min.
 */
export function walkingMinutes(straightMeters: number): number {
  const metersPerMinute = (WALK_KMH * 1000) / 60
  return Math.max(1, Math.round((straightMeters * STREET_FACTOR) / metersPerMinute))
}

/**
 * "Head southeast about 2.2 km (38 min on foot) to <next>." or, for the last
 * stop, "The tour ends here." (SPEC.md "Transitions"). "Head", not "Walk":
 * people also go by car or auto; the minutes say they are for walking.
 */
export function transitionText(from: LatLng, next?: LatLng & { name: string }): string {
  if (!next) return 'The tour ends here.'
  const meters = distanceMeters(from, next)
  return `Head ${compassDirection(from, next)} about ${walkingDistance(meters)} (${walkingMinutes(meters)} min on foot) to ${next.name}.`
}
