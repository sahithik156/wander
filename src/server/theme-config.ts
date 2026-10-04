/**
 * Per-theme guidance (SPEC.md "Themes"): what the AI should look for among
 * Wikipedia places, and the Google Maps query used when Wikipedia is thin.
 * The Food theme has its own flow (food.ts); its query here finds places to
 * eat for both the Food theme and "Include a food stop".
 *
 * Maps queries are plain phrases, never comma lists: Google can read a list
 * as the name of one place and return just that place ("temples, churches,
 * mosques, shrines" returned one church). Each query below was checked live
 * to return a list; "historic buildings and architecture" returned nothing.
 */

import type { TourTheme } from '../schemas/tours-schema'

export interface ThemeConfig {
  /** Shown to the AI as the selection guidance for Wikipedia places. */
  wikipedia: string
  /** serpapi/places-search query. */
  mapsQuery: string
}

/** Food theme: extra search when the meal search gives too few meals (food.ts needsSweetsSearch). */
export const FOOD_SWEETS_QUERY = 'sweet shops'

export const THEME_CONFIG: Record<TourTheme, ThemeConfig> = {
  history: {
    wikipedia: 'historic buildings, monuments, memorials, ruins, forts, and sites where notable things happened',
    mapsQuery: 'historical landmarks and monuments',
  },
  architecture: {
    wikipedia: 'notable buildings, bridges, and structures, and how they were designed and built',
    mapsQuery: 'historic buildings',
  },
  art: {
    wikipedia: 'museums, art galleries, public sculpture, murals, theatres, and places tied to artists',
    mapsQuery: 'museums and art galleries',
  },
  temples: {
    wikipedia: 'temples, churches, mosques, gurdwaras, synagogues, shrines, monasteries, and other places of worship or pilgrimage',
    mapsQuery: 'temples and places of worship',
  },
  nature: {
    wikipedia: 'parks, gardens, lakes, rivers, hills, viewpoints, and nature reserves a visitor can go to',
    mapsQuery: 'parks and gardens',
  },
  food: {
    wikipedia: 'places to eat',
    // Meals only: with "sweet shops" in the query, 16 of 20 Charminar results
    // were sweet shops. Sweets get their own search (FOOD_SWEETS_QUERY).
    mapsQuery: 'restaurants and street food',
  },
  highlights: {
    wikipedia: 'the most notable and interesting places of any kind',
    mapsQuery: 'top tourist attractions',
  },
}
