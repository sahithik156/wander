/* home pattern: product-preview-first — the map and the tour planner beside it, styled as a printed city guide */
/**
 * Home — map and tour builder.
 *
 * Layout (presentation): desktop has a full-height left sidebar with "Plan"
 * and "Tour" tabs beside the map; on a phone the sidebar is a bottom sheet
 * over the map (src/components/tour/BottomSheet.tsx).
 *
 * Drop a pin, pick a length and theme, "Build tour". That creates a `tours`
 * row and enqueues the build-tour job (src/jobs.ts), which writes `stops`
 * rows from the worker. Both collections are live queries here, so the status
 * chip, the map markers and route line, and the stop list update as the job
 * writes (stops first, narration later), with no polling.
 */

import { useEffect, useMemo, useState } from 'react'
import { AuthOverlay, useAuthProfileReady, useJobs, useMutations, useQuery } from 'deepspace'
import {
  Badge,
  Button,
  Checkbox,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  useToast,
} from '@/components/ui'
import { BottomSheet } from '@/components/tour/BottomSheet'
import { LocalDishes } from '@/components/tour/LocalDishes'
import { StopTimeline } from '@/components/tour/StopTimeline'
import { ThemeChips } from '@/components/tour/ThemeChips'
import { TourMap, type MapPin, type MapStop, type RouteState } from '@/components/map/TourMap'
import { SCOPE_ID } from '../../constants'
import {
  THEME_LABEL,
  TOUR_MINUTES,
  TOUR_THEMES,
  normalizeTheme,
  type TourCreateData,
  type TourData,
  type TourStatus,
  type TourTheme,
} from '../../schemas/tours-schema'
import type { StopData } from '../../schemas/stops-schema'
import { distanceMeters, pathLengthMeters, walkingDistance } from '@/lib/geo'
import { FOOD_MINUTES_PER_STOP, budgetMeters } from '@/lib/route-budget'

