import { describe, expect, it } from 'vitest'
import {
  filterMapsPlaces,
  isUnwantedType,
  mapsCandidate,
  mergeSources,
  normalizeName,
  parseMapsResults,
  type MapsPlace,
} from './maps-places'
import { destinationPoint } from '../lib/geo'
import type { Candidate } from './candidate'

const pin = { lat: 16.5062, lng: 80.648 }

const place = (over: Partial<MapsPlace> & { title: string }): MapsPlace => ({
  placeId: over.title,
  lat: pin.lat,
  lng: pin.lng,
  types: [],
  ...over,
})

const wiki = (pageid: number, title: string, at = pin): Candidate => ({
  id: `w:${pageid}`,
  source: 'wikipedia',
  title,
  ...at,
  dist: 0,
  text: 'extract',
  pageid,
  link: `https://en.wikipedia.org/?curid=${pageid}`,
})

describe('parseMapsResults', () => {
  it('reads local_results and maps the fields', () => {
    const data = {
      local_results: [
        {
          title: 'Akkanna Madanna Caves',
          place_id: 'ChIJ1',
          gps_coordinates: { latitude: 16.51, longitude: 80.6 },
          type: 'Tourist attraction',
          types: ['Tourist attraction'],
          address: 'Arjuna St, Vijayawada',
          rating: 4.4,
          reviews: 2229,
          description: 'Rock-cut Hindu temple.',
        },
      ],
    }
    expect(parseMapsResults(data)).toEqual([
      {
        placeId: 'ChIJ1',
        title: 'Akkanna Madanna Caves',
        lat: 16.51,
        lng: 80.6,
        type: 'Tourist attraction',
        types: ['Tourist attraction'],
        address: 'Arjuna St, Vijayawada',
        rating: 4.4,
        reviews: 2229,
        description: 'Rock-cut Hindu temple.',
      },
    ])
  })

  it('skips rows without coordinates, id, or name, and tolerates missing fields', () => {
    const data = {
      local_results: [
        { title: 'No coords', place_id: 'a' },
        { place_id: 'b', gps_coordinates: { latitude: 1, longitude: 2 } },
        { title: 'Bare', place_id: 'c', gps_coordinates: { latitude: 1, longitude: 2 } },
        'junk',
      ],
    }
    expect(parseMapsResults(data)).toEqual([{ placeId: 'c', title: 'Bare', lat: 1, lng: 2, types: [] }])
  })

  it('replaces backticks in names with apostrophes', () => {
    const data = { local_results: [{ title: 'Emperor`s Chapel', place_id: 'x', gps_coordinates: { latitude: 1, longitude: 2 } }] }
    expect(parseMapsResults(data)[0].title).toBe("Emperor's Chapel")
  })

  it('returns nothing for an empty or odd reply', () => {
    expect(parseMapsResults(null)).toEqual([])
    expect(parseMapsResults({})).toEqual([])
    expect(parseMapsResults({ local_results: [] })).toEqual([])
  })
})

