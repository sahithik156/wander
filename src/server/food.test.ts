import { describe, expect, it } from 'vitest'
import {
  articleSentences,
  chainKey,
  cuisineQueries,
  dishSentence,
  foodStopTiers,
  needsSweetsSearch,
  tidySentence,
  foodScore,
  isPlaceToEat,
  isSweetsPlace,
  pickCuisineTitle,
  pickFoodStopNear,
  pickFoodStops,
  rankPlacesToEat,
  regionFromAddresses,
  validateDishes,
} from './food'
import { AiJsonError } from './ai-json'
import { destinationPoint } from '../lib/geo'
import type { MapsPlace } from './maps-places'

const pin = { lat: 17.9689, lng: 79.5941 }

let n = 0
const place = (title: string, type: string, rating: number, reviews: number, meters = 500, types?: string[]): MapsPlace => ({
  placeId: `p${n++}-${title}`,
  title,
  ...destinationPoint(pin, (n * 37) % 360, meters),
  type,
  types: types ?? [type],
  rating,
  reviews,
})

describe('isPlaceToEat / isSweetsPlace', () => {
  it('keeps restaurants, street food, and sweets shops; drops suppliers and caterers (real Warangal types)', () => {
    expect(isPlaceToEat({ type: 'Fast food restaurant', types: ['Fast food restaurant', 'Candy store'] })).toBe(true)
    expect(isPlaceToEat({ type: 'Indian sweets shop', types: ['Indian sweets shop'] })).toBe(true)
    expect(isPlaceToEat({ type: 'Snack bar', types: ['Snack bar'] })).toBe(true)
    expect(isPlaceToEat({ type: 'Pub', types: ['Pub'] })).toBe(true)
    expect(isPlaceToEat({ type: 'Food products supplier', types: ['Food products supplier'] })).toBe(false)
    expect(isPlaceToEat({ type: 'Caterer', types: ['Caterer', 'Candy store'] })).toBe(false)
    expect(isPlaceToEat({ type: 'Hindu temple', types: ['Hindu temple'] })).toBe(false)
  })

  it('treats sweets shops, candy stores, bakeries, and dessert places as sweets by primary type', () => {
    expect(isSweetsPlace({ title: 'X', type: 'Candy store', types: ['Candy store'] })).toBe(true)
    expect(isSweetsPlace({ title: 'X', type: 'Indian sweets shop', types: [] })).toBe(true)
    expect(isSweetsPlace({ title: 'X', type: 'Bakery', types: [] })).toBe(true)
    expect(isSweetsPlace({ title: 'X', type: 'Dessert shop', types: [] })).toBe(true)
    expect(isSweetsPlace({ title: 'Kadai Drive In', type: 'Fast food restaurant', types: ['Fast food restaurant', 'Candy store'] })).toBe(false)
  })

  it('counts chocolate, ice cream, and dessert cafes as sweets, by type or name (real London results)', () => {
    expect(isSweetsPlace({ title: 'Venchi', type: 'Chocolate shop', types: [] })).toBe(true)
    expect(isSweetsPlace({ title: 'Amorino Gelato - London Covent Garden', type: 'Ice cream shop', types: [] })).toBe(true)
    expect(isSweetsPlace({ title: "May's Sweet Bite", type: 'Cafe', types: ['Cafe'] })).toBe(true)
    expect(isSweetsPlace({ title: 'Dishoom Covent Garden', type: 'Indian restaurant', types: [] })).toBe(false)
    expect(isSweetsPlace({ title: 'Ice Station Cafe', type: 'Cafe', types: [] })).toBe(false) // "ice" alone is not ice cream
  })
})

describe('foodScore / rankPlacesToEat', () => {
  it('trusts many reviews over a few', () => {
    expect(foodScore({ rating: 4.5, reviews: 300 })).toBeGreaterThan(foodScore({ rating: 4.8, reviews: 6 }))
  })

  it('needs rating 4.0+ and 20+ reviews, inside the radius', () => {
    const good = place('Good', 'Restaurant', 4.5, 300)
    const lowRated = place('Low', 'Restaurant', 3.8, 500)
    const fewReviews = place('Few', 'Restaurant', 4.9, 8)
    const far = place('Far', 'Restaurant', 4.7, 900, 2000)
    const ranked = rankPlacesToEat([fewReviews, lowRated, far, good], pin, 1500, 1)
    expect(ranked.map((p) => p.title)).toEqual(['Good'])
  })

  it('relaxes the review minimum to 5 when too few places qualify', () => {
    const a = place('A', 'Restaurant', 4.5, 30)
    const b = place('B', 'Restaurant', 4.6, 8)
    const c = place('C', 'Snack bar', 4.4, 6)
    expect(rankPlacesToEat([a, b, c], pin, 1500, 3).map((p) => p.title).sort()).toEqual(['A', 'B', 'C'])
  })
})

