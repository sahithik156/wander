/**
 * Tours — one row per tour a user builds.
 *
 * Writes: a member creates their own tour and may later change only `title`
 * and `isPublic`. `writableFields` lists what a client may send on create;
 * the geometry columns are `immutable` so they can't be edited afterwards.
 * `ownerId` is `userBound` (stamped from the verified session on create, and
 * a client-supplied value is rejected because it is not in writableFields).
 * `status` and `errorMessage` are written only by the build-tour job through
 * the owner context, which bypasses user RBAC.
 *
 * `isPublic` is 'public' | 'private' text because `visibilityField`'s string
 * form matches the literal 'public'. Read 'published' = owner OR public.
 * Deleting tours is deliberately off until a later slice.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const TOUR_STATUSES = [
  'queued',
  'finding',
  'choosing',
  'writing',
  'done',
  'failed',
  'too_few_places',
] as const
export type TourStatus = (typeof TOUR_STATUSES)[number]

/** Themes offered in the builder, in display order (SPEC.md "Themes"). */
export const TOUR_THEMES = ['history', 'architecture', 'art', 'temples', 'nature', 'food', 'highlights'] as const
export type TourTheme = (typeof TOUR_THEMES)[number]

export const THEME_LABEL: Record<TourTheme, string> = {
  history: 'History',
  architecture: 'Architecture',
  art: 'Art & museums',
  temples: 'Temples & sacred places',
  nature: 'Nature & parks',
  food: 'Food',
  highlights: 'Highlights',
}

/** Stored by tours built before the theme list changed; read as 'highlights'. */
export const LEGACY_THEMES = ['surprise me'] as const
export type StoredTheme = TourTheme | (typeof LEGACY_THEMES)[number]

export function normalizeTheme(theme: string): TourTheme {
  return (TOUR_THEMES as readonly string[]).includes(theme) ? (theme as TourTheme) : 'highlights'
}

/** A signature dish picked from the regional cuisine article (Food theme). */
export interface Dish {
  name: string
  /** One short line, taken from the article. */
  note: string
}

export const TOUR_MINUTES = [30, 60, 90] as const

export interface TourData {
  ownerId: string
  title: string
  lat: number
  lng: number
  theme: StoredTheme
  minutes: number
  /** "Include a food stop" (not used by the Food theme). */
  includeFood?: boolean
  /** Set when the food stop was asked for but no place qualified (or the search failed). */
  foodStopMissing?: boolean
  /** Food theme: dishes from the cuisine article; absent when none was found. */
  dishes?: Dish[]
  cuisineTitle?: string
  cuisineUrl?: string
  status: TourStatus
  errorMessage?: string
  isPublic: 'public' | 'private'
}

/** The only fields a client may send. Everything else is server-owned. */
export type TourCreateData = Pick<TourData, 'title' | 'lat' | 'lng' | 'minutes'> & { theme: TourTheme } & Partial<
    Pick<TourData, 'isPublic' | 'includeFood'>
  >

const CLIENT_WRITABLE_FIELDS = ['title', 'lat', 'lng', 'theme', 'minutes', 'isPublic', 'includeFood']

export const toursSchema: CollectionSchema = {
  name: 'tours',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'lat', storage: 'number', interpretation: 'plain', immutable: true, required: true },
    { name: 'lng', storage: 'number', interpretation: 'plain', immutable: true, required: true },
    { name: 'theme', storage: 'text', interpretation: { kind: 'select', options: [...TOUR_THEMES, ...LEGACY_THEMES] }, immutable: true, required: true },
    { name: 'includeFood', storage: 'number', interpretation: { kind: 'boolean' }, immutable: true },
    { name: 'foodStopMissing', storage: 'number', interpretation: { kind: 'boolean' } },
    { name: 'dishes', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'cuisineTitle', storage: 'text', interpretation: 'plain' },
    { name: 'cuisineUrl', storage: 'text', interpretation: { kind: 'url' } },
    { name: 'minutes', storage: 'number', interpretation: 'plain', immutable: true, required: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: [...TOUR_STATUSES] }, default: 'queued' },
    { name: 'errorMessage', storage: 'text', interpretation: 'plain' },
    { name: 'isPublic', storage: 'text', interpretation: { kind: 'select', options: ['private', 'public'] }, default: 'private' },
  ],
  ownerField: 'ownerId',
  visibilityField: 'isPublic',
  permissions: {
    // Signed-out visitors and viewers can read only public tours.
    '*': { read: 'published', create: false, update: false, delete: false },
    viewer: { read: 'published', create: false, update: false, delete: false },
    member: {
      read: 'published',
      create: true,
      update: 'own',
      delete: false,
      writableFields: CLIENT_WRITABLE_FIELDS,
    },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
