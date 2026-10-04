/**
 * Parsing and validation of the JSON the AI returns. Pure, so it is
 * unit-testable. Every failure throws AiJsonError; claude.ts retries once on it.
 */

export class AiJsonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiJsonError'
  }
}

/**
 * Parses the JSON object in a model reply, ignoring any prose or code fences
 * around it: takes the text from the first "{" to the last "}".
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new AiJsonError('reply contained no JSON object')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (err) {
    throw new AiJsonError(`reply JSON did not parse (${err instanceof Error ? err.message : String(err)})`)
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function stopsArray(obj: unknown): unknown[] {
  if (!isRecord(obj) || !Array.isArray(obj.stops)) throw new AiJsonError('reply has no "stops" array')
  return obj.stops
}

/**
 * Candidate id from a reply item: its "id" ("w:123" / "m:ChIJ..."), or a bare
 * numeric pageid, read as the Wikipedia id "w:<n>".
 */
const asId = (item: Record<string, unknown>): string | null => {
  const v = item.id ?? item.pageid
  if (typeof v === 'number') return Number.isInteger(v) ? `w:${v}` : null
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  return /^\d+$/.test(s) ? `w:${s}` : s
}

export const MAX_SELECTED = 8

export interface Selected {
  id: string
  reason: string
}

/**
 * Keeps only stops whose id is in the candidate list and drops duplicate ids,
 * in the model's order. Not capped: the job drops near-duplicate
 * places first, then caps at MAX_SELECTED. Too few survivors is NOT an error
 * here: the job turns that into too_few_places.
 */
export function validateSelection(obj: unknown, candidateIds: ReadonlySet<string>): Selected[] {
  const seen = new Set<string>()
  const out: Selected[] = []
  for (const item of stopsArray(obj)) {
    if (!isRecord(item)) continue
    const id = asId(item)
    if (id === null || !candidateIds.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push({ id, reason: typeof item.reason === 'string' ? item.reason : '' })
  }
  return out
}

/**
 * Replaces em dashes (and spaced en dashes used as dashes) with a comma, as
 * a code-side guarantee behind the prompt rule. Unspaced en dashes in ranges
 * such as "1820–1830" are kept.
 */
export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s+–\s+/g, ', ')
    .replace(/,\s*([,.;:!?])/g, '$1')
    .replace(/^,\s*/, '')
    .trim()
}

export interface Narration {
  title: string
  /** Narration text by stop id. */
  byId: Map<string, string>
}

/** Requires a non-empty narration for every stop; extra ids are ignored. */
export function validateNarration(obj: unknown, stopIds: readonly string[]): Narration {
  const wanted = new Set(stopIds)
  const byId: Narration['byId'] = new Map()
  for (const item of stopsArray(obj)) {
    if (!isRecord(item)) continue
    const id = asId(item)
    if (id === null || !wanted.has(id) || byId.has(id)) continue
    const narration = typeof item.narration === 'string' ? stripEmDashes(item.narration) : ''
    if (!narration) continue
    byId.set(id, narration)
  }
  const missing = stopIds.filter((id) => !byId.has(id))
  if (missing.length > 0) throw new AiJsonError(`narration missing for ${missing.length} of ${stopIds.length} stops`)
  const title = isRecord(obj) && typeof obj.title === 'string' ? stripEmDashes(obj.title) : ''
  return { title, byId }
}