describe('pickFoodStops (variety rule)', () => {
  it('takes at most one sweets shop, candy store, or bakery, even when they rate best', () => {
    const places = [
      place('Raju Sweet House', 'Indian sweets shop', 4.8, 900),
      place('Swagath Sweets', 'Candy store', 4.7, 800),
      place('Bakery One', 'Bakery', 4.7, 700),
      place('Kadai Drive In', 'Restaurant', 4.2, 1121),
      place('Welvet Restaurants', 'Restaurant', 4.3, 121),
      place('BAJJI WALA', 'Snack bar', 4.5, 129),
    ]
    const picked = pickFoodStops(places, pin, 1500, 4)
    expect(picked).toHaveLength(4)
    expect(picked.filter(isSweetsPlace)).toHaveLength(1)
    expect(picked[0].title).toBe('Raju Sweet House')
    expect(picked.map((p) => p.title)).toEqual(expect.arrayContaining(['Kadai Drive In', 'Welvet Restaurants', 'BAJJI WALA']))
  })

  it('returns fewer stops rather than break the rule', () => {
    const places = [
      place('S1', 'Candy store', 4.8, 900),
      place('S2', 'Candy store', 4.7, 800),
      place('R1', 'Restaurant', 4.2, 300),
    ]
    expect(pickFoodStops(places, pin, 1500, 4).map((p) => p.title)).toEqual(['S1', 'R1'])
  })
})

describe('chainKey / one branch per chain', () => {
  it('drops the branch from chain names', () => {
    expect(chainKey('Amorino Gelato - London Covent Garden')).toBe('amorino gelato')
    expect(chainKey('Amorino Gelato (Soho)')).toBe('amorino gelato')
    expect(chainKey('Venchi')).toBe('venchi')
    expect(chainKey('Raju Sweet House')).toBe('raju sweet house')
  })

  it('keeps only the best-rated branch of a chain', () => {
    const a = place('Venchi', 'Restaurant', 4.9, 2586)
    const b = place('Venchi', 'Restaurant', 4.6, 900)
    const c = place('Dishoom', 'Restaurant', 4.7, 3000)
    expect(rankPlacesToEat([b, a, c], pin, 1500, 2).map((p) => [p.title, p.rating])).toEqual([
      ['Venchi', 4.9],
      ['Dishoom', 4.7],
    ])
  })
})

describe('needsSweetsSearch', () => {
  it('searches sweets only when fewer than 3 good meal places qualify (real Charminar case: 0 meals nearby)', () => {
    const sweetsOnly = [place('Haryana Mithai Ghar', 'Indian sweets shop', 4.6, 254), place('Agra Mithai Ghar & Restaurant', 'Candy store', 4.0, 2043)]
    expect(needsSweetsSearch(sweetsOnly, pin, 1500)).toBe(true)
    const meals = [place('A', 'Restaurant', 4.5, 300), place('B', 'Snack bar', 4.4, 200), place('C', 'Family restaurant', 4.6, 900)]
    expect(needsSweetsSearch(meals, pin, 1500)).toBe(false)
  })
})

