/**
 * Full-size MapLibre map with OpenFreeMap tiles (no API key). Controlled by
 * props: the pin and the stops come from the parent (stops stream in from the
 * `stops` collection), clicks and pin drags are reported back.
 *
 * The map is created once; props reach the imperative handlers through refs
 * so listeners are never re-bound (same approach as RunningMap's RouteMap).
 *
 * Look: a metro map (SPEC.md "Visual design"). The route is a one-way
 * straight line pin -> stops in order (no street routing; SPEC.md out of
 * scope), drawn as a solid cobalt line; the leg into a food stop is the
 * tomato "food line". Stops are station circles; the pin is a crosshair.
 * When a tour finishes, the route draws in once along its length (skipped
 * with prefers-reduced-motion).
 *
 * Basemap: OpenFreeMap "positron" (muted) in the light theme, "dark" in the
 * dark theme (data-theme="wander-night", chosen in Settings).
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { distanceMeters } from '@/lib/geo'

const STYLE_DAY = 'https://tiles.openfreemap.org/styles/positron'
const STYLE_NIGHT = 'https://tiles.openfreemap.org/styles/dark'
const DEFAULT_CENTER: [number, number] = [-0.1276, 51.5072]
const DEFAULT_ZOOM = 12
const ROUTE_SOURCE = 'route'
const DRAW_IN_MS = 1400

const isNight = () => document.documentElement.getAttribute('data-theme') === 'wander-night'
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A theme color token (e.g. --color-line), read at runtime so the map follows the theme. */
function themeColor(token: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback
}

export interface MapPin {
  lat: number
  lng: number
}

export interface MapStop {
  id: string
  name: string
  lat: number
  lng: number
  order: number
  /** 'food' stops are tomato stations on the food line. */
  role?: 'sight' | 'food'
}

/** Where the tour is, for the draw-in: it plays when 'building' turns into 'done'. */
export type RouteState = 'idle' | 'building' | 'done'

interface TourMapProps {
  pin: MapPin | null
  stops: MapStop[]
  /** When true, clicks and pin drags are ignored (e.g. while a tour builds). */
  locked?: boolean
  routeState?: RouteState
  onPick: (pin: MapPin) => void
}

type LngLat = [number, number]

interface SegmentFeature {
  type: 'Feature'
  properties: { kind: 'line' | 'food' }
  geometry: { type: 'LineString'; coordinates: LngLat[] }
}

interface RouteData {
  type: 'FeatureCollection'
  features: SegmentFeature[]
}

interface Leg {
  from: LngLat
  to: LngLat
  kind: 'line' | 'food'
  meters: number
}

/** pin -> stop 1 -> stop 2 ...; a leg ending at a food stop is on the food line. */
function routeLegs(pin: MapPin | null, stops: MapStop[]): Leg[] {
  if (!pin || stops.length === 0) return []
  const points: { at: LngLat; role?: MapStop['role'] }[] = [
    { at: [pin.lng, pin.lat] },
    ...stops.map((s) => ({ at: [s.lng, s.lat] as LngLat, role: s.role })),
  ]
  const legs: Leg[] = []
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1].at, points[i].at]
    legs.push({
      from: a,
      to: b,
      kind: points[i].role === 'food' ? 'food' : 'line',
      meters: distanceMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] }),
    })
  }
  return legs
}

/** The route as line segments, cut at `progress` (0..1) of its total length for the draw-in. */
function routeData(legs: Leg[], progress = 1): RouteData {
  const total = legs.reduce((sum, l) => sum + l.meters, 0)
  let left = total * progress
  const features: SegmentFeature[] = []
  for (const leg of legs) {
    if (left <= 0) break
    const t = leg.meters === 0 ? 1 : Math.min(1, left / leg.meters)
    const end: LngLat = [leg.from[0] + (leg.to[0] - leg.from[0]) * t, leg.from[1] + (leg.to[1] - leg.from[1]) * t]
    features.push({ type: 'Feature', properties: { kind: leg.kind }, geometry: { type: 'LineString', coordinates: [leg.from, end] } })
    left -= leg.meters
  }
  return { type: 'FeatureCollection', features }
}

/** A station: paper circle with a thick ink edge and the number; food stations are tomato. */
function stopElement(stop: MapStop): HTMLElement {
  const el = document.createElement('div')
  el.className = [
    'flex size-8 items-center justify-center rounded-full border-[3px] border-ink text-[13px] font-medium tabular-nums text-ink',
    stop.role === 'food' ? 'bg-food' : 'bg-card',
  ].join(' ')
  el.textContent = String(stop.order + 1)
  el.title = stop.name
  el.setAttribute('data-testid', 'stop-marker')
  return el
}

/** The pin: a thin crosshair, not a teardrop. */
function pinElement(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'relative size-9 cursor-grab text-ink'
  el.setAttribute('aria-label', 'Tour start pin')
  el.innerHTML =
    '<svg viewBox="0 0 36 36" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
    '<circle cx="18" cy="18" r="8"/><circle cx="18" cy="18" r="1.75" fill="currentColor" stroke="none"/>' +
    '<line x1="18" y1="1" x2="18" y2="10"/><line x1="18" y1="26" x2="18" y2="35"/>' +
    '<line x1="1" y1="18" x2="10" y2="18"/><line x1="26" y1="18" x2="35" y2="18"/></svg>'
  return el
}

