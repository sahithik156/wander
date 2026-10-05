# Wander: AI-planned tours of any neighborhood

Wander plans tours, not only walking tours: people walk, drive, or take an
auto between sights. The tour is planned and timed for walking, and the app
says when stops are better reached by car or auto.

## Product wording
- Builder heading: "Plan a tour".
- Route length: "[X] km route".
- Placeholder title while a tour builds: "[Theme] tour · [minutes] min";
  code-made titles: "[Theme] tour near [first stop]".
- Transitions say "Head", with minutes marked "on foot" (see "Transitions").

## Core flow
1. Signed-in user drops a pin on a map (or searches a place name),
   picks length (30/60/90 min) and theme (see "Themes"), and may tick
   "Include a food stop".
2. "Build tour" creates a tour record and starts a background job.
3. Job fetches nearby places from Wikipedia (public API, from the worker).
4. Code filters noise; AI picks 5-8 stops; code orders them one way from
   the pin (no walk back) and trims them to the time budget.
5. Stops appear on the map live as the job writes them.
6. AI writes narration per stop using ONLY facts from Wikipedia text.
7. User can save tours, share a public link, export GPX.
8. Audio narration is generated on demand per stop (built last).

## Data model
tours: id, ownerId, title, lat, lng, theme, minutes, includeFood,
  status (queued | finding | choosing | writing | done | failed | too_few_places),
  errorMessage, isPublic, createdAt,
  dishes (JSON [{name, note}]), cuisineTitle, cuisineUrl (Food theme)
stops: id, tourId, order, pageid, name, lat, lng, narration, transition,
  sourceUrl, audioStatus (none | generating | ready | failed), audioUrl,
  source (wikipedia | maps), externalId, category, role (sight | food),
  rating, reviews, price

## Permissions
- Owner can read and write their tours and stops.
- Anyone can read a tour and its stops if isPublic is true.
- Nobody else can write.

## Data source: Wikipedia public API (called from the worker)
- Geosearch: action=query&list=geosearch, radius 800m (30 min),
  1500m (60), 2200m (90), gslimit up to 150.
- Text: action=query&prop=extracts|coordinates&exintro&explaintext,
  batches of 20 pageids.
- Send a User-Agent header identifying the app.
- We checked the platform wikipedia integration: it has no geosearch,
  so we call Wikipedia directly.

## Filtering before AI (plain code)
Drop titles containing: "constituency", "(UK Parliament", " road",
"Built-up Area", and pages that are just a town or district name.
Keep at most one railway station and one school.

## Anthropic calls (worker only, model ALWAYS set explicitly)
The integration defaults to an expensive model, so always pass model.
Call 1 select: model claude-haiku-4-5, temperature 0, max_tokens 1000.
  Return ONLY JSON {"stops":[{"pageid":n,"reason":"..."}]}, 5-8 stops,
  skip crimes/tragedies unless theme is history (then respectful).
Code: drop any id not in the candidate list. Order stops by
  nearest-neighbor, one way, starting from the pin (no return leg).
Call 2 narrate: model claude-haiku-4-5, temperature 0.5, max_tokens 2000.
  Return ONLY JSON {"stops":[{"pageid":n,"narration":"...","transition":"..."}]}.
  Facts only from the given extract, 80-120 words, no current
  hours/prices/openings.
Parsing: strip non-JSON text, retry once, else status = failed.

## Too few places
If fewer than 3 valid stops: status = too_few_places (trimming never goes
below 3). Search again at
10000m only to suggest the nearest area with places; offer to move the pin.
Test case: 57.0, -4.5 (Scottish Highlands) returns zero places.

## Time budget and spread-out tours
- Route length runs from the first stop to the last (straight lines). The
  walk from the pin to the first stop is not counted; if it is over 300 m the
  panel says "Starts [distance] from your pin at [first stop]".
- Budget: tour minutes minus time at stops (3 min per stop; 10 min per food
  stop), walked at 4.5 km/h, divided by 1.3 because streets are longer than
  straight lines. Code drops stops until the route fits, never below 3.
- If the route is still over budget at the minimum, keep the tour (never
  refuse it) and show "Spread out: [km], best by car or auto". People often
  drive or take an auto between sights.

## Maps stop text (written by code, not AI)
- If Google Maps gave a description: the narration is the description only
  (its longest sentence; Google often repeats a short summary first).
- Otherwise: "A [category] in [area]", where area is the last two parts of
  the address after removing plus codes, UK postcodes (e.g. WC2E 9AR), the
  country, and the state/postcode,
  e.g. "A Hindu temple in Islampet, Vijayawada." The category starts
  lowercase unless it begins with a proper adjective: a religion, a
  nationality, or a regional cuisine (Hindu, Catholic, Italian, Sri Lankan,
  Hyderabadi, ...), or a direction before one ("a South Indian restaurant",
  "a Middle Eastern restaurant").
- No other claims: no history, dates, popularity, or adjectives.