describe('foodStopTiers / pickFoodStopNear', () => {
  const last = destinationPoint(pin, 0, 1000)
  const middle = destinationPoint(pin, 90, 3000)
  const normal = foodStopTiers(last, middle, false)
  const name = (r: ReturnType<typeof pickFoodStopNear>) => r?.place.title

  it('searches 600 m of the last stop, then 600 m of the middle, then 1.5 km of the last; spread-out tours start at 1.5 km', () => {
    expect(normal).toEqual([
      { anchor: last, meters: 600 },
      { anchor: middle, meters: 600 },
      { anchor: last, meters: 1500 },
    ])
    expect(foodStopTiers(last, middle, true)).toEqual([{ anchor: last, meters: 1500 }])
  })

  it('picks the best meal within 600 m of the last stop, preferring a meal over sweets', () => {
    const sweets = { ...place('Sweets', 'Candy store', 4.9, 900), ...destinationPoint(last, 0, 100) }
    const meal = { ...place('Meal', 'Restaurant', 4.3, 400), ...destinationPoint(last, 90, 300) }
    const fartherMeal = { ...place('Farther meal', 'Restaurant', 4.9, 900), ...destinationPoint(last, 180, 800) }
    expect(name(pickFoodStopNear([sweets, meal, fartherMeal], normal, new Set()))).toBe('Meal')
  })

  it('falls back to the middle stop, then to 1.5 km of the last stop (Warangal case: nothing within 600 m)', () => {
    const nearMiddle = { ...place('Near middle', 'Restaurant', 4.4, 200), ...destinationPoint(middle, 0, 200) }
    expect(name(pickFoodStopNear([nearMiddle], normal, new Set()))).toBe('Near middle')
    const wide = { ...place('1.2 km away', 'Restaurant', 4.5, 300), ...destinationPoint(last, 180, 1200) }
    const result = pickFoodStopNear([wide], normal, new Set())
    expect(name(result)).toBe('1.2 km away')
    expect(result?.tier.meters).toBe(1500)
  })

  it('spread-out tours accept a place up to 1.5 km away straight away; excluded places and empty results give nothing', () => {
    const wide = { ...place('1.2 km away', 'Restaurant', 4.5, 300), ...destinationPoint(last, 180, 1200) }
    expect(name(pickFoodStopNear([wide], foodStopTiers(last, middle, true), new Set()))).toBe('1.2 km away')
    expect(pickFoodStopNear([wide], normal, new Set([wide.placeId]))).toBeUndefined()
    const tooFar = { ...place('Too far', 'Restaurant', 4.9, 900), ...destinationPoint(last, 180, 2000) }
    expect(pickFoodStopNear([tooFar], normal, new Set())).toBeUndefined()
    expect(pickFoodStopNear([], normal, new Set())).toBeUndefined()
  })
})

describe('regionFromAddresses / cuisineQueries / pickCuisineTitle', () => {
  it('reads city, state, and country from Indian addresses (real Warangal results)', () => {
    const region = regionFromAddresses([
      '8-12-126, Pinnavari St, Sherpura, Warangal, Telangana 506002, India',
      'Swami Vivekananda Rd, Battala Bazar, Ramannapet, Warangal, Telangana 506002, India',
      '17-4-138, Kareemabad Rd, Kareemabad, Warangal, Telangana 506002, India',
    ])
    expect(region).toEqual({ city: 'Warangal', state: 'Telangana', country: 'India' })
    expect(cuisineQueries(region)).toEqual([
      { query: 'Warangal cuisine', level: 'local' },
      { query: 'Telangana cuisine', level: 'local' },
      { query: 'India cuisine', level: 'country' },
    ])
  })

  it('handles UK addresses, where the postcode sits with the city', () => {
    const region = regionFromAddresses(['12 Strand, London WC2N 5HR, United Kingdom', '3 Villiers St, London WC2N 6NG, United Kingdom'])
    expect(region.state).toBe('London')
    expect(region.country).toBe('United Kingdom')
  })

  it('accepts local cuisine titles only with the place stem, country titles by position (real search results)', () => {
    expect(pickCuisineTitle('Warangal cuisine', 'local', ['Warangal', 'Sarva Pindi', 'Telangana', 'Culture of Telangana'])).toBeUndefined()
    expect(pickCuisineTitle('Telangana cuisine', 'local', ['Telangana cuisine', 'Andhra cuisine'])).toBe('Telangana cuisine')
    expect(pickCuisineTitle('Hyderabad cuisine', 'local', ['Hyderabadi cuisine', 'Hyderabadi biryani'])).toBe('Hyderabadi cuisine')
    expect(pickCuisineTitle('London cuisine', 'local', ['British cuisine', 'Haute cuisine'])).toBeUndefined()
    expect(pickCuisineTitle('United Kingdom cuisine', 'country', ['British cuisine', 'List of British desserts'])).toBe('British cuisine')
  })
})

