/**
 * Home — full-screen map and tour builder.
 *
 * Drop a pin, pick a length and theme, "Build tour". That creates a `tours`
 * row and enqueues the build-tour job (src/jobs.ts), which writes `stops`
 * rows from the worker. Both collections are live queries here, so the status
 * chip, the map markers and route line, and the stop list update as the job
 * writes (stops first, narration later), with no polling.
 */

import { useEffect, useMemo, useState } from 'react'
import { AuthOverlay, useAuthProfileReady, useJobs, useMutations, useQuery } from 'deepspace'
import { ExternalLink, MapPin as PinIcon } from 'lucide-react'
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
  useToast,
} from '@/components/ui'
import { TourMap, type MapPin, type MapStop } from '@/components/map/TourMap'
import { SCOPE_ID } from '../../constants'
import {
  TOUR_MINUTES,
  TOUR_THEMES,
  type TourCreateData,
  type TourData,
  type TourStatus,
  type TourTheme,
} from '../../schemas/tours-schema'
import type { StopData } from '../../schemas/stops-schema'
import { distanceMeters, pathLengthMeters, walkingDistance } from '@/lib/geo'
import { budgetMeters } from '@/lib/route-budget'

const STATUS_LABEL: Record<TourStatus, string> = {
  queued: 'Queued',
  finding: 'Finding places…',
  choosing: 'Choosing stops…',
  writing: 'Writing…',
  done: 'Done',
  failed: 'Failed',
  too_few_places: 'Too few places',
}

const STATUS_VARIANT: Record<TourStatus, 'secondary' | 'info' | 'success' | 'destructive' | 'warning'> = {
  queued: 'secondary',
  finding: 'info',
  choosing: 'info',
  writing: 'info',
  done: 'success',
  failed: 'destructive',
  too_few_places: 'warning',
}

const BUILDING: TourStatus[] = ['queued', 'finding', 'choosing', 'writing']
/**
 * The job updates the tour at every phase, so a tour still "building" with no
 * update for this long lost its job (e.g. the worker killed it). Treat it as
 * stopped, or the builder would stay locked forever.
 */
const STALE_BUILD_MS = 5 * 60 * 1000
/** Mention the walk to the first stop only when it's more than this. */
const START_NOTE_METERS = 300

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

interface PanelStop extends MapStop {
  narration?: string
  transition?: string
  sourceUrl: string
  /** Rows from before slice 3 have no source; they are Wikipedia stops. */
  source: 'wikipedia' | 'maps'
  category?: string
}

