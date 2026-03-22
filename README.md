# Express Server

Basic Express server scaffold with common middleware.

## Prerequisites

Install dependencies:

```sh
npm install
```

## Run

Development:

```sh
npm run dev
```

Production:

```sh
npm start
```

## Health check

Open:

`GET http://localhost:3000/health`

## MaxMyPoint hotels proxy

Proxies to `https://service.maxmypoint.com/hotels` with whitelisted query params (same as the site’s API).

`GET http://localhost:3000/api/maxmypoint/hotels`

Example:

```sh
curl -sS -G "http://localhost:3000/api/maxmypoint/hotels" \
  --data-urlencode "search=" \
  --data-urlencode "latlow=12.8519771" \
  --data-urlencode "longlow=80.1401875" \
  --data-urlencode "lathi=13.235158" \
  --data-urlencode "longhi=80.3328982" \
  --data-urlencode "sort=popularity" \
  --data-urlencode "order=" \
  --data-urlencode "offset=0" \
  --data-urlencode "limit=12" \
  --data-urlencode "brand=" \
  --data-urlencode "sub_brands=" \
  --data-urlencode "cats=" \
  --data-urlencode "min_points=" \
  --data-urlencode "max_points=" \
  --data-urlencode "hotel_tags=" \
  --data-urlencode "favorite=0"
```

Optional: set `MAXMYPOINT_USER_AGENT` to override the default browser User-Agent.

**Without lat/long:** you can omit `latlow`, `longlow`, `lathi`, `longhi`. The proxy fills non-location defaults (`search`, `sort`, `offset`, `limit`, etc.) so the upstream API still gets a full query string.

```sh
curl -sS "http://localhost:3000/api/maxmypoint/hotels"
```

Or only override limit:

```sh
curl -sS -G "http://localhost:3000/api/maxmypoint/hotels" --data-urlencode "limit=24"
```

## Seats search proxy

This server exposes a proxy endpoint that forwards your query to:
`https://seats.aero/_api/search_partial`

Request:

`GET http://localhost:3000/api/seats/search`

If you get **403** / Cloudflare HTML, check what your server is using:

`GET http://localhost:3000/api/seats/status`

By default the proxy calls `https://seats.aero/_api/vuerefdata` first (axios path: merges `Set-Cookie`; Puppeteer path: `fetch` in-page before `search_partial`). Disable with `SEATS_VUEREFDATA=false`.

Example:

```sh
curl "http://localhost:3000/api/seats/search?min_seats=1&applicable_cabin=any&additional_days=true&additional_days_num=7&max_fees=40000&disable_live_filtering=false&date=2026-04-16&origins=MAA&destinations=DXB&seamless=true&c=0.11091054224996055"
```

If `seats.aero` blocks server-side requests (Cloudflare “Attention Required”), copy cookies from your browser and send them:

```sh
curl -sS -G -D - "http://localhost:3000/api/seats/search" \
  --data-urlencode "date=2026-04-16" \
  --data-urlencode "origins=MAA" \
  --data-urlencode "destinations=DXB" \
  -H "x-seats-cookie: <paste-cookie-header-string-here>"
```

## Optional: Puppeteer (headless browser cookies)

If you don’t want to paste cookies manually, you can let Chromium load the search page and reuse its cookies for `/_api/search_partial`.

1. `npm install`
1. Download the browser Puppeteer expects (fixes “Could not find Chrome”): `npm run puppeteer:install`  
   - Or use your installed Google Chrome instead: `SEATS_USE_SYSTEM_CHROME=true` (no extra download).
1. Run with Puppeteer enabled: `SEATS_PUPPETEER=true npm run dev`
1. Call `GET /api/seats/search` as usual (same query params). First request may take **30–90s** while the browser loads the page.

Optional env vars:

- `SEATS_PUPPETEER_WAIT_MS` — extra ms after load (default `3000`)
- `SEATS_PUPPETEER_GOTO_TIMEOUT_MS` — navigation timeout (default `90000`)
- `SEATS_PUPPETEER_HEADLESS=false` — show the browser window for debugging
- `SEATS_USE_SYSTEM_CHROME=true` — use the OS Google Chrome instead of Puppeteer’s downloaded Chrome
- `PUPPETEER_EXECUTABLE_PATH` — full path to a Chrome/Chromium binary if you manage browsers yourself
- `SEATS_PUPPETEER_BROWSER_FETCH=false` — old behavior: only collect cookies with Puppeteer, then call the API with Node (often blocked by Cloudflare). Default is **in-page `fetch`** after loading `/search`.

**Note:** Cloudflare may still challenge or block headless automation. If it fails, use `x-seats-cookie` from your real browser or the Partner API.

## Recommended: Seats.aero Partner API

`_api/search_partial` is Cloudflare-protected and may return HTML/403 from a server-side request.

If you have a Seats.aero Pro API key, set:

- `SEATS_PARTNER_AUTH` to your `pro_...` token

When `SEATS_PARTNER_AUTH` is set, the proxy will call the documented Partner API:
`https://seats.aero/partnerapi/search`
with the required header:
`Partner-Authorization: <your-key>`
