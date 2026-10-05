/**
 * Food theme: the dishes picked from the regional cuisine article, set as a
 * menu card, "Eat like a local": a thin tomato rule above, each dish name in
 * the display face with a dotted leader, its note below, and a small source
 * line at the bottom. Kept separate from the stops on purpose: the Maps data
 * never says which place serves which dish (SPEC.md "Food theme").
 *
 * Presentation only; data-testids match the previous section.
 */

import type { Dish } from '../../schemas/tours-schema'

interface LocalDishesProps {
  dishes: Dish[]
  cuisineTitle?: string
  cuisineUrl: string
}

export function LocalDishes({ dishes, cuisineTitle, cuisineUrl }: LocalDishesProps) {
  return (
    <section className="mt-10 border-t-2 border-food pt-5" aria-labelledby="eat-like-a-local" data-testid="local-dishes">
      <h2 id="eat-like-a-local" className="font-display text-[28px] leading-tight text-foreground">
        Eat like a local
      </h2>
      <p className="mt-1 text-[15px] text-muted-foreground">Local dishes to try</p>
      <ul className="mt-5 space-y-5">
        {dishes.map((dish) => (
          <li key={dish.name} data-testid="dish-item">
            <div className="flex items-baseline gap-2">
              <a
                href={cuisineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display text-xl leading-tight text-foreground underline-offset-4 hover:underline [overflow-wrap:anywhere]"
              >
                {dish.name}
              </a>
              {/* Dotted leader, as on a printed menu. */}
              <span aria-hidden className="min-w-8 flex-1 translate-y-[-0.3em] border-b-2 border-dotted border-ink/40" />
            </div>
            {dish.note && <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{dish.note}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-6 border-t border-rule pt-3 text-[13px] leading-relaxed text-muted-foreground">
        Source: Wikipedia, {cuisineTitle}. Not tied to the places above.
      </p>
    </section>
  )
}
