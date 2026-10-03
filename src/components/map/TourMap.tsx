/**
 * Full-size MapLibre map with OpenFreeMap tiles (no API key). Controlled by
 * props: the pin and the stops come from the parent (stops stream in from the
 * `stops` collection), clicks and pin drags are reported back.
 *
 * The map is created once; props reach the imperative handlers through refs
 * so listeners are never re-bound (same approach as RunningMap's RouteMap).
 *
 * The route is a one-way straight line pin -> stops in order, ending at the
 * last stop (no street routing; SPEC.md out of scope), drawn as a GeoJSON
 * line layer.
 */

import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const DEFAULT_CENTER: [number, number] = [-0.1276, 51.5072]
const DEFAULT_ZOOM = 12
const ROUTE_SOURCE = 'route'
const ROUTE_COLOR = '#e11d48'

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
}

interface TourMapProps {
  pin: MapPin | null
  stops: MapStop[]
  /** When true, clicks and pin drags are ignored (e.g. while a tour builds). */
  locked?: boolean
  onPick: (pin: MapPin) => void
}

interface RouteFeature {
  type: 'Feature'
  properties: Record<string, never>
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

function routeData(pin: MapPin | null, stops: MapStop[]): RouteFeature {
  const points = stops.map((s): [number, number] => [s.lng, s.lat])
  if (pin && points.length > 0) points.unshift([pin.lng, pin.lat])
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.length > 1 ? points : [] } }
}

function stopElement(stop: MapStop): HTMLElement {
  const el = document.createElement('div')
  el.className =
    'flex size-7 items-center justify-center rounded-full border-2 border-white bg-primary text-xs font-semibold text-primary-foreground shadow-md'
  el.textContent = String(stop.order + 1)
  el.title = stop.name
  el.setAttribute('data-testid', 'stop-marker')
  return el
}

export function TourMap({ pin, stops, locked = false, onPick }: TourMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const pinMarkerRef = useRef<maplibregl.Marker | null>(null)
  const stopMarkersRef = useRef(new Map<string, maplibregl.Marker>())
  const cbRef = useRef({ onPick, locked })
  cbRef.current = { onPick, locked }
  const routeRef = useRef(routeData(pin, stops))
  routeRef.current = routeData(pin, stops)

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('click', (e) => {
      if (cbRef.current.locked) return
      cbRef.current.onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })
    // The route layer can only be added once the style has loaded; until then
    // the latest route waits in routeRef.
    map.on('load', () => {
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routeRef.current })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE_COLOR, 'line-width': 3, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] },
      })
    })
    mapRef.current = map

    const resizeObs = new ResizeObserver(() => map.resize())
    resizeObs.observe(containerRef.current)
    const stopMarkers = stopMarkersRef.current

    return () => {
      resizeObs.disconnect()
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
      const marker = new maplibregl.Marker({ color: '#e11d48', draggable: true })
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

  // Keep the route line in sync with the pin and the ordered stops.
  useEffect(() => {
    const source = mapRef.current?.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined
    source?.setData(routeData(pin, stops))
  }, [pin, stops])

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
      // The tour panel overlays the left of the map on wide screens; keep
      // stops out from under it.
      const width = map.getContainer().clientWidth
      const left = width >= 768 ? 440 : 60
      map.fitBounds(bounds, { padding: { top: 80, bottom: 80, right: 80, left }, maxZoom: 17, duration: 600 })
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
