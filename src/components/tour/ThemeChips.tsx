/**
 * Theme picker: a wrapping set of square-cornered options, like the index of
 * a printed guide. The selected theme is filled ink with paper text (cobalt
 * is kept for the route only). Presentation only: value and handler come
 * from the page.
 *
 * Built as a single-select listbox (role="listbox" / role="option" with
 * aria-selected) so assistive tech announces the choice, and so the existing
 * Playwright flow (click `theme-select`, then the option by name) still works.
 */

import { cn } from '@/lib/utils'

interface ThemeChipsProps<T extends string> {
  themes: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (theme: T) => void
  disabled?: boolean
}

export function ThemeChips<T extends string>({ themes, labels, value, onChange, disabled }: ThemeChipsProps<T>) {
  return (
    <div
      role="listbox"
      aria-label="Theme"
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      data-testid="theme-select"
      className="flex flex-wrap gap-2"
    >
      {themes.map((t) => {
        const selected = t === value
        return (
          <button
            key={t}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(t)}
            className={cn(
              'cursor-pointer rounded-sm border border-ink px-3 py-2 text-[15px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              selected ? 'bg-ink text-background' : 'bg-transparent text-foreground hover:bg-accent',
            )}
          >
            {labels[t]}
          </button>
        )
      })}
    </div>
  )
}
