/**
 * Home — full-screen map and tour builder.
 *
 * Drop a pin, pick a length and theme, "Build tour". That creates a `tours`
 * row and enqueues the build-tour job (src/jobs.ts), which writes `stops`
 * rows from the worker. Both collections are live queries here, so the status
 * chip and the map markers update as the job writes, with no polling.
 */

import { useMemo, useState } from 'react'
import { AuthOverlay, useAuthProfileReady, useJobs, useMutations, useQuery } from 'deepspace'
import { MapPin as PinIcon } from 'lucide-react'
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

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

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
  const stops: MapStop[] = useMemo(
    () =>
      stopRecords
        .map((r) => ({ id: r.recordId, name: r.data.name, lat: r.data.lat, lng: r.data.lng, order: r.data.order }))
        .sort((a, b) => a.order - b.order),
    [stopRecords],
  )

  const status = activeTour?.data.status
  const building = submitting || (status !== undefined && BUILDING.includes(status))
  // Show the tour's own pin while it is the active one.
  const shownPin: MapPin | null = pin ?? (activeTour ? { lat: activeTour.data.lat, lng: activeTour.data.lng } : null)

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
        className="absolute left-4 top-4 z-10 w-[min(20rem,calc(100%-2rem))] rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
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
                {status === 'too_few_places' && (
                  <p className="text-xs text-muted-foreground">
                    Not enough places near this pin. Move the pin and try again.
                  </p>
                )}
                {stops.length > 0 && (
                  <p className="text-xs text-muted-foreground" data-testid="stop-count">
                    {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
                  </p>
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