## Transitions (written by code, not AI)
- "Head [compass direction] about [distance] ([minutes] min on foot) to
  [next stop]." e.g. "Head southeast about 2.2 km (38 min on foot) to
  Gandhi Hill."
- Distance is straight-line, rounded (10 m under 100 m, 50 m under 1 km,
  then 0.1 km). Minutes use the time budget's pace and street factor:
  straight meters x 1.3 at 4.5 km/h, at least 1.
- Last stop: "The tour ends here."

## Narration cleanup (code, after the AI returns)
- Remove every sentence of a Wikipedia stop's narration that contains
  legacy, significance, significant, iconic, testament, remarkable, shaped,
  or renowned, unless that word also appears in the stop's source extract.
  Whole words only. Example removed: "Bazalgette's engineering legacy shaped
  modern London."

## Themes
Each theme has its own Wikipedia selection guidance (given to the AI) and
its own Google Maps query (used when Wikipedia is thin). Maps queries are
plain phrases, never comma lists: Google can read a comma list as the name
of one place and return only that place. Each query was checked live to
return a list of places.

| Theme | Wikipedia guidance | Maps query |
|---|---|---|
| History | historic buildings, monuments, memorials, ruins, forts, sites where notable things happened | historical landmarks and monuments |
| Architecture | notable buildings, bridges, structures, and how they were designed and built | historic buildings |
| Art & museums | museums, galleries, public sculpture, murals, theatres, places tied to artists | museums and art galleries |
| Temples & sacred places | temples, churches, mosques, gurdwaras, synagogues, shrines, monasteries, places of pilgrimage | temples and places of worship |
| Nature & parks | parks, gardens, lakes, rivers, hills, viewpoints, nature reserves (keeps lake/river pages that the noise filter drops for other themes) | parks and gardens |
| Food | see "Food theme" | restaurants and street food (meals); sweet shops (extra search) |
| Highlights | the most notable and interesting places of any kind | top tourist attractions |

"Highlights" replaces "Surprise me"; old tours stored as "surprise me" are
read as Highlights.

