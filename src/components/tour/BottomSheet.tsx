/**
 * The tour panel's container. Desktop (md+): a full-height 400px sidebar to
 * the left of the map. Phone: a bottom sheet over the map with a drag handle
 * and two heights: peek (shows the Build button or the tour status) and
 * expanded (everything), leaving the map visible above.
 *
 * Presentation only. The handle works by drag, tap, or keyboard (Enter /
 * Space toggles, Arrow Up / Down expand / collapse).
 */

import { useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface BottomSheetProps {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  label: string
  children: ReactNode
  className?: string
  'data-testid'?: string
}

/** A drag shorter than this counts as a tap. */
const DRAG_THRESHOLD_PX = 24

export function BottomSheet({ expanded, onExpandedChange, label, children, className, ...rest }: BottomSheetProps) {
  const startY = useRef<number | null>(null)
  const dragged = useRef(false)

  return (
    <aside
      aria-label={label}
      data-sheet={expanded ? 'full' : 'peek'}
      data-testid={rest['data-testid']}
      className={cn(
        // Phone: sheet anchored to the bottom of the map area, with the one
        // shadow in the design so it reads as lifted off the map.
        'absolute inset-x-0 bottom-0 z-20 flex h-[214px] flex-col rounded-t-sm border-t border-ink bg-background text-foreground shadow-[0_-2px_12px_rgba(0,0,0,0.12)]',
        'transition-[height] duration-200 ease-out data-[sheet=full]:h-[72%]',
        // Desktop: a static sidebar beside the map.
        'md:static md:z-auto md:h-full md:w-[420px] md:shrink-0 md:rounded-none md:border-r md:border-t-0 md:border-ink md:shadow-none md:data-[sheet=full]:h-full',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
        className="flex h-6 w-full shrink-0 cursor-grab touch-none items-center justify-center md:hidden"
        onPointerDown={(e) => {
          startY.current = e.clientY
          dragged.current = false
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerUp={(e) => {
          if (startY.current === null) return
          const dy = e.clientY - startY.current
          startY.current = null
          if (Math.abs(dy) > DRAG_THRESHOLD_PX) {
            dragged.current = true
            onExpandedChange(dy < 0)
          }
        }}
        onClick={() => {
          // A drag already decided; a plain tap toggles.
          if (dragged.current) {
            dragged.current = false
            return
          }
          onExpandedChange(!expanded)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            onExpandedChange(true)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            onExpandedChange(false)
          }
        }}
      >
        <span aria-hidden className="h-1 w-10 rounded-sm bg-ink/40" />
      </button>
      {children}
    </aside>
  )
}
