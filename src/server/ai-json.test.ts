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
  const ids = new Set(['w:10', 'w:20', 'w:30', 'm:ChIJa', 'm:ChIJb', 'w:60', 'w:70', 'w:80', 'w:90'])

  it('drops ids not in the candidate list and duplicates', () => {
    const obj = {
      stops: [
        { id: 'w:10', reason: 'a' },
        { id: 'w:999', reason: 'invented' },
        { id: 'w:10', reason: 'dup' },
        { id: 'm:ChIJa', reason: 'maps place' },
        { id: 'm:ChIJzzz', reason: 'invented maps id' },
        { id: 1.5 },
        'junk',
      ],
    }
    expect(validateSelection(obj, ids)).toEqual([
      { id: 'w:10', reason: 'a' },
      { id: 'm:ChIJa', reason: 'maps place' },
    ])
  })

  it('reads a bare numeric pageid as a Wikipedia id', () => {
    const obj = { stops: [{ pageid: 20 }, { id: '30' }, { pageid: 'w:60' }] }
    expect(validateSelection(obj, ids).map((s) => s.id)).toEqual(['w:20', 'w:30', 'w:60'])
  })

  it('keeps every valid stop in the model order (the job caps later)', () => {
    const obj = { stops: [...ids].reverse().map((id) => ({ id })) }
    expect(validateSelection(obj, ids).map((s) => s.id)).toEqual([...ids].reverse())
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
  it('returns narration per stop id and the title', () => {
    const obj = {
      title: ' Old Westminster ',
      stops: [
        { id: 'w:1', narration: 'One—two.', transition: 'ignored' },
        { id: 'm:ChIJa', narration: 'A temple.' },
        { id: 'w:3', narration: 'Not a stop.' },
      ],
    }
    const out = validateNarration(obj, ['w:1', 'm:ChIJa'])
    expect(out.title).toBe('Old Westminster')
    expect(out.byId.get('w:1')).toBe('One, two.')
    expect(out.byId.get('m:ChIJa')).toBe('A temple.')
    expect(out.byId.has('w:3')).toBe(false)
  })

  it('throws when a stop has no narration', () => {
    const obj = { title: 't', stops: [{ id: 'w:1', narration: 'One.' }, { id: 'w:2', narration: '  ' }] }
    expect(() => validateNarration(obj, ['w:1', 'w:2'])).toThrow(/missing for 1 of 2/)
  })
})
