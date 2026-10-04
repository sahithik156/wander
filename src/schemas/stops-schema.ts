/**
 * Stops — written only by the build-tour job (owner context). No role can
 * create, update, or delete a stop from the client.
 *
 * `ownerId` is a plain column, NOT userBound: userBound stamps the writer's
 * id, which for the job is the app owner. The job copies it from the tour.
 * With no client create there is nothing to spoof.
 *
 * Permissions can't reference the parent tour, so `isPublic` is denormalized
 * onto each stop. The sharing slice must update it when a tour's isPublic
 * changes; nothing sets it yet.
 *
 * A stop comes from Wikipedia (source 'wikipedia', has pageid) or, where
 * Wikipedia is thin, Google Maps (source 'maps', has externalId = place_id and
 * category). `sourceUrl` is the article or the Google Maps page. Rows written
 * before these columns existed have no `source`; read that as 'wikipedia'.
 */

import type { CollectionSchema } from 'deepspace/schema'

export interface StopData {
  ownerId: string
  tourId: string
  order: number
  /** Wikipedia stops only. */
  pageid?: number
  source?: 'wikipedia' | 'maps'
  /** Maps stops only: Google place_id. */
  externalId?: string
  /** Maps stops only: Google's place type, e.g. "Hindu temple". */
  category?: string
  name: string
  lat: number
  lng: number
  narration?: string
  transition?: string
  sourceUrl: string
  audioStatus: 'none' | 'generating' | 'ready' | 'failed'
  audioUrl?: string
  isPublic: 'public' | 'private'
}

export const stopsSchema: CollectionSchema = {
  name: 'stops',
  columns: [
    { name: 'ownerId', storage: 'text', interpretation: 'plain', immutable: true, required: true },
    { name: 'tourId', storage: 'text', interpretation: 'plain', immutable: true, required: true },
    { name: 'order', storage: 'number', interpretation: 'plain' },
    { name: 'pageid', storage: 'number', interpretation: 'plain' },
    { name: 'source', storage: 'text', interpretation: { kind: 'select', options: ['wikipedia', 'maps'] }, default: 'wikipedia' },
    { name: 'externalId', storage: 'text', interpretation: 'plain' },
    { name: 'category', storage: 'text', interpretation: 'plain' },
    { name: 'name', storage: 'text', interpretation: 'plain' },
    { name: 'lat', storage: 'number', interpretation: 'plain' },
    { name: 'lng', storage: 'number', interpretation: 'plain' },
    { name: 'narration', storage: 'text', interpretation: 'plain' },
    { name: 'transition', storage: 'text', interpretation: 'plain' },
    { name: 'sourceUrl', storage: 'text', interpretation: { kind: 'url' } },
    { name: 'audioStatus', storage: 'text', interpretation: { kind: 'select', options: ['none', 'generating', 'ready', 'failed'] }, default: 'none' },
    { name: 'audioUrl', storage: 'text', interpretation: { kind: 'url' } },
    { name: 'isPublic', storage: 'text', interpretation: { kind: 'select', options: ['private', 'public'] }, default: 'private' },
  ],
  ownerField: 'ownerId',
  visibilityField: 'isPublic',
  permissions: {
    '*': { read: 'published', create: false, update: false, delete: false },
    viewer: { read: 'published', create: false, update: false, delete: false },
    member: { read: 'published', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
