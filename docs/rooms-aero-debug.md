# rooms.aero — cookie and `feapi/search` debug (no Puppeteer)

Use this once to see **how the real site** sets cookies and calls the API. Automation here is **browser DevTools only**; Node cannot mint `cf_clearance` / WAF tokens without a real browser or TLS-impersonation tooling.

## 1. Capture session in Chrome (Incognito)

1. New **Incognito** window (empty cookies).
2. Open **DevTools** → **Network** → enable **Preserve log**.
3. Navigate to a search URL, for example:

   `https://rooms.aero/search?city=Florida%2C+United+States&start=2026-03-25&end=2026-03-26&nights=1&lat=28.944465&lng=-82.03363`

4. Wait until any “Checking your browser” / “Just a moment” step finishes and the app loads.

### What to record

| Goal | Where |
|------|--------|
| Cookie names for `rooms.aero` | **Application → Cookies → https://rooms.aero** |
| Which response issued each cookie | **Network** → select the response → **Headers → Set-Cookie** |
| The API call | **Network** → filter `feapi` → **`feapi/search`** (method **POST**) |

For **`feapi/search`**:

- Note **Request headers**: `Cookie`, `Referer`, `Origin`, `User-Agent`, `sec-ch-ua*`, `sec-fetch-*`, `Content-Type`.
- Note **Request payload** (JSON): `southwest_latitude`, `southwest_longitude`, `northeast_latitude`, `northeast_longitude`, `num_nights`, `date_range_start`, `date_range_end`.

**Export:** Right-click the `feapi/search` request → **Copy → Copy as cURL** (sanitise before sharing).

### Cookies you will usually see (names only)

Typical names (confirm in your capture):

- **`__cf_bm`** — Cloudflare bot management; often set early.
- **`cf_clearance`** — Cloudflare clearance after challenge; bound to browser / IP / UA.
- **`aws-waf-token`** — AWS WAF; may be set or refreshed after JS runs on the page.
- **`_ga` / `_ga_*`** — Analytics; not required for API logic but may appear on the wire.

## 2. Typical request order

1. Browser requests **`GET /search?...`** through Cloudflare.
2. Cloudflare may issue **`__cf_bm`** and/or an interstitial until **`cf_clearance`** exists.
3. Origin returns HTML + JS; WAF may set or refresh **`aws-waf-token`** via embedded logic or XHR.
4. App **`POST /feapi/search`** same-origin with **cookies + Referer + JSON body**; response is JSON when allowed.

## 3. How this maps to our server code

| Browser behaviour | Our code ([`src/lib/roomsAeroSearch.js`](../src/lib/roomsAeroSearch.js)) |
|-------------------|------------------------------------------------------------------------|
| Search URL query (`city`, `start`, `end`, `nights`, `lat`, `lng`) | [`buildRoomsSearchPageUrl`](../src/lib/roomsAeroSearch.js) |
| `feapi` JSON (bbox + nights + ISO date range) | [`buildFeapiBody`](../src/lib/roomsAeroSearch.js); optional bbox override via `southwest_*` / `northeast_*` query params on `/api/rooms/search` |
| `POST https://rooms.aero/feapi/search` with browser headers | [`fetchRoomsFeapiViaAxios`](../src/lib/roomsAeroSearch.js) — adds `Origin`, `Referer`, `User-Agent`, `sec-ch-ua*`, `sec-fetch-*`, etc. |
| Cookies from a real session | Optional `X-Rooms-Cookie` or `ROOMS_COOKIE` env passed into axios |

**Gap:** Node’s **TLS fingerprint** is not Chrome’s. Cloudflare often returns **403** + challenge HTML even when cookie strings are pasted. That is expected; see route `hint` / `cloudflareBlock` in [`src/routes/rooms.js`](../src/routes/rooms.js). Server-side workarounds that use a real browser are **Puppeteer** paths in the same lib (`ROOMS_USE_PUPPETEER`, `ROOMS_AUTO_PUPPETEER_ON_CLOUDFLARE`).

## 4. One-off Node probe (no browser)

From repo root:

```bash
npm run rooms:probe
# or
node scripts/probe-rooms-cookies.js
# or
ROOMS_PROBE_URL="https://rooms.aero/search?..." node scripts/probe-rooms-cookies.js
```

Logs **HTTP status**, **`Set-Cookie` cookie names only** (not values), and a **short body preview** — shows what axios gets **without** solving challenges.

Example outcome from a datacenter/client IP: **403** HTML, **`Set-Cookie` name `__cf_bm` only**, no `cf_clearance` — i.e. the challenge is not completed in Node.
