import { describe, expect, it } from 'vitest'
import { filterPlaces, type Place } from './wikipedia'

const place = (title: string, pageid: number): Place => ({ pageid, title, lat: 51.5, lng: -0.12, dist: pageid })
const titles = (places: Place[]) => places.map((p) => p.title)

describe('filterPlaces', () => {
  it('keeps landmarks whose titles contain commas or a district name', () => {
    const input = [
      place('Trafalgar Square', 1),
      place('Statue of Charles James Napier, Trafalgar Square', 2),
      place('One Tree Hill, Honor Oak', 3),
    ]
    expect(titles(filterPlaces(input))).toEqual([
      'Trafalgar Square',
      'Statue of Charles James Napier, Trafalgar Square',
      'One Tree Hill, Honor Oak',
    ])
  })

  it('drops the SPEC noise substrings, case-insensitively', () => {
    const input = [
      place('Lewisham and Deptford (UK Parliament constituency)', 1),
      place('Greenwich and Woolwich (UK Parliament constituency)', 2),
      place('Dartmouth Road', 3),
      place('Greater London Built-up Area', 4),
      place('Some Constituency Office', 5),
      place('Horniman Museum', 6),
    ]
    expect(titles(filterPlaces(input))).toEqual(['Horniman Museum'])
  })

  it('drops non-walkable coordinate types but keeps untyped places and "city" landmarks', () => {
    // Real places and types from the coverage run (gsprop=type).
    const typed = (title: string, pageid: number, type?: string): Place => ({ ...place(title, pageid), ...(type ? { type } : {}) })
    const input = [
      typed('Tartu offensive', 1, 'event'),
      typed('Tartu County', 2, 'adm1st'),
      typed('City of Ballarat', 3, 'adm2nd'),
      typed('Bee Branch Creek', 4, 'river'),
      typed('Fasil Ghebbi', 5, 'city'), // a castle complex Wikipedia tags as city
      typed('Gondar Castle gate', 6), // no type: kept
      typed('Lesser Angereb', 7), // a river, but no type: this filter cannot catch it
      typed('Roman Temple of Évora', 8, 'landmark'),
    ]
    expect(titles(filterPlaces(input))).toEqual(['Fasil Ghebbi', 'Gondar Castle gate', 'Lesser Angereb', 'Roman Temple of Évora'])
  })

  it('keeps lakes and rivers when asked (Nature & parks theme)', () => {
    const typed = (title: string, pageid: number, type: string): Place => ({ ...place(title, pageid), type })
    const input = [typed('Bee Branch Creek', 1, 'river'), typed('Hussain Sagar', 2, 'waterbody'), typed('Tartu offensive', 3, 'event')]
    expect(titles(filterPlaces(input, { keepWater: true }))).toEqual(['Bee Branch Creek', 'Hussain Sagar'])
    expect(titles(filterPlaces(input))).toEqual([])
  })

  it('drops battles and sieges by title prefix only', () => {
    const input = [
      place('Battle of Gondar', 1),
      place('Siege of Mardin', 2),
      place('battle of Culqualber', 3),
      place('Memorial to the Battle of Britain', 4),
      place('Fasil Ghebbi', 5),
    ]
    expect(titles(filterPlaces(input))).toEqual(['Memorial to the Battle of Britain', 'Fasil Ghebbi'])
  })

  it('drops organizations by title prefix only', () => {
    const input = [
      place('Diocese of Vijayawada', 1),
      place('Roman Catholic Archdiocese of Hyderabad', 2),
      place('archdiocese of Visakhapatnam', 3),
      place("St. Paul's Cathedral, Diocese of London", 4),
    ]
    // Only titles that START with the prefix are dropped.
    expect(titles(filterPlaces(input))).toEqual([
      'Roman Catholic Archdiocese of Hyderabad',
      "St. Paul's Cathedral, Diocese of London",
    ])
  })

  it('keeps at most one railway station and one school, the nearest of each', () => {
    const input = [
      place('Forest Hill railway station', 1),
      place('Forest Hill School', 2),
      place('Honor Oak Park railway station', 3),
      place('Sydenham School', 4),
      place('Horniman Museum', 5),
    ]
    expect(titles(filterPlaces(input))).toEqual([
      'Forest Hill railway station',
      'Forest Hill School',
      'Horniman Museum',
    ])
  })

  it('preserves order and returns nothing for an empty list', () => {
    expect(filterPlaces([])).toEqual([])
    const input = [place('B', 2), place('A', 1)]
    expect(titles(filterPlaces(input))).toEqual(['B', 'A'])
  })
})