export function TourMap({ pin, stops, locked = false, routeState = 'idle', onPick }: TourMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const pinMarkerRef = useRef<maplibregl.Marker | null>(null)
  const stopMarkersRef = useRef(new Map<string, maplibregl.Marker>())
  const cbRef = useRef({ onPick, locked })
  cbRef.current = { onPick, locked }
  const legsRef = useRef(routeLegs(pin, stops))
  legsRef.current = routeLegs(pin, stops)
  const prevRouteState = useRef<RouteState>(routeState)
  const drawFrame = useRef<number | null>(null)

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: isNight() ? STYLE_NIGHT : STYLE_DAY,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('click', (e) => {
      if (cbRef.current.locked) return
      cbRef.current.onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })
    // The route layers can only be added once a style has loaded; until then
    // the latest route waits in legsRef. 'style.load' also fires after a
    // light/dark style switch, which drops custom layers, so re-add them there.
    map.on('style.load', () => {
      if (map.getSource(ROUTE_SOURCE)) return
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routeData(legsRef.current) })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'food',
            themeColor('--color-food', '#e5402a'),
            themeColor('--color-line', '#1f4fff'),
          ],
          'line-width': 5,
        },
      })
    })
    mapRef.current = map

    // Follow a theme change (Settings sets data-theme on <html>).
    const observer = new MutationObserver(() => map.setStyle(isNight() ? STYLE_NIGHT : STYLE_DAY))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const resizeObs = new ResizeObserver(() => map.resize())
    resizeObs.observe(containerRef.current)
    const stopMarkers = stopMarkersRef.current

    return () => {
      observer.disconnect()
      resizeObs.disconnect()
      if (drawFrame.current !== null) cancelAnimationFrame(drawFrame.current)
      stopMarkers.clear()
      pinMarkerRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Keep the pin marker in sync.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!pin) {
      pinMarkerRef.current?.remove()
      pinMarkerRef.current = null
      return
    }
    if (!pinMarkerRef.current) {
      const marker = new maplibregl.Marker({ element: pinElement(), draggable: true })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map)
      marker.on('dragend', () => {
        const { lat, lng } = marker.getLngLat()
        cbRef.current.onPick({ lat, lng })
      })
      pinMarkerRef.current = marker
    } else {
      pinMarkerRef.current.setLngLat([pin.lng, pin.lat])
    }
    pinMarkerRef.current.setDraggable(!locked)
  }, [pin, locked])

  // Keep the route line in sync with the pin and the ordered stops; when a
  // build finishes, draw it in once along its length.
  useEffect(() => {
    const source = mapRef.current?.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined
    const legs = routeLegs(pin, stops)
    const finished = prevRouteState.current === 'building' && routeState === 'done'
    prevRouteState.current = routeState
    if (drawFrame.current !== null) cancelAnimationFrame(drawFrame.current)
    drawFrame.current = null
    if (!source) return
    if (!finished || reduceMotion() || legs.length === 0) {
      source.setData(routeData(legs))
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DRAW_IN_MS)
      const eased = 1 - (1 - t) ** 3
      source.setData(routeData(legs, eased))
      drawFrame.current = t < 1 ? requestAnimationFrame(step) : null
    }
    drawFrame.current = requestAnimationFrame(step)
  }, [pin, stops, routeState])

  // Add/remove stop markers as records arrive, and fit the view to them.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = stopMarkersRef.current
    const ids = new Set(stops.map((s) => s.id))
    for (const [id, marker] of markers) {
      if (!ids.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }
    let added = false
    for (const stop of stops) {
      if (markers.has(stop.id)) continue
      markers.set(
        stop.id,
        new maplibregl.Marker({ element: stopElement(stop) }).setLngLat([stop.lng, stop.lat]).addTo(map),
      )
      added = true
    }
    if (added) {
      const bounds = new maplibregl.LngLatBounds()
      if (pin) bounds.extend([pin.lng, pin.lat])
      for (const stop of stops) bounds.extend([stop.lng, stop.lat])
      // Desktop: the sidebar sits beside the map, so plain padding. Phone: the
      // bottom sheet covers the lower part of the map; keep stops above it.
      const { clientWidth: width, clientHeight: height } = map.getContainer()
      const phone = width < 768
      const padding = phone
        ? { top: 56, right: 40, left: 40, bottom: Math.round(height * 0.45) }
        : { top: 64, right: 64, left: 64, bottom: 64 }
      map.fitBounds(bounds, { padding, maxZoom: 17, duration: reduceMotion() ? 0 : 600 })
    }
    // `pin` only seeds the bounds; re-running on pin moves would refit the map.
  }, [stops])

  // MapLibre's own CSS sets `position: relative` on the map element and, being
  // unlayered, beats Tailwind's layered `absolute`. Position a wrapper instead.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" data-testid="tour-map" />
    </div>
  )
}
