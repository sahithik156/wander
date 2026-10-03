import { describe, expect, it } from 'vitest'
import { AiJsonError, extractJson, stripEmDashes, validateNarration, validateSelection } from './ai-json'

describe('extractJson', () => {
  it('parses clean JSON', () => {
    expect(extractJson('{"stops":[{"pageid":1}]}')).toEqual({ stops: [{ pageid: 1 }] })
  })

  it('strips prose and code fences around the object', () => {
    const text = 'Here are the stops:\n```json\n{"stops":[{"pageid":2,"reason":"old"}]}\n```\nEnjoy!'
    expect(extractJson(text)).toEqual({ stops: [{ pageid: 2, reason: 'old' }] })
  })

  it('keeps braces inside strings and nested objects', () => {
    expect(extractJson('x {"a":{"b":"{not json}"}} y')).toEqual({ a: { b: '{not json}' } })
  })

  it('throws AiJsonError on garbage or truncated JSON', () => {
    expect(() => extractJson('no json here')).toThrow(AiJsonError)
    expect(() => extractJson('{"stops":[{"pageid":1}')).toThrow(AiJsonError)
    expect(() => extractJson('} backwards {')).toThrow(AiJsonError)
  })
})

describe('validateSelection', () => {
  const ids = new Set([10, 20, 30, 40, 50, 60, 70, 80, 90])

  it('drops pageids not in the candidate list and duplicates', () => {
    const obj = {
      stops: [
        { pageid: 10, reason: 'a' },
        { pageid: 999, reason: 'invented' },
        { pageid: 10, reason: 'dup' },
        { pageid: '20', reason: 'string id' },
        { pageid: 1.5 },
        'junk',
      ],
    }
    expect(validateSelection(obj, ids)).toEqual([
      { pageid: 10, reason: 'a' },
      { pageid: 20, reason: 'string id' },
    ])
  })

  it('keeps every valid stop in the model order (the job caps later)', () => {
    const obj = { stops: [...ids].reverse().map((pageid) => ({ pageid })) }
    expect(validateSelection(obj, ids).map((s) => s.pageid)).toEqual([...ids].reverse())
  })

  it('throws on the wrong shape', () => {
    expect(() => validateSelection({ places: [] }, ids)).toThrow(AiJsonError)
    expect(() => validateSelection([], ids)).toThrow(AiJsonError)
  })
})

describe('stripEmDashes', () => {
  it('turns em dashes and spaced en dashes into commas', () => {
    expect(stripEmDashes('the centre of London—distances are measured here')).toBe(
      'the centre of London, distances are measured here',
    )
    expect(stripEmDashes('A statue — bronze — from 1633.')).toBe('A statue, bronze, from 1633.')
    expect(stripEmDashes('Built in stone – later rebuilt.')).toBe('Built in stone, later rebuilt.')
  })

  it('keeps range en dashes and tidies a dash before punctuation', () => {
    expect(stripEmDashes('Open 1820–1830.')).toBe('Open 1820–1830.')
    expect(stripEmDashes('It was finished—.')).toBe('It was finished.')
  })
})

describe('validateNarration', () => {
  it('returns narration per stop and the title', () => {
    const obj = {
      title: ' Old Westminster ',
      stops: [
        { pageid: 1, narration: 'One—two.', transition: 'Walk north.' },
        { pageid: 2, narration: 'Two.' },
        { pageid: 3, narration: 'Not a stop.' },
      ],
    }
    const out = validateNarration(obj, [1, 2])
    expect(out.title).toBe('Old Westminster')
    expect(out.byPageid.get(1)).toEqual({ narration: 'One, two.', transition: 'Walk north.' })
    expect(out.byPageid.get(2)).toEqual({ narration: 'Two.', transition: '' })
    expect(out.byPageid.has(3)).toBe(false)
  })

  it('throws when a stop has no narration', () => {
    const obj = { title: 't', stops: [{ pageid: 1, narration: 'One.' }, { pageid: 2, narration: '  ' }] }
    expect(() => validateNarration(obj, [1, 2])).toThrow(/missing for 1 of 2/)
  })
})
