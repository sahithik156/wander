/**
 * Reusable set of tour locations for checking coverage after changes.
 * Used by tests/locations.spec.ts (opt-in; it makes paid AI and SerpApi calls).
 *
 * `note` records why a location is in the set, not an expected result.
 */

import type { TourTheme } from '../src/schemas/tours-schema'

export interface TestLocation {
  name: string
  lat: number
  lng: number
  minutes: 30 | 60 | 90
  theme: TourTheme
  /** "Include a food stop" (ignored by the Food theme). */
  includeFood?: boolean
  note: string
}

const history60 = (name: string, lat: number, lng: number, note: string): TestLocation => ({
  name,
  lat,
  lng,
  minutes: 60,
  theme: 'history',
  note,
})

export const LOCATIONS: TestLocation[] = [
  // Baselines from earlier slices.
  history60('London', 51.5074, -0.1278, 'Dense English Wikipedia; must make 0 SerpApi calls'),
  history60('Charminar', 17.3616, 78.4747, 'Indian old town with good Wikipedia coverage'),
  history60('Kanaka Durga', 16.515, 80.606, 'Thin Wikipedia, needs the Maps fallback'),
  history60('Highlands', 57.0, -4.5, 'Empty land; should be too_few_places'),

  // Lesser-known cities, where real users will struggle.
  history60('Warangal', 17.9689, 79.5941, 'Indian tier-2 city'),
  history60('Bhuj', 23.242, 69.6669, 'Indian tier-3 city, Gujarat'),
  history60('Tartu', 58.378, 26.729, 'Small European university town'),
  history60('Evora', 38.5714, -7.9087, 'Small Portuguese UNESCO town'),
  history60('Dubuque', 42.5006, -90.6646, 'Small US city'),
  history60('Kumasi', 6.6885, -1.6244, 'West African city'),
  history60('Gondar', 12.603, 37.4521, 'Ethiopian historic city'),
  history60('Cuenca', -2.8974, -79.0045, 'Andean colonial city, Spanish names'),
  history60('Salta', -24.7829, -65.4232, 'Argentine colonial city, Spanish names'),
  history60('Ipoh', 4.5975, 101.0901, 'Malaysian city'),
  history60('Mardin', 37.3122, 40.7351, 'Turkish historic town'),
  history60('Ballarat', -37.5622, 143.8503, 'Australian regional city'),
  history60('Ocean', 0.0, -30.0, 'Mid-Atlantic; nothing should be found'),

  // Themes and food (SPEC.md "Themes", "Food theme", "Include a food stop").
  { ...history60('Charminar Food', 17.3616, 78.4747, 'Food theme; dishes from Hyderabadi cuisine'), theme: 'food' },
  { ...history60('Warangal Food', 17.9689, 79.5941, 'Food theme; dishes from Telangana cuisine'), theme: 'food' },
  { ...history60('London Food', 51.5074, -0.1278, 'Food theme; dishes from British cuisine'), theme: 'food' },
  { ...history60('London History + food stop', 51.5074, -0.1278, 'History with one place to eat added at the end'), includeFood: true },
  {
    ...history60('Warangal Highlights + food stop', 17.9779, 79.5986, 'Browser case: no food stop within 600 m; needs the wider search'),
    theme: 'highlights',
    includeFood: true,
  },
  { ...history60('Kanaka Durga Temples', 16.515, 80.606, 'Temples & sacred places theme'), theme: 'temples' },
]
