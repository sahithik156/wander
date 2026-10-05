# Build notes

Log of what I built, what the coding agent did, and what I verified or
changed myself.

## How I worked
- Coding agent: Claude Code in VS Code, with the DeepSpace skill and docs.
- Planning and review: I used a second AI assistant (Claude chat) to plan
  slices, write prompts, and review the agent's plans and reports before
  approving them.
- Method: one slice at a time, plan mode first, approve or correct the
  plan, then check results myself in the browser. Requirements live in
  SPEC.md, which every agent session reads.
- Below, "I found" means I noticed it myself; "caught in review" means it
  came out of reviewing the agent's work with the second assistant.

## Day 1: research, setup, data tests

### Data tests (done by me in the browser)
- Wikipedia geosearch:
  - Central London: 50 places within 160m. Dense areas need a bigger
    radius and more results.
  - Suburb (Forest Hill): 50 places within 2km, but noisy (districts,
    constituencies, roads, many stations and schools, a murder page).
    Decision: code filters first, then AI selection.
  - Rural (Scottish Highlands, 57.0, -4.5): 0 places. Needs a clear
    empty state.
  - Place text (extracts): rich, sourced paragraphs. Good enough for
    narration with a "facts only" rule.
- Overpass (OpenStreetMap): 406 error. Dropped it.
- Platform integrations (`npx deepspace integrations list`):
  - Used: anthropic (AI selection and narration) and
    serpapi/places-search (Google Maps fallback and food).
  - Left out: the platform wikipedia integration (no geosearch, so I
    call Wikipedia's public API from the worker), elevenlabs (audio,
    not built), openweathermap (place search, not built).
  - The anthropic integration defaults to an expensive model, so the
    model is always set explicitly to claude-haiku-4-5.
  - No API keys in the app: all paid services go through DeepSpace
    integrations billed to my account.

### Setup
- Scaffold failed: npm 10.9.2 was below the required 11.6.0. Read the
  error, updated npm to 11, reran successfully.
- CLI commands had changed (whoami is now `auth whoami`). Checked
  `npx deepspace --help` and used the current commands.
- Deployed the blank app to wander.app.space. Sign-in works live.
- Checked .gitignore includes .dev.vars: yes.

## Slice 1: schemas, map, Build tour, Wikipedia job

### Agent built
- `tours` and `stops` schemas, registered in `src/schemas.ts`.
- `build-tour` background job: validates the tour, calls Wikipedia
  geosearch from the worker, applies code filters, writes stops one at a
  time, updates the tour status live.
- `src/server/wikipedia.ts`, `src/server/tour-validation.ts`, with unit
  tests.
- MapLibre map with OpenFreeMap tiles; home page replaced with the
  builder, live status, and live stop markers.

### Decisions
- Tours: members create; clients may only send title, lat, lng, theme,
  minutes, isPublic (`writableFields`). lat/lng/theme/minutes are
  immutable. `ownerId` is `userBound`, stamped from the session.
  status and errorMessage are written only by the job.
- Stops: no client writes for any role. Only the job writes them.
- Stops carry their own `ownerId` and `isPublic`, because permissions
  cannot read the parent tour.
- `isPublic` is 'public' | 'private' text because `visibilityField`
  matches the literal 'public'.
- Job ownership: the SDK stamps `enqueuedBy` from the verified session;
  the job only runs on that user's own queued tours.
- The job validates inputs (minutes 30/60/90, valid coordinates), else
  status `failed`.
