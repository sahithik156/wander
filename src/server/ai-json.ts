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

const asPageid = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) ? n : null
}

export const MAX_SELECTED = 8

export interface Selected {
  pageid: number
  reason: string
}

/**
 * Keeps only stops whose pageid is in the candidate list and drops duplicate
 * pageids, in the model's order. Not capped: the job drops near-duplicate
 * places first, then caps at MAX_SELECTED. Too few survivors is NOT an error
 * here: the job turns that into too_few_places.
 */
export function validateSelection(obj: unknown, candidateIds: ReadonlySet<number>): Selected[] {
  const seen = new Set<number>()
  const out: Selected[] = []
  for (const item of stopsArray(obj)) {
    if (!isRecord(item)) continue
    const pageid = asPageid(item.pageid)
    if (pageid === null || !candidateIds.has(pageid) || seen.has(pageid)) continue
    seen.add(pageid)
    out.push({ pageid, reason: typeof item.reason === 'string' ? item.reason : '' })
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
  byPageid: Map<number, { narration: string; transition: string }>
}

/** Requires a non-empty narration for every stop; extra pageids are ignored. */
export function validateNarration(obj: unknown, stopIds: readonly number[]): Narration {
  const wanted = new Set(stopIds)
  const byPageid: Narration['byPageid'] = new Map()
  for (const item of stopsArray(obj)) {
    if (!isRecord(item)) continue
    const pageid = asPageid(item.pageid)
    if (pageid === null || !wanted.has(pageid) || byPageid.has(pageid)) continue
    const narration = typeof item.narration === 'string' ? stripEmDashes(item.narration) : ''
    if (!narration) continue
    byPageid.set(pageid, {
      narration,
      transition: typeof item.transition === 'string' ? stripEmDashes(item.transition) : '',
    })
  }
  const missing = stopIds.filter((id) => !byPageid.has(id))
  if (missing.length > 0) throw new AiJsonError(`narration missing for ${missing.length} of ${stopIds.length} stops`)
  const title = isRecord(obj) && typeof obj.title === 'string' ? stripEmDashes(obj.title) : ''
  return { title, byPageid }
}
