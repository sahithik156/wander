import { describe, expect, it } from 'vitest'
import {
  categoryInSentence,
  cleanDescription,
  mapsNarration,
  mapsOnlyTitle,
  removeFiller,
  shortAddress,
  transitionText,
  walkingMinutes,
} from './narration-text'

describe('categoryInSentence', () => {
  it('lowercases the first letter except for proper adjectives', () => {
    expect(categoryInSentence('Tourist attraction')).toBe('tourist attraction')
    expect(categoryInSentence('Castle')).toBe('castle')
    expect(categoryInSentence('Hindu temple')).toBe('Hindu temple')
    expect(categoryInSentence('Catholic cathedral')).toBe('Catholic cathedral')
  })

  it('keeps nationalities and regional cuisines capitalized (real Maps categories)', () => {
    expect(mapsNarration({ category: 'Italian restaurant', address: 'Moghalpura, Hyderabad' })).toBe(
      'An Italian restaurant in Moghalpura, Hyderabad.',
    )
    expect(mapsNarration({ category: 'Sri Lankan restaurant', address: '36 Maiden Ln, London' })).toBe(
      'A Sri Lankan restaurant in 36 Maiden Ln, London.',
    )
    expect(categoryInSentence('South Indian restaurant')).toBe('South Indian restaurant')
    expect(categoryInSentence('Middle Eastern restaurant')).toBe('Middle Eastern restaurant')
    expect(categoryInSentence('Modern Indian restaurant')).toBe('modern Indian restaurant')
    expect(categoryInSentence('South facing park')).toBe('south facing park')
  })
})

describe('mapsOnlyTitle', () => {
  it('builds "[Theme] tour near [first stop]"', () => {
    expect(mapsOnlyTitle('history', 'Anthastula Baavi')).toBe('History tour near Anthastula Baavi')
    expect(mapsOnlyTitle('Temples & sacred places', 'Kush Mahal')).toBe('Temples & sacred places tour near Kush Mahal')
  })
})
import { destinationPoint } from '../lib/geo'

describe('cleanDescription', () => {
  it('keeps the longest sentence of a repeated Google description', () => {
    expect(
      cleanDescription(
        'Ornate Hindu temple & pilgrimage center. Ornate Hindu temple & pilgrimage destination dedicated to the goddess Kanaka Durga.',
      ),
    ).toBe('Ornate Hindu temple & pilgrimage destination dedicated to the goddess Kanaka Durga.')
  })

  it('adds a final period and handles empty text', () => {
    expect(cleanDescription('Rock-cut Hindu temple')).toBe('Rock-cut Hindu temple.')
    expect(cleanDescription('  ')).toBe('')
  })
})

describe('shortAddress', () => {
  it('keeps street and locality, dropping repeats, state + postcode, and country', () => {
    expect(
      shortAddress(
        'Arjuna Street Mallikarjunapeta Indrakeeladri, Durga Agraharam, Mallikarjunapeta, Vijayawada, Andhra Pradesh 520001, India',
      ),
    ).toBe('Arjuna Street Mallikarjunapeta Indrakeeladri, Durga Agraharam, Mallikarjunapeta, Vijayawada')
    expect(
      shortAddress('Kothapeta, Indrakeeladri, behind Komala Vilas Hotel Hill Top, Islampet, Vijayawada, Andhra Pradesh 520001, India'),
    ).toBe('Kothapeta, Indrakeeladri, behind Komala Vilas Hotel Hill Top, Islampet, Vijayawada')
  })

  it('drops plus codes and exact repeated parts', () => {
    expect(
      shortAddress('GJ74+GJ3, Kanaka Durga Temple Steps Rd, Durga Agraharam, Durga Agraharam, Vijayawada, Andhra Pradesh 520001, India'),
    ).toBe('Kanaka Durga Temple Steps Rd, Durga Agraharam, Vijayawada')
  })

  it('leaves short addresses alone and drops UK postcodes', () => {
    expect(shortAddress('Trafalgar Square, London WC2N 5DN, United Kingdom')).toBe('Trafalgar Square, London')
    expect(shortAddress('One Town, Vijayawada')).toBe('One Town, Vijayawada')
    expect(shortAddress('')).toBe('')
  })
})