- Caught in review: the agent proposed a comma-based title filter
  ("Name, Place"). It would have dropped real landmarks from my own test
  data ("Statue of Charles James Napier, Trafalgar Square", "One Tree
  Hill, Honor Oak") and even "Trafalgar Square". Rejected: dropping a
  landmark is worse than keeping a district, because the AI step can
  remove districts later but cannot recover dropped landmarks.

### Bug: map area blank (I found)
- I checked: container 655x607 (turned out to be the outer wrapper, not
  the map div), maplibregl-map class present, console showed 3 harmless
  MapLibre style warnings.
- Agent found the cause: MapLibre's unlayered `.maplibregl-map
  { position: relative }` overrode Tailwind v4's layered
  `absolute inset-0`, collapsing the map div to 0 height.
- Fix: positioning moved to a plain wrapper.
- Lesson: I measured the wrong element. Check the innermost element.

### Bug: Build tour disabled (I found)
- Symptom: button dimmed. Console showed the realtime WebSocket failing.
- Root cause (agent traced via server logs): I had rejected the
  tours-schema.ts write while the schemas.ts edit went through, so
  schemas.ts imported a missing file and every WebSocket returned 500
  until I restarted the dev server.
- Fix: restart. No code change.
- Lesson: rejecting one file in a multi-file change can leave the
  project half-updated. Tell the agent immediately.
- A 401 seen in testing came from the agent's signed-out test runs;
  unrelated.

### Verified by me
- London tour in my browser: stops appeared live, status Done.
- I noticed all 8 stops of a 60-minute tour were within ~200m of the
  pin: geosearch returns results sorted by distance.
- Deployed and verified on wander.app.space.

## Slice 2: AI selection and narration

### Agent built
- Candidates spread across the radius. Agent measured that in central
  London one search (150 results) only reaches ~317m. Multi-point search
  (center plus 6 ring points) runs only when the center search hits the
  150 limit, with at most 3 requests at once.
- Claude Haiku (via the anthropic integration, no API key) picks stops;
  code validates ids and orders them; a second call writes narration
  from Wikipedia text only.
- Stops appear on the map before narration; status goes finding,
  choosing, writing, done.
- Cost guard: one building tour per user at a time.

### Verified and changed
- I verified in my browser: a 60-minute history tour from Leicester
  Square to Westminster Abbey with narration and Source links.
- Caught in review: the loop's return leg wasted ~1.5km. Tours are now
  one-way.
- Caught in review: two stops inside Westminster Abbey. Added a
  near-duplicate rule.
- Caught in review: narration changed "probably 1633" to "cast in
  1633". Added a rule to keep the source's uncertainty words.
- Narrations were short because only Wikipedia intros were sent.
  Decision: send more source text rather than loosen facts-only.

## Slice 3: coverage beyond English Wikipedia

### Problem (I found)
- Vijayawada and Hyderabad returned no tours, though they have many
  temples and landmarks. English Wikipedia underrepresents India
  (Vijayawada: 0 places at 800m and 2.2km; London: 150).

### Agent built
- Radius widening when results are thin.
- Google Maps fallback via serpapi/places-search ($0.0325 per call),
  only when Wikipedia is thin. London makes 0 Maps calls.
- AI "second chance": if the AI keeps too few stops, call Maps once,
  merge, and re-select.
- Honest short text for Maps-only stops, marked "Limited info".

### Decisions and catches
- Caught in review: keyword filters like "ward" would drop "Statue of
  Edward VII". Rejected; the AI second chance handles admin areas.
- Caught in review: type filtering must match whole words ("bar" must
  not match "Prakasam Barrage").
- Caught in review: a Vijayawada route was 4.8km against a ~2.8km
  budget. Root cause (agent admitted): the time budget existed only as a
  sentence in the prompt; there was no trimming code. Fixed with
  `route-budget.ts`, shared by the job and the UI.
  Lesson: a requirement in a plan is not proof it exists in code.
- Prompt rules did not stop invented claims ("transformed Vijayawada's
  landscape", "draws devotees"). Decision: transitions and Maps-only
  text are built in code from data ("honest by construction"); the AI
  only narrates from full source text; code removes filler words
  (legacy, iconic, remarkable...) unless they appear in the source.
- Caught in review: "500 ft elevation" became "rises 500 feet above the
  area". Added a rule to copy measurements with their exact meaning.
- Caught in review: trimming dropped Prakasam Barrage (a major landmark)
  and kept an address-only temple. Trim order changed: Maps-only stops
  go first.
- Agent added, unasked: time limits on all outside calls, and stuck
  tours unlock after 5 minutes. Reviewed and kept.
- The agent found that the shell had corrupted regex escapes into
  invisible characters during edits, repaired them, and scanned src.
- Kept the Maps call even when Wikipedia finds nothing: places without
  English Wikipedia coverage are the point of this slice.

## Testing for overfitting (my concern)
- I worried the fixes were tuned to London and Vijayawada, so I asked
  for a test set of lesser-known places: Warangal, Bhuj, Tartu, Evora,
  Dubuque, Kumasi, Gondar, Cuenca, Salta, Ipoh, Mardin, Ballarat, and
  the open ocean, plus London, Charminar, Kanaka Durga, and the
  Highlands.
- First run, no code changes: 12 of 13 new places produced tours; the
  ocean was correctly empty. 7 Maps calls (~$0.23).
- Patterns: events, rivers, and organizations as stops; several parts
  of one site; long walks after widening; wasted Maps calls; untitled
  all-Maps tours.
- Fixes: Wikipedia type filter (only 49% of places have a type, so it
  helps but is not enough), "Battle of"/"Siege of"/"Diocese of" title
  prefixes, a 150m same-site rule for Maps stops, code-built titles,
  no counting the walk from the pin to the first stop, second chance
  only when Wikipedia is thin.
- Regression caught in review: stricter rules turned Warangal and Gondar
  into no tour. Decision: minimum 3 stops; a short tour beats none.
- Saved as `tests/locations.ts` (opt-in, because each run makes paid
  calls).

## Product decisions (mine)
- "Plan a tour", not "walking tour": people in Indian cities often
  combine walking with autos or cars. Spread-out tours say "best by car
  or auto" instead of being refused.
- Themes: History, Architecture, Art & museums, Temples & sacred places,
  Nature & parks, Food, Highlights ("Surprise me" was too vague).
- Food theme: local dishes come only from Wikipedia cuisine articles
  (city, then state, then country) and must appear word for word in the
  article. Places to eat come from Google Maps with ratings and are
  ranked in code. The app never claims a restaurant serves a dish; the
  dishes section says it is not tied to the places.
- "Include a food stop" for other themes.
- Verified by me: a Vijayawada Food tour with 3 real restaurants and
  Andhra cuisine dishes (Pulusu, Pappu, Avakaya).
- I found: the food stop worked in Vijayawada but silently did nothing
  in Warangal. Cause: the search radius was too small for a tour ending
  by the lake. Fixed with a wider search and a clear message if nothing
  qualifies. Verified it now works in Warangal.
- Search queries: Google read a comma list ("temples, churches,
  mosques, shrines") as one place name, and the food query returned
  mostly sweet shops. Rewrote the queries; at most one sweet shop per
  food tour.
- Lost requests: two changes I had asked for (description-only Maps
  text, walking minutes in transitions) were never built; the requests
  were lost between sessions. Lesson: requirements go in SPEC.md, not
  only chat.
- Transition minutes include the 1.3x street factor, matching the route
  budget.

## Design (my call)
- The first redesign looked AI-generated (dark, salmon, pill chips,
  uppercase monospace labels).
- Replaced with a printed city guide + metro map design: paper and ink,
  a cobalt route line, a tomato food line, Gloock and Familjen Grotesk,
  square corners, a crosshair pin. UI only; the agent confirmed no
  server, schema, or job files changed.
- After the font packages changed, the dev server failed with a Vite
  cache error. Fixed by deleting node_modules/.vite.

## Known limits and next steps
- Untyped Wikipedia pages (rivers, some events) can still slip through.
- Narration is short where Wikipedia intros are short. Next:
  other-language Wikipedias, Wikidata.
- Google Maps results vary between runs.
- The food stop can add a long last leg on spread-out tours.
- Highlights can be weak (a railway station).
- Not built: audio narration, GPX export, public share links,
  place-name search, suggesting a better pin where sights cluster.