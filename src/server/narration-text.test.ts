import { describe, expect, it } from 'vitest'
import {
  categoryInSentence,
  cleanDescription,
  mapsNarration,
  mapsOnlyTitle,
  shortAddress,
  transitionText,
} from './narration-text'

describe('categoryInSentence', () => {
  it('lowercases the first letter except for proper adjectives', () => {
    expect(categoryInSentence('Tourist attraction')).toBe('tourist attraction')
    expect(categoryInSentence('Castle')).toBe('castle')
    expect(categoryInSentence('Hindu temple')).toBe('Hindu temple')
    expect(categoryInSentence('Catholic cathedral')).toBe('Catholic cathedral')
  })
})

describe('mapsOnlyTitle', () => {
  it('builds "[Theme] walk near [first stop]"', () => {
    expect(mapsOnlyTitle('history', 'Anthastula Baavi')).toBe('History walk near Anthastula Baavi')
    expect(mapsOnlyTitle('surprise me', 'Kush Mahal')).toBe('Surprise me walk near Kush Mahal')
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

  it('leaves short addresses and non-numeric postcodes alone', () => {
    expect(shortAddress('Trafalgar Square, London WC2N 5DN, United Kingdom')).toBe('Trafalgar Square, London WC2N 5DN')
    expect(shortAddress('One Town, Vijayawada')).toBe('One Town, Vijayawada')
    expect(shortAddress('')).toBe('')
  })
})

describe('mapsNarration', () => {
  it('restates name, category, short address, and description, and nothing else', () => {
    expect(
      mapsNarration({
        name: 'Sri Durga Malleswara Swamy Varla Devasthanam',
        category: 'Hindu temple',
        address: 'Arjuna Street, Vijayawada, Andhra Pradesh 520001, India',
        description:
          'Ornate Hindu temple & pilgrimage center. Ornate Hindu temple & pilgrimage destination dedicated to the goddess Kanaka Durga.',
      }),
    ).toBe(
      'Sri Durga Malleswara Swamy Varla Devasthanam is a Hindu temple at Arjuna Street, Vijayawada. ' +
        'Ornate Hindu temple & pilgrimage destination dedicated to the goddess Kanaka Durga.',
    )
  })

  it('handles missing fields and picks "an" before a vowel', () => {
    expect(mapsNarration({ name: 'Ram Mandir', category: 'Hindu temple' })).toBe('Ram Mandir is a Hindu temple.')
    expect(mapsNarration({ name: 'X', category: 'Art gallery' })).toBe('X is an art gallery.')
    expect(mapsNarration({ name: 'Mardin Museum', category: 'Tourist attraction', address: 'Cumhuriyet Meydanı üstü, Şar' })).toBe(
      'Mardin Museum is a tourist attraction at Cumhuriyet Meydanı üstü, Şar.',
    )
    expect(mapsNarration({ name: 'Ram Mandir', address: 'One Town, Vijayawada' })).toBe(
      'Ram Mandir is at One Town, Vijayawada.',
    )
    expect(mapsNarration({ name: 'Ram Mandir' })).toBe('Ram Mandir.')
  })
})

describe('transitionText', () => {
  const here = { lat: 16.515, lng: 80.606 }

  it('gives direction and distance to the next stop by name', () => {
    const next = { ...destinationPoint(here, 135, 189), name: 'Akkanna Madanna Caves' }
    expect(transitionText(here, next)).toBe('Walk southeast about 200 meters to Akkanna Madanna Caves.')
  })

  it('ends the tour at the last stop', () => {
    expect(transitionText(here)).toBe('The tour ends here.')
  })
})
