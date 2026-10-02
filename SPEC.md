# Wander: AI walking tours of any neighborhood

## Core flow
1. Signed-in user drops a pin on a map (or searches a place name),
   picks length (30/60/90 min) and theme (history, architecture,
   art, surprise me).
2. "Build tour" creates a tour record and starts a background job.
3. Job fetches nearby places from Wikipedia (public API, from the worker).
4. Code filters noise; AI picks 5-8 stops; code orders them into a loop.
5. Stops appear on the map live as the job writes them.
6. AI writes narration per stop using ONLY facts from Wikipedia text.
7. User can save tours, share a public link, export GPX.
8. Audio narration is generated on demand per stop (built last).

## Data model
tours: id, ownerId, title, lat, lng, theme, minutes,
  status (queued | finding | choosing | writing | done | failed | too_few_places),
  errorMessage, isPublic, createdAt
stops: id, tourId, order, pageid, name, lat, lng, narration, transition,
  sourceUrl, audioStatus (none | generating | ready | failed), audioUrl

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
Code: drop any pageid not in the candidate list. Order stops by
  nearest-neighbor loop starting from the pin.
Call 2 narrate: model claude-haiku-4-5, temperature 0.5, max_tokens 2000.
  Return ONLY JSON {"stops":[{"pageid":n,"narration":"...","transition":"..."}]}.
  Facts only from the given extract, 80-120 words, no current
  hours/prices/openings.
Parsing: strip non-JSON text, retry once, else status = failed.

## Too few places
If fewer than 4 valid stops: status = too_few_places. Search again at
10000m only to suggest the nearest area with places; offer to move the pin.
Test case: 57.0, -4.5 (Scottish Highlands) returns zero places.

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
- The map and tour builder replace src/pages/(app)/home.tsx.
- Wander's own theme goes in src/themes.css (later slice).
- Replace the placeholder landing page with a Wander landing page (later slice).

## Rules
- All external API and AI calls happen in the worker, never the browser.
- Use DeepSpace primitives for auth, records, jobs, files. Don't rebuild them.
- No API keys in the app; paid services go through DeepSpace integrations.

## Out of scope
Multiplayer, payments, turn-by-turn navigation, street routing,
OpenStreetMap data, AI images.