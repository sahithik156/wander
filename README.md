    # Wander

    Wander plans short tours of any neighborhood from real sources. Drop a pin on the map, pick 30, 60, or 90 minutes and a theme, and Wander finds nearby places on Wikipedia (and on Google Maps where Wikipedia is thin), lets Claude pick the stops, orders them into a one-way route that fits your time, and writes a short note for each stop using only what its source says. Every stop links to its source. Tours are planned for walking, and the app says when the stops are better reached by car or auto.

    Live: https://wander.app.space

    Built on [DeepSpace](https://deep.space) (Cloudflare Workers). The product spec is [SPEC.md](SPEC.md); the build log, with what I verified and what I changed, is [NOTES.md](NOTES.md).

    ## How it works

    A tour is built by a background job (`build-tour`, in `src/server/build-tour.ts`). The tour status moves through `finding`, `choosing`, `writing`, and `done` (or `too_few_places` / `failed`). The page subscribes to the `tours` and `stops` records, so stops appear on the map as soon as they are written, before their narration.

    1. **Find places (Wikipedia).** Geosearch around the pin: 800 m, 1500 m, or 2200 m for 30, 60, or 90 minutes. Geosearch returns at most 150 results nearest first, which in central London only reaches about 300 m, so when the center search hits that limit the job also searches 6 points on a ring at 2/3 of the radius (at most 3 requests at once) and merges the results.
    2. **Filter in code.** Drop noise titles (constituencies, roads, "Diocese of", "Battle of", "Siege of"), non-walkable Wikipedia coordinate types (events, rivers, admin areas; lakes and rivers are kept for the Nature theme), and extra railway stations and schools. Up to 40 candidates are sampled evenly from the inner, middle, and outer thirds of the radius. If fewer than 8 remain, the search widens to 1.5x, then 2x the radius.
    3. **Google Maps fallback.** If Wikipedia is still thin, one `serpapi/places-search` call with the theme's query. Food, shops, and lodging are filtered out (whole-word type matching), and a Maps place within 50 m of a Wikipedia place, or with the same name, is dropped. If the AI later keeps fewer than 5 stops and Wikipedia had fewer than 20 candidates, Maps is searched once and the AI picks again. Dense areas such as central London make no Maps calls.
    4. **Select (Claude Haiku).** The AI picks 5 to 8 real, walkable places that fit the theme, given each candidate's source, category, distance, and the first 300 characters of its text. Code drops invented or duplicate ids and same-site duplicates (50 m between Wikipedia stops, 150 m for Maps stops).
    5. **Order and trim (code).** Nearest-neighbor, one way from the pin. A time budget (minutes at stops, walking at 4.5 km/h, streets 1.3x longer than straight lines; `src/lib/route-budget.ts`) drops stops until the route fits, never below 3. A route that still does not fit is kept and marked "Spread out: X km, best by car or auto". The walk from the pin to the first stop is shown separately and not counted.
    6. **Narrate (Claude Haiku).** Wikipedia stops get narration written only from their extract: every date, number, and name must appear in it, no hours or prices, no padding. Code then removes sentences with filler words (legacy, iconic, remarkable, and similar) unless the word is in the source.
    7. **Code-built text.** Transitions ("Head southeast about 2.2 km (38 min on foot) to ...") and the text of Maps-only stops (their description, or "A Hindu temple in Islampet, Vijayawada") are built in code from the data, because the AI kept adding claims. Maps-only stops are marked "Limited info".

    All external calls happen in the worker, with time limits (Wikipedia 15 s, Claude 60 s, SerpApi 20 s). A tour whose job stops updating for 5 minutes is shown as stopped, so the builder never stays locked.

    ## Themes

    History, Architecture, Art & museums, Temples & sacred places, Nature & parks, Food, and Highlights. Each theme has its own selection guidance for the AI and its own Google Maps query (`src/server/theme-config.ts`). Every theme except Food can add one well-rated place to eat at the end of the route ("Include a food stop"), searched within 600 m of the last stop, then the middle stop, then up to 1.5 km; if none qualifies, the panel says so.

    ### Food theme

    - **Places to eat** come from Google Maps: restaurants and street food (plus one extra search for sweet shops if there are too few meals), rated 4.0 or higher with enough reviews, ranked in code. 3, 4, or 5 stops for 30, 60, or 90 minutes, at most one sweets or dessert place per tour, one branch per chain. Stops show rating, review count, category, and price band.
    - **Local dishes** come only from the regional cuisine article on Wikipedia, found from the city, state, and country in the Maps addresses (for example Hyderabadi cuisine, Telangana cuisine, British cuisine). Claude picks 3 to 5 dishes from the article text; code keeps a dish only if its name appears word for word in the article, and its note is a full sentence from the article chosen by code.
    - **Dishes are never tied to a restaurant.** The Maps data does not say which place serves which dish, so the "Eat like a local" section is separate from the stops and says it is not tied to them.

    ## DeepSpace features and integrations

    Used:
    - **Auth** (`DeepSpaceAuthProvider`, `AuthOverlay`): sign-in is required to build tours.
    - **Records** with RBAC: `tours` and `stops` collections. Clients may create tours and send only title, lat, lng, theme, minutes, isPublic, and includeFood; the location and theme are immutable; `ownerId` is stamped from the session. Stops are written only by the job. Reads are owner-only, or anyone when `isPublic` is "public".
    - **Live queries** (`useQuery`, `useMutations`): status and stops update without polling.
    - **Background jobs** (`JobRoom`, `useJobs().enqueue`): the job trusts only the SDK-stamped `enqueuedBy` and runs only on that user's queued tours.
    - **Integrations** from the worker, billed to the app owner, with no API keys in the app: `anthropic/chat-completion` (model always set to `claude-haiku-4-5`, because the integration defaults to an expensive model) and `serpapi/places-search` (Google Maps, $0.0325 per call).
    - **Theme system**: `wander` (light, default) and `wander-night` (dark, chosen in Settings) in `src/themes.css`.
    - **Cloud repo and deploy** to `wander.app.space`, and the **test-account Playwright fixture**.

    Checked and left out:
    - **wikipedia integration**: no geosearch, so the worker calls Wikipedia's public API directly.
    - **openweathermap/geocoding**: planned for typing a place name; not built.
    - **elevenlabs/generate-speech** and file storage: planned for audio narration; not built.
    - **Overpass (OpenStreetMap)**, outside DeepSpace: returned 406 in testing; Wikipedia and Google Maps cover the need.
    - Messaging, presence, and Yjs: not needed (multiplayer is out of scope).

    ## Run locally

    Requires Node 22, 24, or 26 and npm 11.6 or newer.

    ```sh
    npm install
    npx deepspace auth login     # opens a browser
    npx deepspace dev start      # local dev server (Vite + Miniflare)
    ```

    The dev server calls the real integrations, so building tours locally spends the app owner's credits. Secrets are generated into `.dev.vars` by the CLI on each dev, test, and deploy run; it is git-ignored.

    ## Deploy

    DeepSpace deploys from its own cloud repo (remote `space`) and needs a clean, committed worktree:

    ```sh
    git add -A && git commit -m "..."
    npx deepspace deploy
    ```

    `npx deepspace status` shows the live release; `npx deepspace releases` and `npx deepspace rollback <release-id>` handle rollbacks.

    ## Tests

    ```sh
    npm run validate             # type-check + unit tests (Vitest)
    npm run lint
    npx deepspace test run       # Playwright smoke + api suites
    npx deepspace test run all   # every Playwright spec
    ```

    Unit tests cover the pure logic: candidate sampling and same-site rules, route ordering and trimming, the time budget, JSON parsing and validation, Maps parsing and filters, food ranking and the variety rule, dish checks, and the exact wording of code-built text.

    **Location set (opt-in, paid).** `tests/locations.ts` lists 23 cases: London, Charminar, Kanaka Durga, the Scottish Highlands, lesser-known cities (Warangal, Bhuj, Tartu, Evora, Dubuque, Kumasi, Gondar, Cuenca, Salta, Ipoh, Mardin, Ballarat), the open ocean, and Food, Temples, and food-stop cases. Each case builds a real tour, which makes Claude calls and possibly SerpApi calls, so the spec skips unless asked:

    ```sh
    WANDER_LOCATIONS=all npx deepspace test run all --grep "location "
    WANDER_LOCATIONS="Warangal,Gondar" npx deepspace test run all --grep "location "
    ```

    Results (statuses, stops, narration, panel notes) are written as JSON to `.deepspace/locations/` or `$WANDER_LOCATIONS_OUT`. Playwright specs sign in with DeepSpace test accounts (`npx deepspace test accounts list`); the two-user collab spec needs two accounts.

    ## Known limitations

    - English Wikipedia only. Narration uses Wikipedia intros, so it is short where intros are short.
    - Untyped Wikipedia pages (some rivers and events) can still become stops; only about half of places carry a coordinate type.
    - Google Maps results vary between runs, so thin areas can give different tours, or no tour, on different days.
    - Distances and minutes are straight-line estimates; there is no street routing.
    - The food stop is added after trimming and can add a long last leg on spread-out tours.
    - Highlights can include weak picks (a railway station).
    - All AI and Maps calls are billed to the app owner, and any signed-in user can build tours. The Build button is disabled while a tour builds, but there is no server-side rate limit.