## Food theme
- Places to eat (the stops): a serpapi/places-search call near the pin for
  meals ("restaurants and street food"). If fewer than 3 good meal places
  qualify, one more call for "sweet shops", so one sweet shop can still be
  the variety pick (at most 2 calls). The food/shop filter used by other
  themes is NOT
  applied; instead keep places whose Google type is a place to eat
  (restaurant, street food, sweets, bakery, cafe, ...) and drop suppliers,
  caterers, and grocery shops. Keep places inside the radius with rating
  >= 4.0 and >= 20 reviews (>= 5 if fewer than 3 qualify), ranked by a
  rating score that trusts many reviews over a few. Code picks the stops
  (no AI): 3 / 4 / 5 for 30 / 60 / 90 min. Variety: at most one sweet or
  dessert place per tour (sweets shop, candy store, bakery, chocolate, ice
  cream, gelato, waffles, pastry, ...), judged by its Google type OR its name
  (a "Cafe" called "May's Sweet Bite" counts), so there are real meals. One
  branch per chain ("Amorino Gelato - Covent Garden" and "Amorino Gelato
  (Soho)" are the same chain); the best-rated branch is kept.
  Stops show rating, review count, category, and price band.
- Local dishes to try: find the regional cuisine article on Wikipedia from
  the city, state, and country in the Maps addresses (search "[city]
  cuisine", then "[state] cuisine", accepting only a "cuisine" title that
  shares the place name, e.g. "Hyderabadi cuisine"; then "[country]
  cuisine", taking the top cuisine title, e.g. "British cuisine"). The AI
  picks 3 to 5 signature dishes using ONLY that article's text (temperature
  0). Exact-match check in code: a dish is kept only if its name appears word
  for word in the article. Each dish's note is chosen by code, not the AI:
  a full sentence of the article that contains the dish name, preferring
  one that starts with the name. Section headings, bare labels, and list
  entries ("Name - description") do not count, and a sentence already used
  for another dish is not reused. Spacing and unbalanced quote marks from
  Wikipedia markup are tidied. If there is no such sentence, show the dish
  with no note. Show them in a "From the local kitchen" section (labelled
  "Local dishes to try"), each linked to the article, with the source line.
  No article found: skip the section.
- Honesty: never claim a restaurant serves a dish unless the Maps data says
  so. Dishes and places are shown separately and never linked.

## Include a food stop
- Option for every theme except Food; off by default.
- After the tour is ordered and trimmed, one serpapi/places-search call for
  meals ("restaurants and street food") around the last stop. Pick the
  best-rated place to eat (same rating rules), preferring a meal over a
  sweets shop, from the first of these that has one: within 600 m of the
  last stop, within 600 m of the middle stop, up to 1.5 km of the last stop.
  A tour with the "Spread out" note starts at 1.5 km. Add it as the final
  stop.
- Never fail silently: if no place qualifies (or the search fails), the tour
  is built without it and the panel shows "No well-rated place to eat found
  near the end of this tour."

## Place search
openweathermap/geocoding integration turns a typed place name into coordinates.

## Audio (optional layer, build LAST)
- Tour job writes text only; "done" never depends on audio.
- "Listen": if audioStatus is ready, play audioUrl. Otherwise set
  generating, call elevenlabs/generate-speech in the worker with
  model_id eleven_flash_v2_5 and output_format mp3_44100_64, decode
  the returned data URL, save the mp3 to file storage, store the file
  link, set ready.
- If audioStatus is generating, wait; never generate twice.
- On failure: audioStatus failed, show retry; text stays visible.
- Never store the data URL itself in a record.

## Map
MapLibre GL with free OpenFreeMap tiles (no API key).

## Where things go
- The map and tour builder: src/pages/(app)/home.tsx, with presentational
  pieces in src/components/tour/ (BottomSheet, ThemeChips, StopTimeline,
  LocalDishes) and the map in src/components/map/TourMap.tsx.
- Wander's theme: src/themes.css (`wander`, `wander-night`), registered in
  src/themes.ts; `wander` is the default in index.html, which also applies a
  saved Dark choice. The Light/Dark switch is
  src/components/AppearanceSetting.tsx, on the Settings page.
- Landing page: src/pages/index.tsx (static: no auth, no realtime).

## Visual design ("printed city guide + metro map")
- Feel: the tour panel reads like a page from a printed city guide; the
  route on the map looks like a transit line.
- Avoid (they read as AI-generated): dark as the default, pill chips,
  uppercase letter-spaced mono labels, terracotta/salmon/purple accents,
  gradients, blur, soft drop shadows, emoji, a centered hero with three
  feature cards, and the fonts Inter, Roboto, system-ui, Geist, Poppins,
  Space Grotesk, Fraunces, Instrument Serif, Young Serif, Martian Mono.
- Theme `wander` is always the default (light): paper #F4F1EA background,
  ink #111111 for text, 1px borders, and the primary button; rule = ink at
  15% for hairline dividers; muted text #5F5A52. Cobalt #1F4FFF is used
  only for the route and the metro line; tomato #E5402A only for food
  stops and the food section (fills, markers, rules). Tomato fails AA as
  small text, so food text stays in ink. Selected length and theme are
  filled ink with paper text, never cobalt.
- Dark (`wander-night`): background #121210, text #F4F1EA, cobalt and
  tomato brightened. Used only when the user picks Dark in Settings
  ("Appearance"); saved in the browser and applied before first paint by
  index.html. It never follows the device setting.
- All text meets WCAG AA in both themes.
- Type (two families, self-hosted @fontsource): Gloock for tour titles,
  page headings, and dish names (tour title about 40-44px on desktop);
  Familjen Grotesk for everything else, with tabular numerals for
  distances, minutes, ratings, and coordinates. Labels in sentence case,
  regular weight, no letter-spacing.
- Shapes: 2px corners on everything, 1px ink borders, no shadows except a
  subtle one on the mobile bottom sheet.
- Map: OpenFreeMap "positron" (light) and "dark" (dark theme). The route
  is a solid cobalt line; the leg into a food stop is tomato. Stops are
  station circles (thick ink edge, number; food stations tomato). The pin
  is a thin crosshair. When a tour finishes, the route draws in once along
  its length (skipped with prefers-reduced-motion).
- /home layout: desktop has a full-height left sidebar with "Plan" and
  "Tour" tabs (simple underlined text); it switches to Tour when a build
  starts and back to Plan when a pin is dropped. On a phone the sidebar is
  a bottom sheet with a grab handle and two heights (peek: Build button or
  tour title and status; expanded: everything).
- Plan view: length as a square segmented control, themes as square
  options, the food stop checkbox, and a solid ink "Build tour" button.
- Tour view: a dateline above the title ("[place] · 60 min · History";
  the place is the pin's coordinates, since stops carry no city), the
  Gloock title, a hairline rule, the summary line, and summary notes
  ("Spread out", "Starts X from your pin") as plain text. Stops run down a
  cobalt metro line with station markers; each has the name, a plain meta
  line (source, rating, distance from the pin), the narration, the source
  link, and the "Head ..." transition beside the line. "Limited info" is a
  small muted text label.
- Food: "Eat like a local" as a menu card: thin tomato rule above, each
  dish name in Gloock with a dotted leader, the note beneath, and a small
  source line at the bottom.
- Landing: left-aligned city-guide page with the pitch "Tours of any
  neighborhood, built from real sources", the three steps as stations on a
  cobalt metro line, and a "Plan a tour" ink button.
- Accessibility: visible keyboard focus, prefers-reduced-motion respected,
  long names wrap, placeholder lines while narration is written.

## Rules
- All external API and AI calls happen in the worker, never the browser.
- Use DeepSpace primitives for auth, records, jobs, files. Don't rebuild them.
- No API keys in the app; paid services go through DeepSpace integrations.

## Out of scope
Multiplayer, payments, turn-by-turn navigation, street routing,
OpenStreetMap data, AI images.