export default function HomePage() {
  const { isSignedIn, userId } = useAuthProfileReady({ requireUser: true })
  const { error: toastError } = useToast()

  const [pin, setPin] = useState<MapPin | null>(null)
  const [minutes, setMinutes] = useState<number>(60)
  const [theme, setTheme] = useState<TourTheme>('history')
  const [submitting, setSubmitting] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  // undefined = show my latest tour; null = a new pin was dropped, show none.
  const [activeTourId, setActiveTourId] = useState<string | null | undefined>(undefined)

  const { createConfirmed, ready } = useMutations<TourCreateData>('tours')
  const { enqueue } = useJobs(SCOPE_ID)

  const { records: tours } = useQuery<TourData>('tours', { orderBy: 'createdAt', orderDir: 'desc' })
  const activeTour = useMemo(() => {
    if (activeTourId === null) return undefined
    if (activeTourId) return tours.find((t) => t.recordId === activeTourId)
    return tours.find((t) => t.data.ownerId === userId)
  }, [tours, activeTourId, userId])

  const { records: stopRecords } = useQuery<StopData>('stops', {
    where: { tourId: activeTour?.recordId ?? '' },
  })
  const stops: PanelStop[] = useMemo(
    () =>
      stopRecords
        .map((r) => ({
          id: r.recordId,
          name: r.data.name,
          lat: r.data.lat,
          lng: r.data.lng,
          order: r.data.order,
          narration: r.data.narration,
          transition: r.data.transition,
          sourceUrl: r.data.sourceUrl,
          source: r.data.source ?? 'wikipedia',
          category: r.data.category,
        }))
        .sort((a, b) => a.order - b.order),
    [stopRecords],
  )

  // Re-check staleness every 30 s without polling the server.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const status = activeTour?.data.status
  const stalled =
    status !== undefined &&
    BUILDING.includes(status) &&
    activeTour !== undefined &&
    now - new Date(activeTour.updatedAt).getTime() > STALE_BUILD_MS
  const building = submitting || (status !== undefined && BUILDING.includes(status) && !stalled)
  // Show the tour's own pin while it is the active one.
  const shownPin: MapPin | null = pin ?? (activeTour ? { lat: activeTour.data.lat, lng: activeTour.data.lng } : null)
  // The tour runs from the first stop to the last; getting to the first stop
  // from the pin is shown separately and not counted against the time budget.
  const routeKm = pathLengthMeters(stops) / 1000
  const startMeters = activeTour && stops.length > 0 ? distanceMeters(activeTour.data, stops[0]) : 0
  // The job trims stops to fit the time budget but never below 3, so a tour
  // can still be longer than its length allows; say so instead of hiding it.
  const longWalk =
    activeTour !== undefined && stops.length > 0 && routeKm * 1000 > budgetMeters(activeTour.data.minutes, stops.length)

  const pickPin = (next: MapPin) => {
    setPin(next)
    setActiveTourId(null)
  }

  const buildTour = async () => {
    if (!shownPin || !isSignedIn || !ready || building) return
    setSubmitting(true)
    try {
      const tourId = await createConfirmed({
        title: `${titleCase(theme)} walk · ${minutes} min`,
        lat: shownPin.lat,
        lng: shownPin.lng,
        theme,
        minutes,
      })
      setActiveTourId(tourId)
      await enqueue('build-tour', { tourId }, { maxAttempts: 1 })
    } catch (err) {
      toastError('Could not start the tour', err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <TourMap pin={shownPin} stops={stops} locked={!isSignedIn || building} onPick={pickPin} />

      <div
        className="absolute left-4 top-4 z-10 max-h-[calc(100%-2rem)] w-[min(24rem,calc(100%-2rem))] overflow-y-auto rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
        data-testid="tour-builder"
      >
        <h1 className="text-base font-semibold">Plan a walking tour</h1>

        {!isSignedIn ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">Sign in to drop a pin and build a tour.</p>
            <Button className="mt-3 w-full" onClick={() => setShowAuth(true)} data-testid="home-sign-in">
              Sign in
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <PinIcon className="size-4 shrink-0" />
              {shownPin
                ? `${shownPin.lat.toFixed(4)}, ${shownPin.lng.toFixed(4)}`
                : 'Click the map to drop a pin'}
            </p>

            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Length</div>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tour length">
                {TOUR_MINUTES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={minutes === m}
                    disabled={building}
                    onClick={() => setMinutes(m)}
                    data-testid={`length-${m}`}
                    className={cn(
                      'h-9 rounded-md border text-sm transition-colors disabled:opacity-50',
                      minutes === m
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background hover:bg-accent',
                    )}
                  >
                    {m} min
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Theme</div>
              <Select value={theme} onValueChange={(v) => setTheme(v as TourTheme)} disabled={building}>
                <SelectTrigger data-testid="theme-select" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOUR_THEMES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {titleCase(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="mt-4 w-full"
              onClick={buildTour}
              disabled={!shownPin || !ready || building}
              loading={building}
              data-testid="build-tour"
            >
              Build tour
            </Button>

            {status && (
              <div className="mt-4 space-y-1.5" data-testid="tour-status-panel">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{activeTour?.data.title}</span>
                  <Badge variant={STATUS_VARIANT[status]} data-testid="tour-status" data-status={status}>
                    {STATUS_LABEL[status]}
                  </Badge>
                </div>
                {status === 'failed' && activeTour?.data.errorMessage && (
                  <p className="text-xs text-destructive">{activeTour.data.errorMessage}</p>
                )}
                {stalled && (
                  <p className="text-xs text-destructive" data-testid="tour-stalled">
                    This tour stopped before finishing. Build it again or move the pin.
                  </p>
                )}
                {status === 'too_few_places' && (
                  <p className="text-xs text-muted-foreground">
                    Not enough places near this pin. Move the pin and try again.
                  </p>
                )}
                {stops.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="stop-count">
                    {stops.length} {stops.length === 1 ? 'stop' : 'stops'} ·{' '}
                    <span data-testid="route-length">≈ {routeKm.toFixed(1)} km walk</span> (straight-line, one way)
                  </p>
                )}
                {startMeters > START_NOTE_METERS && (
                  <p className="text-xs text-muted-foreground" data-testid="start-distance">
                    Starts {walkingDistance(startMeters)} from your pin at {stops[0].name}
                  </p>
                )}
                {longWalk && (
                  <p className="text-xs text-warning" data-testid="long-walk">
                    Longer walk: stops are spread out, so this may take more than {activeTour?.data.minutes} minutes.
                  </p>
                )}
                {stops.length > 0 && (
                  <ol className="mt-3 space-y-4 border-t border-border pt-3" data-testid="stop-list">
                    {stops.map((stop) => (
                      <li key={stop.id} className="text-sm" data-testid="stop-item">
                        <div className="flex items-start gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                            {stop.order + 1}
                          </span>
                          <div className="min-w-0 pt-0.5">
                            <span className="font-medium">{stop.name}</span>
                            {stop.source === 'maps' && (
                              <Badge variant="secondary" className="ml-2 align-middle" data-testid="stop-limited-info">
                                Limited info
                              </Badge>
                            )}
                            {stop.category && <div className="text-xs text-muted-foreground">{stop.category}</div>}
                          </div>
                        </div>
                        <div className="mt-1.5 space-y-1.5 pl-8">
                          {stop.narration ? (
                            <p className="leading-relaxed" data-testid="stop-narration">
                              {stop.narration}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              {status === 'writing' ? 'Writing…' : 'No narration.'}
                            </p>
                          )}
                          {stop.transition && (
                            <p className="text-xs italic text-muted-foreground" data-testid="stop-transition">
                              {stop.transition}
                            </p>
                          )}
                          <a
                            href={stop.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            {stop.source === 'maps' ? 'View on Google Maps' : 'Source'}{' '}
                            <ExternalLink className="size-3" />
                          </a>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </div>
  )
}
