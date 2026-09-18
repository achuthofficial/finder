# Finder

Map the local businesses around any point on Earth and instantly see **which ones have no website of their own**.

Point it at a neighbourhood — anywhere, from Lisbon to Lagos to Nairobi — and it pulls every mapped business in that radius, works out each one's web presence, and colours the map by it:

| | Meaning |
| --- | --- |
| 🔴 **No website** | Nothing on record. The clearest opportunity. |
| 🟠 **Social only** | A Facebook/Instagram page is doing the job of a website. |
| 🟢 **Has a website** | Already covered. |

It works **globally with no API key**, because it runs on OpenStreetMap data.

## What it does

- **Search anywhere** — type any town, district or street, or hit the location button. Geocoding is worldwide.
- **Pan and re-query** — drag the map and press *Search this area*.
- **Filter** — by category (food, shops, trades, health, …) and by web presence. Filtering is instant, because it happens on data already fetched.
- **Rank by lead quality** — a business with no website *and* a phone number is worth more than one you cannot contact. See [Lead score](#lead-score).
- **Export** — download the filtered list as CSV for a CRM or a spreadsheet.
- **Share** — the URL always carries the current area, so a link reopens the same search.

## How a "no website" flag is decided

More carefully than just checking whether a `website` field exists:

- `website`, `contact:website`, `url`, `operator:website` and friends are all considered, and a bare domain (`padaria.pt`) is treated as a website.
- **A social link in the website field is not a website.** `website=https://facebook.com/…` is extremely common in map data; Finder recognises ~17 social hosts and files those businesses under *social only* instead. They are usually the best leads of all — they clearly want to be found online and have settled for a rented page.
- Handles are expanded, so `contact:instagram=@barbearia.lx` resolves to a real profile URL.
- Values that are not URLs at all (`n/a`, `none`) count as no website.
- Chain outlets (anything with a `brand`) are pushed down the ranking — a franchise is not a lead.

### Lead score

Each business gets a 0–100 score that answers *"how worth contacting is this?"*, not *"how good is this business?"*:

| Signal | Weight |
| --- | --- |
| No website at all | +55 |
| Social profile only | +42 |
| Already has a website | +5 |
| Reachable by phone | +18 |
| Email on record (and no site) | +6 |
| Has a street address | +8 |
| Has opening hours | +7 |
| Is a chain outlet | −30 |

## Data sources

**OpenStreetMap (default, no key).** Business records come from the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) and place search from [Nominatim](https://nominatim.org/). Both are free and cover the whole planet. Finder is a polite citizen of that infrastructure: it identifies itself in the `User-Agent`, caches responses in-process, rate-limits per client, and fails over between mirrors.

**Google Places (optional).** Set `GOOGLE_MAPS_API_KEY` and a second source appears in the header. It uses Places API (New) Nearby Search. Coverage of small businesses is often better; note that Nearby Search is **billed per request**, and Google's terms restrict caching place data, so Finder holds it in memory only and never persists it.

### An important caveat

A business flagged "no website" means **nobody has recorded one** — not that none exists. OpenStreetMap is volunteer-maintained and its contact tags are patchy in places. Every result links out to a Google search and to its source record so you can confirm before you act on it. Treat the list as a shortlist to verify, not a verified list.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

No configuration needed. Copy `.env.example` to `.env.local` only if you want the optional Google source.

```bash
npm test             # unit + provider tests
npm run typecheck
npm run build
```

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/achuthofficial/finder)

It is a stock Next.js App Router project, so Vercel needs no configuration: import the repository and deploy. Every pull request gets its own preview URL automatically.

Optional environment variables (Project → Settings → Environment Variables):

| Variable | Purpose |
| --- | --- |
| `GOOGLE_MAPS_API_KEY` | Enables the Google Places source. |
| `OSM_CONTACT` | Your email or URL, sent in the `User-Agent` to OSM services. Set this before any heavy use. |
| `OVERPASS_ENDPOINTS` | Comma-separated Overpass mirrors, tried in order. |

## API

The UI is a client of a small public API.

### `GET /api/search`

| Param | Default | Notes |
| --- | --- | --- |
| `lat`, `lon` | required | Centre of the search. |
| `radius` | `1500` | Metres, clamped to 200–15000. |
| `groups` | all | Comma-separated category groups (`food`, `retail`, `beauty`, `health`, `services`, `trades`, `professional`, `auto`, `lodging`, `leisure`). |
| `source` | `osm` | `osm` or `google`. |

```bash
curl "localhost:3000/api/search?lat=38.7223&lon=-9.1393&radius=800&groups=food"
```

Returns `{ businesses, stats, center, radius, source, truncated, elapsedMs }`, where each business carries `presence` (`none` / `social-only` / `site`), `leadScore`, contact details and a `sourceUrl` back to the original record.

### `GET /api/geocode?q=` and `GET /api/reverse?lat=&lon=`

Worldwide place search and reverse lookup, returning a suggested search radius derived from each result's extent.

## Project layout

```
app/            Next.js App Router pages and API routes
components/     Finder (state + layout), MapView (Leaflet), ResultCard
lib/            Providers (osm, google, geocode) and pure logic (normalize, categories, csv, geo)
tests/          Node test-runner suites for the scoring, query and provider layers
```

The rule the code follows: `lib/normalize.ts` owns every judgement about what a business is and how good a lead it is, and both providers funnel through it, so OSM and Google results are always scored identically.

## Attribution

Business and place data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Base map tiles © [CARTO](https://carto.com/attributions).
