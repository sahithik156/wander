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
 */

import type { CollectionSchema } from 'deepspace/schema'

export interface StopData {
  ownerId: string
  tourId: string
  order: number
  pageid: number
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
