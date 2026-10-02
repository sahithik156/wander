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

export const TOUR_THEMES = ['history', 'architecture', 'art', 'surprise me'] as const
export type TourTheme = (typeof TOUR_THEMES)[number]

export const TOUR_MINUTES = [30, 60, 90] as const

export interface TourData {
  ownerId: string
  title: string
  lat: number
  lng: number
  theme: TourTheme
  minutes: number
  status: TourStatus
  errorMessage?: string
  isPublic: 'public' | 'private'
}

/** The only fields a client may send. Everything else is server-owned. */
export type TourCreateData = Pick<TourData, 'title' | 'lat' | 'lng' | 'theme' | 'minutes'> &
  Partial<Pick<TourData, 'isPublic'>>

const CLIENT_WRITABLE_FIELDS = ['title', 'lat', 'lng', 'theme', 'minutes', 'isPublic']

export const toursSchema: CollectionSchema = {
  name: 'tours',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true, required: true },
    { name: 'title', storage: 'text', interpretation: 'plain' },
    { name: 'lat', storage: 'number', interpretation: 'plain', immutable: true, required: true },
    { name: 'lng', storage: 'number', interpretation: 'plain', immutable: true, required: true },
    { name: 'theme', storage: 'text', interpretation: { kind: 'select', options: [...TOUR_THEMES] }, immutable: true, required: true },
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
