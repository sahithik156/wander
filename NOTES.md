# Build notes

Log of what the agent did and what I verified or changed myself.

### Research and data tests (done by me)
- Tested Wikipedia geosearch in the browser:
  - Central London: 50 places within 160m. Dense areas need a bigger
    radius and more results.
  - Suburb (Forest Hill): 50 places within 2km, but noisy (districts,
    constituencies, roads, many stations and schools, a murder page).
    Decided on code filters first, then AI selection.
  - Rural (Scottish Highlands, 57.0, -4.5): 0 places. Needs an empty
    state that suggests the nearest area with places.
  - Place text (extracts): rich, sourced paragraphs. Good enough for
    narration with a "facts only" rule.
- Tried Overpass (OpenStreetMap): 406 error. Dropped it; Wikipedia
  covers what we need.
- Checked platform integrations with `npx deepspace integrations list`:
  - wikipedia has no geosearch, so we call Wikipedia directly.
  - Using anthropic (AI), elevenlabs (audio), openweathermap (geocoding).
  - anthropic defaults to an expensive model, so the model is always
    set explicitly to claude-haiku-4-5.

- Found coverage bias: London gives 6 to 8 stops, but Vijayawada and
  Hyderabad give too_few_places, despite many temples and landmarks.
  English Wikipedia underrepresents India. Plan: widen radius when
  sparse, then add serpapi/places-search as a fallback source with
  honest short descriptions for places without Wikipedia articles.

### Bug: map area blank on /home
- I checked: container 655x607 (turned out to be the outer wrapper,
  not the map div), maplibregl-map class present, console showed
  3x MapLibre style warnings (harmless).
- Agent found the cause: MapLibre's unlayered .maplibregl-map
  { position: relative } overrode Tailwind v4's layered absolute inset-0,
  collapsing the map div to 0 height.
- Fix: positioning moved to a plain wrapper; map div is h-full w-full.
- Agent verified with a headless browser (canvas 1200x751, all tile
  requests 200). I confirmed the map renders in my browser.
- Lesson: I measured the wrong element. Check the innermost element.
- Open item: a 401 appears in signed-out runs; not yet traced.

### Bug: Build tour disabled
- Symptom: button dimmed. Console showed realtime WebSocket failing.
- Root cause (agent traced via server logs): I rejected the
  tours-schema.ts write while the schemas.ts edit went through, so
  schemas.ts imported a missing file. Every WebSocket returned 500
  until I restarted the dev server.
- Fix: restart. No code change.
- Lesson: rejecting one file in a multi-file change can leave the
  project half-updated. Tell the agent immediately.
- Verified: after restart, London pin builds a tour with 8 stops live.
- Coverage data: Vijayawada 0 places at 800m and 2.2km; south Delhi 3
  at 2.2km; London 150.
- The 401 was from the agent's signed-out headless runs on port 5199;
  not related.
  
### Setup
- Scaffold failed: npm 10.9.2 was below the required 11.6.0. Read the
  error, updated npm to 11, reran successfully.
- CLI commands changed (whoami is now `auth whoami`); checked
  `npx deepspace --help` and used the current commands.
- Deployed blank app to wander.app.space. Sign-in works on the live app.
- Checked .gitignore includes .dev.vars: yes

### Agent work
- (add entries here after each slice: what the agent built, what I
  tested, what broke, what I changed)

#### Slice 1: schemas, map + Build tour, Wikipedia job (agent)
Built:
- `tours` and `stops` schemas (`src/schemas/tours-schema.ts`,
  `stops-schema.ts`), registered in `src/schemas.ts`.
- `build-tour` background job (`src/jobs.ts`, `src/server/build-tour.ts`):
  validates the tour, calls Wikipedia geosearch from the worker, applies the
  code filters, writes the first 8 remaining places as stops one at a time,
  and updates the tour status.
- `src/server/wikipedia.ts` (geosearch + `filterPlaces`),
  `src/server/tour-validation.ts`, with unit tests for both.
- Full-screen MapLibre map (OpenFreeMap "liberty" style) in
  `src/components/map/TourMap.tsx`; `src/pages/(app)/home.tsx` replaced with
  the pin/length/theme builder, live status badge, and live stop markers.
- Added the `maplibre-gl` dependency.

Decisions:
- Tours: members create; clients may send only title, lat, lng, theme,
  minutes, isPublic (`writableFields`). lat/lng/theme/minutes are `immutable`,
  so after creation only title and isPublic can change. `ownerId` is `userBound`
  (stamped from the session, so a client cannot set it). status and
  errorMessage are written only by the job. Tour delete is off for now.
- Stops: no client create/update/delete for any role, including admin. Only the
  job writes them (owner context bypasses RBAC).
- stops has its own `ownerId` column (not userBound: userBound would stamp the
  app owner when the job writes) because permissions cannot read the parent
  tour.
- `isPublic` is 'public' | 'private' text, not a boolean, because
  `visibilityField` matches the literal 'public'. Stops carry a denormalized
  `isPublic`; the sharing slice must keep it in sync with the tour.
- No `createdAt` column; the record envelope's createdAt is used instead.
- Job ownership: the SDK stamps `enqueuedBy` from the verified WebSocket
  session. The job requires it and only looks up tours owned by that user. A
  job only runs on a tour whose status is `queued`, so a re-enqueue cannot
  duplicate stops.
- Tour validation in the job: minutes must be 30/60/90, lat -90..90, lng
  -180..180, else status `failed` with an errorMessage.
- Filters: drop titles containing "constituency", "(UK Parliament", " road",
  "Built-up Area" (case-insensitive); keep at most one railway station
  (title matches "railway station" or ends in "station") and one school
  (title contains "school"), nearest first. No town/district rule, by design:
  the AI step will remove districts later.
- Fewer than 4 places after filtering sets status `too_few_places` and writes
  no stops (the 10 km "nearest area" suggestion is a later slice). The
  `choosing` and `writing` statuses are unused until the AI slice.
- Wikipedia User-Agent is `Wander/0.1 (https://wander.app.space; walking-tour app)`.
- Console: 3x MapLibre worker warning "expected number, found null".
  Means the style loaded; likely harmless style noise, not the cause.
- Hypothesis now: data loads but nothing draws (CSS, canvas size, or resize).