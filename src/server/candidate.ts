/**
 * One candidate stop, from either source. Wikipedia places carry an intro
 * extract; Google Maps places (serpapi/places-search, used only where
 * Wikipedia is thin) carry just a category, address, and sometimes a short
 * description, so their narration is deliberately limited.
 */

export type CandidateSource = 'wikipedia' | 'maps'

export interface Candidate {
  /** "w:<pageid>" or "m:<place_id>": the id the AI calls use. */
  id: string
  source: CandidateSource
  title: string
  lat: number
  lng: number
  /** Meters from the pin. */
  dist: number
  /** Wikipedia: intro extract. Maps: description, often empty. */
  text: string
  /** Maps only: Google's place type, e.g. "Hindu temple". */
  category?: string
  address?: string
  rating?: number
  reviews?: number
  pageid?: number
  /** Maps only: Google place_id. */
  externalId?: string
  /** Wikipedia article or Google Maps page. */
  link: string
}