const STATUS_LABEL: Record<TourStatus, string> = {
  queued: 'Queued',
  finding: 'Finding places…',
  choosing: 'Choosing stops…',
  writing: 'Writing…',
  done: 'Done',
  failed: 'Failed',
  too_few_places: 'Too few places',
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

interface PanelStop extends MapStop {
  narration?: string
  transition?: string
  sourceUrl: string
  /** Rows from before slice 3 have no source; they are Wikipedia stops. */
  source: 'wikipedia' | 'maps'
  category?: string
  /** 'food' for a place to eat; shown with rating instead of "Limited info". */
  role: 'sight' | 'food'
  rating?: number
  reviews?: number
  price?: string
}

export default function HomePage() {
  const { isSignedIn, userId } = useAuthProfileReady({ requireUser: true })
  const { error: toastError } = useToast()

  const [pin, setPin] = useState<MapPin | null>(null)
  const [minutes, setMinutes] = useState<number>(60)
  const [theme, setTheme] = useState<TourTheme>('history')
  // "Include a food stop" (off by default; the Food theme doesn't offer it).
  const [includeFood, setIncludeFood] = useState(false)
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
          role: r.data.role ?? 'sight',
          rating: r.data.rating,
          reviews: r.data.reviews,
          price: r.data.price,
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
  // can still be longer than its length allows. It is kept, with a note that
  // it suits a car or auto better (SPEC.md "Spread-out tours").
  const isFoodTour = activeTour !== undefined && normalizeTheme(activeTour.data.theme) === 'food'
  const spreadOut =
    activeTour !== undefined &&
    stops.length > 0 &&
    routeKm * 1000 >
      budgetMeters(activeTour.data.minutes, stops.length, isFoodTour ? FOOD_MINUTES_PER_STOP : undefined)
  const dishes = activeTour?.data.dishes ?? []

  const pickPin = (next: MapPin) => {
    setPin(next)
    setActiveTourId(null)
  }

  const buildTour = async () => {
    if (!shownPin || !isSignedIn || !ready || building) return
    setSubmitting(true)
    try {
      const tourId = await createConfirmed({
        title: `${THEME_LABEL[theme]} tour · ${minutes} min`,
        lat: shownPin.lat,
        lng: shownPin.lng,
        theme,
        minutes,
        includeFood: theme !== 'food' && includeFood,
      })
      setActiveTourId(tourId)
      await enqueue('build-tour', { tourId }, { maxAttempts: 1 })
    } catch (err) {
      toastError('Could not start the tour', err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  // --- Presentation-only state: which tab is open, and the phone sheet height.
  const [tab, setTab] = useState<'plan' | 'tour'>('plan')
  const [sheetExpanded, setSheetExpanded] = useState(false)

  // Dropping a pin goes back to planning; starting a build shows the tour.
  const handlePick = (next: MapPin) => {
    pickPin(next)
    setTab('plan')
  }
  const handleBuild = () => {
    setTab('tour')
    void buildTour()
  }

  const tourPin = activeTour ? { lat: activeTour.data.lat, lng: activeTour.data.lng } : null
  // Dateline above the title. Stops carry no city or address, so the place is
  // the pin's coordinates.
  const dateline = activeTour
    ? [
        `${activeTour.data.lat.toFixed(4)}, ${activeTour.data.lng.toFixed(4)}`,
        `${activeTour.data.minutes} min`,
        THEME_LABEL[normalizeTheme(activeTour.data.theme)],
      ].join(' · ')
    : ''
  const routeState: RouteState = building ? 'building' : status === 'done' ? 'done' : 'idle'

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      <BottomSheet
        label="Tour panel"
        expanded={sheetExpanded}
        onExpandedChange={setSheetExpanded}
        data-testid="tour-builder"
      >
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as 'plan' | 'tour')}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="shrink-0 border-b border-rule px-6 pb-2 pt-1 md:pt-4">
            <TabsList>
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="tour">Tour</TabsTrigger>
            </TabsList>
          </div>

          {/* ---- Plan ---------------------------------------------------- */}
          <TabsContent value="plan" className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
              <h1 className="font-display text-[34px] leading-[1.05] text-foreground md:text-[40px]">Plan a tour</h1>

              {!isSignedIn ? (
                <>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                    Sign in to drop a pin and build a tour.
                  </p>
                  <Button className="mt-5 w-full" onClick={() => setShowAuth(true)} data-testid="home-sign-in">
                    Sign in
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-3 text-[15px] text-muted-foreground tabular-nums">
                    {shownPin
                      ? `Pin at ${shownPin.lat.toFixed(4)}, ${shownPin.lng.toFixed(4)}`
                      : 'Click the map to drop a pin'}
                  </p>

                  <fieldset className="mt-8">
                    <legend className="mb-2 text-[15px] text-foreground">Length</legend>
                    {/* Segmented control: square edges, 1px ink, selected filled ink. */}
                    <div
                      className="grid grid-cols-3 overflow-hidden rounded-sm border border-ink"
                      role="radiogroup"
                      aria-label="Tour length"
                    >
                      {TOUR_MINUTES.map((m, i) => (
                        <button
                          key={m}
                          type="button"
                          role="radio"
                          aria-checked={minutes === m}
                          disabled={building}
                          onClick={() => setMinutes(m)}
                          data-testid={`length-${m}`}
                          className={cn(
                            'h-11 cursor-pointer text-[15px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                            i > 0 && 'border-l border-ink',
                            minutes === m ? 'bg-ink text-background' : 'bg-transparent text-foreground hover:bg-accent',
                          )}
                        >
                          {m} min
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="mt-7">
                    <legend className="mb-2 text-[15px] text-foreground">Theme</legend>
                    <ThemeChips
                      themes={TOUR_THEMES}
                      labels={THEME_LABEL}
                      value={theme}
                      onChange={setTheme}
                      disabled={building}
                    />
                  </fieldset>

                  {theme !== 'food' && (
                    <div className="mt-7 flex items-center gap-3">
                      <Checkbox
                        id="include-food"
                        checked={includeFood}
                        onCheckedChange={setIncludeFood}
                        disabled={building}
                        data-testid="include-food"
                      />
                      <Label htmlFor="include-food" className="cursor-pointer text-base font-normal">
                        Include a food stop
                      </Label>
                    </div>
                  )}
                </>
              )}
            </div>

            {isSignedIn && (
              // Kept outside the scroll area so it shows in the phone sheet's peek.
              <div className="shrink-0 border-t border-rule px-6 py-4">
                <Button
                  className="h-12 w-full"
                  onClick={handleBuild}
                  disabled={!shownPin || !ready || building}
                  loading={building}
                  data-testid="build-tour"
                >
                  Build tour
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ---- Tour ---------------------------------------------------- */}
          <TabsContent value="tour" className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-6">
            {!status ? (
              <div>
                <p className="font-display text-[34px] leading-tight text-foreground">No tour yet</p>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                  Drop a pin on the map and build one from the Plan tab.
                </p>
                <Button variant="outline" className="mt-5" onClick={() => setTab('plan')}>
                  Go to Plan
                </Button>
              </div>
            ) : (
              <div data-testid="tour-status-panel">
                <div className="flex items-start justify-between gap-4">
                  <p className="min-w-0 text-[15px] text-muted-foreground tabular-nums">{dateline}</p>
                  <Badge
                    variant={status === 'failed' ? 'destructive' : 'outline'}
                    className="shrink-0"
                    data-testid="tour-status"
                    data-status={status}
                  >
                    {STATUS_LABEL[status]}
                  </Badge>
                </div>
                <h2 className="mt-2 font-display text-[34px] leading-[1.05] text-foreground [overflow-wrap:anywhere] md:text-[42px]">
                  {activeTour?.data.title}
                </h2>

                <div className="mt-4 border-t border-ink pt-3">
                  {stops.length > 0 && (
                    <p className="text-base text-foreground tabular-nums" data-testid="stop-count">
                      {stops.length} {stops.length === 1 ? 'stop' : 'stops'} ·{' '}
                      <span data-testid="route-length">≈ {routeKm.toFixed(1)} km route</span>
                    </p>
                  )}
                  {/* Summary notes: plain text, not badges. */}
                  <div className="mt-1 space-y-1 text-[15px] leading-snug text-muted-foreground tabular-nums empty:hidden">
                    {status === 'failed' && activeTour?.data.errorMessage && (
                      <p className="text-destructive">{activeTour.data.errorMessage}</p>
                    )}
                    {stalled && (
                      <p className="text-destructive" data-testid="tour-stalled">
                        This tour stopped before finishing. Build it again or move the pin.
                      </p>
                    )}
                    {status === 'too_few_places' && <p>Not enough places near this pin. Move the pin and try again.</p>}
                    {startMeters > START_NOTE_METERS && (
                      <p data-testid="start-distance">
                        Starts {walkingDistance(startMeters)} from your pin at {stops[0].name}
                      </p>
                    )}
                    {activeTour?.data.foodStopMissing && (
                      <p data-testid="food-stop-missing">No well-rated place to eat found near the end of this tour.</p>
                    )}
                    {spreadOut && (
                      <p data-testid="spread-out">Spread out: {routeKm.toFixed(1)} km, best by car or auto</p>
                    )}
                  </div>
                </div>

                {stops.length > 0 && tourPin && (
                  <div className="mt-8">
                    <StopTimeline stops={stops} pin={tourPin} writing={status === 'writing'} />
                  </div>
                )}

                {dishes.length > 0 && activeTour?.data.cuisineUrl && (
                  <LocalDishes
                    dishes={dishes}
                    cuisineTitle={activeTour.data.cuisineTitle}
                    cuisineUrl={activeTour.data.cuisineUrl}
                  />
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </BottomSheet>

      <div className="relative min-w-0 flex-1">
        <TourMap
          pin={shownPin}
          stops={stops}
          locked={!isSignedIn || building}
          routeState={routeState}
          onPick={handlePick}
        />
      </div>

      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </div>
  )
}
