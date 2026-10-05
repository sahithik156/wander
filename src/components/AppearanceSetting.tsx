/**
 * Light / Dark appearance for Wander (SPEC.md "Visual design").
 *
 * Light is always the default. Dark applies only when picked here: the choice
 * is saved in this browser (localStorage "wander-appearance") and index.html
 * applies it before first paint on every page. It never follows the device
 * setting. Switching sets data-theme ("wander" / "wander-night") and the SDK's
 * data-ui-theme on <html>.
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { getActiveTheme } from '../themes'

type Appearance = 'light' | 'dark'

const STORAGE_KEY = 'wander-appearance'

function apply(appearance: Appearance) {
  const root = document.documentElement
  root.setAttribute('data-theme', appearance === 'dark' ? 'wander-night' : 'wander')
  root.setAttribute('data-ui-theme', appearance)
  try {
    if (appearance === 'dark') localStorage.setItem(STORAGE_KEY, 'dark')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

export function AppearanceSetting() {
  const [appearance, setAppearance] = useState<Appearance>(() =>
    getActiveTheme() === 'wander-night' ? 'dark' : 'light',
  )

  const choose = (next: Appearance) => {
    setAppearance(next)
    apply(next)
  }

  return (
    <div role="radiogroup" aria-label="Appearance" className="inline-grid grid-cols-2 border border-ink">
      {(['light', 'dark'] as const).map((option, i) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={appearance === option}
          onClick={() => choose(option)}
          className={cn(
            'h-10 min-w-24 cursor-pointer px-4 text-sm transition-colors',
            i > 0 && 'border-l border-ink',
            appearance === option ? 'bg-ink text-background' : 'bg-transparent text-foreground hover:bg-accent',
          )}
        >
          {option === 'light' ? 'Light' : 'Dark'}
        </button>
      ))}
    </div>
  )
}