describe('isUnwantedType / filterMapsPlaces', () => {
  it('drops Bar, Restaurant, and Hotel types', () => {
    expect(isUnwantedType({ type: 'Bar', types: ['Bar'] })).toBe(true)
    expect(isUnwantedType({ type: 'Restaurant', types: [] })).toBe(true)
    expect(isUnwantedType({ type: 'Hindu temple', types: ['Hindu temple', 'Hotel'] })).toBe(true)
    expect(isUnwantedType({ types: ['Guest house'] })).toBe(true)
    expect(isUnwantedType({ types: ['Café'] })).toBe(true)
  })

  it('matches whole words only, never substrings', () => {
    expect(isUnwantedType({ type: 'Dam', types: ['Dam'] })).toBe(false)
    expect(isUnwantedType({ type: 'Barrage', types: [] })).toBe(false) // "bar"
    expect(isUnwantedType({ type: 'Dinner theater', types: [] })).toBe(false) // "inn"
    expect(isUnwantedType({ type: 'Restored mansion', types: [] })).toBe(false) // "store"
    expect(isUnwantedType({ type: 'Guest lecture hall', types: ['House of worship'] })).toBe(false) // not "guest house"
  })

  it('keeps temples, bazaars, and a dam called "Prakasam Barrage" inside the radius', () => {
    const keep = [
      place({ title: 'Prakasam Barrage', type: 'Dam', types: ['Dam'] }),
      place({ title: 'Kanaka Durga Temple', type: 'Hindu temple', types: ['Hindu temple'] }),
      place({ title: 'Laad Bazaar', type: 'Market', types: ['Market', 'Tourist attraction'] }),
    ]
    const drop = [place({ title: 'Hotel Ilapuram', type: 'Hotel', types: ['Hotel'] })]
    expect(filterMapsPlaces([...keep, ...drop], pin, 1500).map((p) => p.title)).toEqual(keep.map((p) => p.title))
  })

  it('drops anything beyond the radius', () => {
    const near = place({ title: 'Near', ...destinationPoint(pin, 0, 1400) })
    const far = place({ title: 'Far', ...destinationPoint(pin, 0, 1600) })
    expect(filterMapsPlaces([near, far], pin, 1500).map((p) => p.title)).toEqual(['Near'])
  })
})

describe('normalizeName', () => {
  it('ignores case, accents, punctuation, parentheses, and "the"', () => {
    expect(normalizeName('Charminar (monument)')).toBe(normalizeName('Charminar'))
    expect(normalizeName('The Café Museum!')).toBe('cafe museum')
    expect(normalizeName('Sri Venkateswara Swamy Temple.')).toBe('sri venkateswara swamy temple')
  })

  it('does not treat different names as equal', () => {
    expect(normalizeName('Sri Kanaka Durga Temple')).not.toBe(normalizeName('Kanaka Durga Temple'))
  })
})

describe('mergeSources', () => {
  const caves = wiki(1, 'Mogalrajapuram Caves')
  const asMaps = (p: MapsPlace) => mapsCandidate(p, pin)

  it('keeps every Wikipedia candidate and tags maps candidates with source and link', () => {
    const temple = asMaps(place({ title: 'Ram Mandir', type: 'Hindu temple', ...destinationPoint(pin, 90, 800) }))
    const merged = mergeSources([caves], [temple])
    expect(merged.map((c) => c.id)).toEqual(['w:1', 'm:Ram Mandir'])
    expect(merged[1].source).toBe('maps')
    expect(merged[1].category).toBe('Hindu temple')
    expect(merged[1].link).toContain('query_place_id=Ram%20Mandir')
  })

  it('drops a maps place with the same normalized name as a Wikipedia place', () => {
    const dup = asMaps(place({ title: 'Mogalrajapuram caves', ...destinationPoint(pin, 0, 400) }))
    expect(mergeSources([caves], [dup]).map((c) => c.id)).toEqual(['w:1'])
  })

  it('drops a maps place within 50 m of a Wikipedia place, keeps one 60 m away', () => {
    const close = asMaps(place({ title: 'Cave temple', ...destinationPoint(pin, 0, 40) }))
    const apart = asMaps(place({ title: 'Other temple', ...destinationPoint(pin, 0, 60) }))
    expect(mergeSources([caves], [close, apart]).map((c) => c.id)).toEqual(['w:1', 'm:Other temple'])
  })

  it('drops repeated maps places and handles empty inputs', () => {
    const t = asMaps(place({ title: 'Temple', ...destinationPoint(pin, 0, 500) }))
    expect(mergeSources([], [t, t]).map((c) => c.id)).toEqual(['m:Temple'])
    expect(mergeSources([caves], [])).toEqual([caves])
    expect(mergeSources([], [])).toEqual([])
  })
})
