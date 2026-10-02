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
