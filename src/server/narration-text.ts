/**
 * Narration text that code writes, not the AI, because the AI kept adding
 * claims that weren't in the data. Pure, so it is unit-testable.
 *
 * - Maps-only stops: a plain restatement of name, category, address, and
 *   description.
 * - Transitions: direction and distance to the next stop, computed from
 *   coordinates. The last stop says the tour ends.
 */

import { compassDirection, distanceMeters, walkingDistance, type LatLng } from '../lib/geo'

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

/**
 * Street and locality only, for reading aloud: drops plus codes, repeated
 * parts, the trailing country, and a trailing "state + postcode" part.
 * "Arjuna St, Mallikarjunapeta, Vijayawada, Andhra Pradesh 520001, India"
 * -> "Arjuna St, Mallikarjunapeta, Vijayawada".
 */
export function shortAddress(address: string): string {
  const parts: string[] = []
  for (const raw of address.split(',')) {
    const part = raw.trim()
    if (!part || PLUS_CODE.test(part) || parts.includes(part)) continue
    parts.push(part)
  }
  if (parts.length > 2 && !/\d/.test(parts[parts.length - 1])) parts.pop() // country
  if (parts.length > 1 && POSTCODE.test(parts[parts.length - 1])) parts.pop() // state + postcode
  return parts.join(', ')
}

/** First words that are proper adjectives, so they keep their capital ("a Hindu temple"). */
const PROPER_FIRST_WORDS = new Set([
  'hindu', 'buddhist', 'jain', 'sikh', 'muslim', 'islamic', 'jewish', 'christian', 'catholic', 'orthodox',
  'anglican', 'protestant', 'lutheran', 'baptist', 'methodist', 'presbyterian', 'evangelical', 'coptic',
  'shinto', 'taoist', 'roman', 'greek', 'ottoman', 'mughal', 'chinese', 'japanese', 'korean', 'thai',
])

/**
 * Google categories come in sentence case ("Tourist attraction"); inside a
 * sentence they read better with a lowercase first letter ("a tourist
 * attraction"), unless the first word is a proper adjective ("a Hindu temple").
 */
export function categoryInSentence(category: string): string {
  const first = category.split(/\s+/)[0].toLowerCase()
  return PROPER_FIRST_WORDS.has(first) ? category : category.charAt(0).toLowerCase() + category.slice(1)
}

/** Title for a tour with no Wikipedia stops (no AI call): "History walk near <first stop>". */
export function mapsOnlyTitle(theme: string, firstStopName: string): string {
  return `${theme.charAt(0).toUpperCase()}${theme.slice(1)} walk near ${firstStopName}`
}

export interface MapsStopData {
  name: string
  category?: string
  address?: string
  description?: string
}

/** "X is a Hindu temple at <street, locality>. <description>" using only the given data. */
export function mapsNarration({ name, category, address, description }: MapsStopData): string {
  const short = address ? shortAddress(address) : ''
  const cat = category ? categoryInSentence(category) : ''
  const what = cat ? ` is ${article(cat)} ${cat}` : short ? ' is' : ''
  const where = short ? ` at ${short}` : ''
  const first = endWithPeriod(`${name}${what}${where}`)
  const desc = description ? cleanDescription(description) : ''
  return desc ? `${first} ${desc}` : first
}

/** "Walk southeast about 200 meters to <next>." or, for the last stop, "The tour ends here." */
export function transitionText(from: LatLng, next?: LatLng & { name: string }): string {
  if (!next) return 'The tour ends here.'
  return `Walk ${compassDirection(from, next)} about ${walkingDistance(distanceMeters(from, next))} to ${next.name}.`
}
