/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * Need live data or auth here? Move this file to src/pages/(app)/index.tsx
 * and it becomes a dynamic page. Conversely, any page you want to keep static
 * (marketing, docs, legal) belongs at this top level.
 *
 * Top-level pages are also prerendered to static HTML at build
 * (prerender.ts, via vite.config.ts) so crawlers read real content.
 * Keep them renderable without a browser: no window/document during render,
 * prose in HTML text, reveal animations in CSS keyframes rather than JS-driven
 * initial states. `<Seo>` comes first and reads src/seo.ts.
 *
 * Design: a page from a printed city guide (SPEC.md "Visual design"). The
 * three steps sit as stations along a cobalt metro line, not as feature cards.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const STEPS = [
  {
    title: 'Drop a pin',
    body: 'Anywhere: your street, an old town, a city you are visiting. Pick 30, 60, or 90 minutes and a theme.',
  },
  {
    title: 'Wander finds real places',
    body: 'Stops come from Wikipedia and Google Maps, ordered into one route that fits your time.',
  },
  {
    title: 'Go, with sourced notes',
    body: 'Each stop has a short note written only from its source, with a link to check it. Walk it, or take a car or auto between stops.',
  },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-6xl items-baseline justify-between border-b border-ink px-6 py-5">
          <span className="font-display text-2xl">{APP_NAME}</span>
          <Link to="/home" className="text-[15px] underline decoration-1 underline-offset-4 hover:decoration-2">
            Open the planner
          </Link>
        </header>

        <main className="mx-auto grid max-w-6xl gap-14 px-6 pb-20 pt-12 md:grid-cols-[1.15fr_1fr] md:gap-20 md:pt-20">
          <section>
            <p className="text-[15px] text-muted-foreground">A city guide for any neighborhood</p>
            <h1 className="mt-3 font-display text-[44px] leading-[1.02] text-foreground sm:text-6xl lg:text-7xl">
              Tours of any neighborhood, built from real sources
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-foreground">
              Drop a pin and Wander plans a short tour around it: real places, in an order that fits your time, with
              notes that only use what their sources say.
            </p>
            <Link
              to="/home"
              className="mt-9 inline-flex h-12 items-center rounded-sm border border-ink bg-ink px-7 text-base font-medium text-background transition-colors hover:bg-ink/85"
            >
              Plan a tour
            </Link>
          </section>

          <section aria-labelledby="how-heading" className="md:pt-3">
            <h2 id="how-heading" className="border-b border-ink pb-2 font-display text-2xl">
              How it works
            </h2>
            {/* The steps as stations on a metro line. */}
            <ol className="relative mt-6">
              {STEPS.map((step, i) => (
                <li key={step.title} className="relative grid grid-cols-[2.25rem_1fr] gap-x-4 pb-9 last:pb-0">
                  {i < STEPS.length - 1 && (
                    <span aria-hidden className="absolute bottom-0 left-[calc(1.125rem-2px)] top-5 w-1 bg-line" />
                  )}
                  <span
                    aria-hidden
                    className="relative z-10 flex size-9 items-center justify-center rounded-full border-[3px] border-ink bg-background text-sm font-medium tabular-nums"
                  >
                    {i + 1}
                  </span>
                  <div className="pt-1">
                    <h3 className="font-display text-2xl leading-tight">{step.title}</h3>
                    <p className="mt-2 text-base leading-relaxed text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </main>

        <footer className="mx-auto max-w-6xl border-t border-rule px-6 py-6 text-[13px] text-muted-foreground">
          Sources: Wikipedia and Google Maps. Every stop links to where its facts came from.
        </footer>
      </div>
    </>
  )
}
