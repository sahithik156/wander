/**
 * Claude calls through the platform's anthropic/chat-completion integration
 * (worker only, billed to the app owner via APP_OWNER_JWT by CronContext —
 * no API key in the app). The integration defaults to an expensive model, so
 * the model is ALWAYS set here (SPEC.md "Anthropic calls").
 */

import type { CronContext } from 'deepspace/worker'
import { AiJsonError, extractJson } from './ai-json'
import { withDeadline } from './deadline'

/** Per-call limit; a narration call normally takes 5-12 s. */
const CLAUDE_TIMEOUT_MS = 60_000

export const CLAUDE_MODEL = 'claude-haiku-4-5'

export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

export interface ClaudeRequest {
  system: string
  user: string
  temperature: number
  maxTokens: number
}

/** Pulls the text out of the integration's reply (Anthropic Messages shape). */
function replyText(data: unknown): string {
  if (typeof data === 'string') return data
  if (typeof data === 'object' && data !== null) {
    const d = data as { content?: unknown; text?: unknown }
    if (Array.isArray(d.content)) {
      return d.content
        .map((block) => (block && typeof block === 'object' && 'text' in block ? String(block.text) : ''))
        .join('')
    }
    if (typeof d.text === 'string') return d.text
  }
  throw new AiError('AI reply had no text')
}

export async function callClaude(integrations: CronContext['integrations'], req: ClaudeRequest): Promise<string> {
  let data: unknown
  try {
    data = await withDeadline(
      integrations.call('anthropic/chat-completion', {
        model: CLAUDE_MODEL,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        temperature: req.temperature,
        max_tokens: req.maxTokens,
      }),
      CLAUDE_TIMEOUT_MS,
      'AI call',
    )
  } catch (err) {
    throw new AiError(`AI request failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return replyText(data)
}

/**
 * Calls Claude, parses the JSON in its reply, and validates it. On a parse or
 * validation failure it retries once; a second failure throws AiError.
 * Request errors (network, billing) are not retried.
 */
export async function askJson<T>(
  integrations: CronContext['integrations'],
  req: ClaudeRequest,
  validate: (obj: unknown) => T,
  label: string,
): Promise<{ value: T; ms: number; attempts: number }> {
  const started = Date.now()
  let lastError = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await callClaude(integrations, req)
    try {
      const value = validate(extractJson(text))
      return { value, ms: Date.now() - started, attempts: attempt }
    } catch (err) {
      if (!(err instanceof AiJsonError)) throw err
      lastError = err.message
      console.warn(`[claude] ${label} attempt ${attempt} unusable: ${err.message}`)
    }
  }
  throw new AiError(`AI ${label} reply was unusable twice (${lastError})`)
}