describe('articleSentences / dishSentence', () => {
  const article = [
    'Hyderabadi cuisine is the cooking style of Hyderabad.',
    '',
    '== Desserts ==',
    'Qubani ka meetha',
    'Qubani ka meetha is an apricot pudding, topped with almond and cream. It is served at weddings.',
    '== Highlights and staples of British cuisine ==',
  ].join('\n')

  it('skips headings and fragments such as bare list labels', () => {
    expect(articleSentences(article)).toEqual([
      'Hyderabadi cuisine is the cooking style of Hyderabad.',
      'Qubani ka meetha is an apricot pudding, topped with almond and cream.',
      'It is served at weddings.',
    ])
  })

  it('picks the first full sentence containing the dish name, or nothing', () => {
    expect(dishSentence('Qubani ka meetha', article)).toBe('Qubani ka meetha is an apricot pudding, topped with almond and cream.')
    expect(dishSentence('Lukhmi', article)).toBe('')
  })
})

describe('validateDishes', () => {
  const article = [
    'Telangana cuisine features Sarva Pindi, a spicy pancake made of rice flour.',
    '== Highlights and staples of British cuisine ==',
    'Sakinalu',
    'Pachi pulusu is a tamarind soup.',
  ].join('\n')

  it('keeps only dish names found word for word; the note is a full article sentence containing the name, never a heading', () => {
    const out = validateDishes(
      {
        dishes: [
          { name: 'Sarva Pindi', note: 'AI note is ignored' },
          { name: 'Hyderabadi biryani' }, // not in the article
          { name: 'Sakinalu' }, // only appears as a bare label: no note
          { name: 'Sarva Pindi' }, // duplicate
          { name: 'Pachi pulusu', note: 'Highlights and staples of British cuisine' },
        ],
      },
      article,
    )
    expect(out).toEqual([
      { name: 'Sarva Pindi', note: 'Telangana cuisine features Sarva Pindi, a spicy pancake made of rice flour.' },
      { name: 'Sakinalu', note: '' },
      { name: 'Pachi pulusu', note: 'Pachi pulusu is a tamarind soup.' },
    ])
  })

  it('throws (so the call is retried) when no dish is in the article, or the shape is wrong', () => {
    expect(() => validateDishes({ dishes: [{ name: 'Pizza' }] }, article)).toThrow(AiJsonError)
    expect(() => validateDishes({ items: [] }, article)).toThrow(AiJsonError)
  })
})

describe('dish notes: tighter rules (real article text)', () => {
  it('prefers a sentence that starts with the dish name', () => {
    const article =
      'Biryani and Haleem are prepared all over India, but the Hyderabadi variety comes from the Hyderabadi Biryani and Hyderabadi Haleem.\n' +
      'Hyderabadi Haleem is a stew composed of mutton, lentils, spices and wheat.'
    expect(dishSentence('Hyderabadi Haleem', article)).toBe(
      'Hyderabadi Haleem is a stew composed of mutton, lentils, spices and wheat.',
    )
  })

  it('never gives two dishes the same sentence', () => {
    const article =
      "Highlights and staples of British cuisine include the roast dinner, shepherd's pie, toad in the hole and fish and chips.\n" +
      'Fish and chips is a hot dish of fried fish and chips.'
    const out = validateDishes(
      { dishes: [{ name: 'fish and chips' }, { name: "shepherd's pie" }, { name: 'toad in the hole' }] },
      article,
    )
    expect(out).toEqual([
      { name: 'fish and chips', note: 'Fish and chips is a hot dish of fried fish and chips.' },
      {
        name: "shepherd's pie",
        note: "Highlights and staples of British cuisine include the roast dinner, shepherd's pie, toad in the hole and fish and chips.",
      },
      { name: 'toad in the hole', note: '' },
    ])
  })

  it('skips list entries ("Name - description") and tidies stray quotes and spaces', () => {
    const article =
      'Qubani ka meetha (Khubani-ka-meetha) - Apricot pudding, topped with almond and cream.\n' +
      'Telangana  in its cuisine, there is special place for rotis made from millet, such as jonna rotte (sorghum), or Sarva Pindi" and Uppudi Pindi.'
    expect(dishSentence('Qubani ka meetha', article)).toBe('')
    expect(dishSentence('jonna rotte', article)).toBe(
      'Telangana in its cuisine, there is special place for rotis made from millet, such as jonna rotte (sorghum), or Sarva Pindi and Uppudi Pindi.',
    )
  })

  it('tidySentence keeps balanced quotes', () => {
    expect(tidySentence('It is called "the king of dishes" locally .')).toBe('It is called "the king of dishes" locally.')
  })
})
