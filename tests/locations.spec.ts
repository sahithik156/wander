/**
 * Coverage run over tests/locations.ts. OPT-IN: it builds a real tour per
 * location, which makes paid Claude calls and possibly SerpApi calls
 * ($0.0325 each), so it is skipped unless WANDER_LOCATIONS is set:
 *
 *   WANDER_LOCATIONS=all npx deepspace test run all --grep "location "
 *   WANDER_LOCATIONS="Warangal,Bhuj" npx deepspace test run all --grep "location "
 *
 * Each tour's statuses and stops are written as JSON to
 * $WANDER_LOCATIONS_OUT (default .deepspace/locations/). The server's
 * "[build-tour] <tourId> {...}" log line has SerpApi calls and timings;
 * the JSON includes tourId to match them up.
 *
 * The map pin can't be placed at exact coordinates by clicking, so the spec
 * clicks the map and rewrites lat/lng in the tour-create WebSocket message.
 */

import { test, expect } from 'deepspace/testing'
import fs from 'node:fs'
import path from 'node:path'
import { LOCATIONS } from './locations'

const selected = process.env.WANDER_LOCATIONS
const wanted =
  selected && selected !== 'all' ? new Set(selected.split(',').map((s) => s.trim().toLowerCase())) : null
const outDir = process.env.WANDER_LOCATIONS_OUT ?? path.join('.deepspace', 'locations')

test.describe('location tours', () => {
  test.skip(!selected, 'Set WANDER_LOCATIONS=all (or a comma-separated list) to run; makes paid calls.')
  test.setTimeout(180_000)

  for (const loc of LOCATIONS) {
    if (wanted && !wanted.has(loc.name.toLowerCase())) continue

    test(`location ${loc.name}`, async ({ users }) => {
      const [u] = await users(1)
      const page = u.page
      const inbound: unknown[] = []
      let tourId: string | undefined

      await page.routeWebSocket(/.*/, (ws) => {
        const server = ws.connectToServer()
        ws.onMessage((msg) => {
          if (typeof msg === 'string') {
            try {
              const m = JSON.parse(msg)
              if (m?.type === 'core.put' && m.payload?.collection === 'tours') {
                m.payload.data = { ...m.payload.data, lat: loc.lat, lng: loc.lng }
                tourId = m.payload.recordId
                server.send(JSON.stringify(m))
                return
              }
            } catch {
              /* not JSON */
            }
          }
          server.send(msg)
        })
        server.onMessage((msg) => {
          if (typeof msg === 'string') {
            try {
              inbound.push(JSON.parse(msg))
            } catch {
              /* ignore */
            }
          }
          ws.send(msg)
        })
      })

      await page.goto('/home')
      const map = page.getByTestId('tour-map')
      await expect(map).toBeVisible()
      await page.waitForTimeout(1500)
      const box = (await map.boundingBox())!
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await page.getByTestId(`length-${loc.minutes}`).click()
      await page.getByTestId('theme-select').click()
      await page.getByRole('option', { name: loc.theme.charAt(0).toUpperCase() + loc.theme.slice(1) }).click()
      const t0 = Date.now()
      await page.getByTestId('build-tour').click()

      const statuses: { status: string; ms: number }[] = []
      for (;;) {
        const s =
          (await page
            .getByTestId('tour-status')
            .getAttribute('data-status', { timeout: 1000 })
            .catch(() => null)) ?? 'none'
        if (statuses.at(-1)?.status !== s) statuses.push({ status: s, ms: Date.now() - t0 })
        if (['done', 'failed', 'too_few_places'].includes(s) || Date.now() - t0 > 150_000) break
        await page.waitForTimeout(250)
      }
      await page.waitForTimeout(1500)

      // Latest state of each stop and the tour, from the live record updates.
      const stops = new Map<string, Record<string, unknown>>()
      let tour: Record<string, unknown> | undefined
      const walk = (o: unknown): void => {
        if (!o || typeof o !== 'object') return
        if (Array.isArray(o)) return o.forEach(walk)
        const r = o as { recordId?: string; data?: Record<string, unknown> }
        if (r.data && r.data.tourId === tourId && r.recordId) {
          stops.set(r.recordId, { ...(stops.get(r.recordId) ?? {}), ...r.data })
        }
        if (r.data && r.recordId === tourId && 'theme' in r.data) tour = { ...(tour ?? {}), ...r.data }
        Object.values(o).forEach(walk)
      }
      walk(inbound)

      const panel = {
        routeLength: await page.getByTestId('route-length').textContent({ timeout: 1000 }).catch(() => null),
        longWalk: await page.getByTestId('long-walk').textContent({ timeout: 1000 }).catch(() => null),
        startDistance: await page.getByTestId('start-distance').textContent({ timeout: 1000 }).catch(() => null),
        error: await page.locator('.text-destructive').allTextContents(),
      }
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(
        path.join(outDir, `${loc.name.toLowerCase().replace(/\s+/g, '-')}.json`),
        JSON.stringify(
          {
            location: loc,
            tourId,
            statuses,
            tour,
            panel,
            stops: [...stops.values()].sort((a, b) => Number(a.order) - Number(b.order)),
          },
          null,
          1,
        ),
      )
    })
  }
})
