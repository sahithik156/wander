/**
 * Stops as a metro line: station circles joined by a solid cobalt line (the
 * leg into a food stop is the tomato food line), then for each stop the name,
 * a plain meta line (source, rating, distance from the pin), the narration,
 * the source link, and the "Head ... (X min on foot)" transition beside the
 * line before the next station.
 *
 * Presentation only; every data-testid matches the previous stop list.
 */

import { distanceMeters, walkingDistance, type LatLng } from '@/lib/geo'
import { cn } from '@/lib/utils'

export interface TimelineStop extends LatLng {
  id: string
  name: string
  order: number
  narration?: string
  transition?: string
  sourceUrl: string
  source: 'wikipedia' | 'maps'
  category?: string
  role: 'sight' | 'food'
  rating?: number
  reviews?: number
  price?: string
}

interface StopTimelineProps {
  stops: TimelineStop[]
  /** The tour's pin, for "x from pin" in the meta line. */
  pin: LatLng
  /** While narration is being written, a placeholder keeps the layout steady. */
  writing: boolean
}

export function StopTimeline({ stops, pin, writing }: StopTimelineProps) {
  return (
    <ol className="relative" data-testid="stop-list">
      {stops.map((stop, i) => {
        const next = stops[i + 1]
        return (
          <li key={stop.id} className="relative grid grid-cols-[2rem_1fr] gap-x-4 pb-8 last:pb-0" data-testid="stop-item">
            {/* The line to the next station: cobalt, or tomato into a food stop. */}
            {next && (
              <span
                aria-hidden
                className={cn(
                  'absolute bottom-0 left-[calc(1rem-2px)] top-4 w-1',
                  next.role === 'food' ? 'bg-food' : 'bg-line',
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                'relative z-10 flex size-8 items-center justify-center rounded-full border-[3px] border-ink text-[13px] font-medium tabular-nums text-ink',
                stop.role === 'food' ? 'bg-food' : 'bg-background',
              )}
            >
              {stop.order + 1}
            </span>

            <div className="min-w-0 pt-0.5">
              <h3 className="font-display text-[22px] leading-tight text-foreground [overflow-wrap:anywhere]">
                <span className="sr-only">Stop {stop.order + 1}: </span>
                {stop.name}
              </h3>
              <StopMeta stop={stop} pin={pin} />

              <div className="mt-3 min-h-[1.5rem]">
                {stop.narration ? (
                  <p className="text-base leading-[1.65] text-foreground" data-testid="stop-narration">
                    {stop.narration}
                  </p>
                ) : writing ? (
                  // Placeholder lines, so the list doesn't jump when narration lands.
                  <div aria-label="Writing narration" className="space-y-2 pt-1" role="status">
                    <span className="block h-3 w-full animate-pulse rounded-sm bg-muted" />
                    <span className="block h-3 w-11/12 animate-pulse rounded-sm bg-muted" />
                    <span className="block h-3 w-3/5 animate-pulse rounded-sm bg-muted" />
                  </div>
                ) : (
                  <p className="text-[15px] text-muted-foreground">No narration.</p>
                )}
              </div>

              <a
                href={stop.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-[15px] text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
              >
                {stop.source === 'maps' ? 'View on Google Maps' : 'Source'}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>

              {stop.transition && (
                <p
                  className="mt-5 text-[15px] leading-snug text-muted-foreground tabular-nums [overflow-wrap:anywhere]"
                  data-testid="stop-transition"
                >
                  {stop.transition}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function StopMeta({ stop, pin }: { stop: TimelineStop; pin: LatLng }) {
  const fromPin = `${walkingDistance(distanceMeters(pin, stop))} from pin`
  const parts =
    stop.role === 'food'
      ? [
          stop.rating !== undefined
            ? `${stop.rating.toFixed(1)} ★${stop.reviews !== undefined ? ` (${stop.reviews.toLocaleString()} reviews)` : ''}`
            : undefined,
          stop.category,
          stop.price,
          fromPin,
        ]
      : [stop.source === 'maps' ? 'Google Maps' : 'Wikipedia', stop.category, fromPin]
  const text = parts.filter(Boolean).join(' · ')
  return (
    <p className="mt-1 text-[15px] leading-snug text-muted-foreground tabular-nums">
      {stop.role === 'food' ? <span data-testid="stop-food-info">{text}</span> : text}
      {stop.source === 'maps' && stop.role !== 'food' && (
        <span className="ml-2 text-[13px] text-muted-foreground" data-testid="stop-limited-info">
          Limited info
        </span>
      )}
    </p>
  )
}