// Regression guards for SPEC.md "Maps stop text" and "Transitions": exact strings on purpose.
describe('mapsNarration', () => {
  it('with a description, the narration is the description only', () => {
    expect(
      mapsNarration({
        category: 'Hindu temple',
        address: 'Arjuna Street, Vijayawada, Andhra Pradesh 520001, India',
        description:
          'Ornate Hindu temple & pilgrimage center. Ornate Hindu temple & pilgrimage destination dedicated to the goddess Kanaka Durga.',
      }),
    ).toBe('Ornate Hindu temple & pilgrimage destination dedicated to the goddess Kanaka Durga.')
  })

  it('without a description: "A [category] in [last two address parts]"', () => {
    expect(
      mapsNarration({
        category: 'Hindu temple',
        address: 'Kothapeta, Indrakeeladri, behind Komala Vilas Hotel Hill Top, Islampet, Vijayawada, Andhra Pradesh 520001, India',
      }),
    ).toBe('A Hindu temple in Islampet, Vijayawada.')
    expect(mapsNarration({ category: 'Tourist attraction', address: 'Cumhuriyet Meydanı üstü, Şar' })).toBe(
      'A tourist attraction in Cumhuriyet Meydanı üstü, Şar.',
    )
    expect(mapsNarration({ category: 'Art gallery', address: 'One Town, Vijayawada' })).toBe('An art gallery in One Town, Vijayawada.')
  })

  it('falls back when the category or address is missing', () => {
    expect(mapsNarration({ category: 'Hindu temple' })).toBe('A Hindu temple.')
    expect(mapsNarration({ address: 'One Town, Vijayawada' })).toBe('In One Town, Vijayawada.')
    expect(mapsNarration({})).toBe('')
  })
})

describe('transitionText', () => {
  const here = { lat: 16.515, lng: 80.606 }

  it('gives direction, distance, and walking minutes (with the street factor) to the next stop', () => {
    const far = { ...destinationPoint(here, 135, 2200), name: 'Gandhi Hill' }
    expect(transitionText(here, far)).toBe('Head southeast about 2.2 km (38 min on foot) to Gandhi Hill.')
    const near = { ...destinationPoint(here, 135, 189), name: 'Akkanna Madanna Caves' }
    expect(transitionText(here, near)).toBe('Head southeast about 200 meters (3 min on foot) to Akkanna Madanna Caves.')
  })

  it('ends the tour at the last stop', () => {
    expect(transitionText(here)).toBe('The tour ends here.')
  })
})

describe('walkingMinutes', () => {
  it('uses the time budget pace and street factor, at least 1 minute', () => {
    expect(walkingMinutes(2200)).toBe(38)
    expect(walkingMinutes(5)).toBe(1)
  })
})

describe('removeFiller', () => {
  const extract =
    'The Sir Joseph Bazalgette Memorial is a monument by George Blackall Simonds to the Victorian engineer Sir Joseph Bazalgette.'

  it('removes a sentence with a filler word that is not in the extract', () => {
    const narration =
      'The Sir Joseph Bazalgette Memorial honours the Victorian engineer. It stands on the Victoria Embankment. ' +
      "Bazalgette's engineering legacy shaped modern London."
    expect(removeFiller(narration, extract)).toBe(
      'The Sir Joseph Bazalgette Memorial honours the Victorian engineer. It stands on the Victoria Embankment.',
    )
  })

  it('keeps the sentence when the word appears in the extract, and matches whole words only', () => {
    const extractWithWord = 'The memorial is a remarkable example of Victorian sculpture.'
    expect(removeFiller('It is a remarkable example of Victorian sculpture.', extractWithWord)).toBe(
      'It is a remarkable example of Victorian sculpture.',
    )
    expect(removeFiller('The tower has a distinctive shape.', extract)).toBe('The tower has a distinctive shape.')
    expect(removeFiller('This iconic square hosts events. It has a fountain.', extract)).toBe('It has a fountain.')
  })
})

describe('shortAddress (UK postcodes)', () => {
  it('drops UK postcodes', () => {
    expect(shortAddress('41 Garrick St, London WC2E 9AR, United Kingdom')).toBe('41 Garrick St, London')
    expect(mapsNarration({ category: 'Ice cream shop', address: '41 Garrick St, London WC2E 9AR, United Kingdom' })).toBe(
      'An ice cream shop in 41 Garrick St, London.',
    )
  })
})
