const express = require("express");
const {
  runRoomsSearchFromQuery,
  looksLikeCloudflareChallenge
} = require("../lib/roomsAeroSearch");
const { scrapeRoomsSearchPage } = require("../lib/roomsAeroScrape");

const router = express.Router();

const CLOUDFLARE_HINT =
  "Cloudflare is blocking axios from Node (TLS / bot checks). Fix: (A) Set ROOMS_USE_PUPPETEER=true so every request uses Chrome, or ROOMS_AUTO_PUPPETEER_ON_CLOUDFLARE=true to retry with Chrome only after a 403. Run npm run puppeteer:install (or system Chrome + PUPPETEER_EXECUTABLE_PATH). (B) Real cookies in X-Rooms-Cookie often still fail from Node; browser path avoids that.";

function attachCloudflareHint(payload, bodyText) {
  if (looksLikeCloudflareChallenge(bodyText)) {
    payload.cloudflareBlock = true;
    payload.hint = CLOUDFLARE_HINT;
  }
}

const ALLOWED_KEYS = new Set([
  "city",
  "start",
  "end",
  "nights",
  "lat",
  "lng",
  "southwest_latitude",
  "southwest_longitude",
  "northeast_latitude",
  "northeast_longitude"
]);

const REQUIRED_KEYS = ["start", "end", "nights", "lat", "lng"];

function pickAllowlistedQuery(query) {
  const fields = {};
  for (const key of ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) continue;
    const v = query[key];
    if (v === undefined) continue;
    fields[key] = Array.isArray(v) ? v.join(",") : String(v);
  }
  return fields;
}

function rejectUnknownQueryKeys(query) {
  const bad = Object.keys(query || {}).filter((k) => !ALLOWED_KEYS.has(k));
  if (bad.length) {
    const err = new Error(`Unknown query keys: ${bad.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
}

function assertRequired(fields) {
  for (const key of REQUIRED_KEYS) {
    if (fields[key] == null || String(fields[key]).trim() === "") {
      const err = new Error(`Missing required query parameter: ${key}`);
      err.statusCode = 400;
      throw err;
    }
  }
}

/**
 * GET /api/rooms/search
 * Query: start, end (YYYY-MM-DD), nights, lat, lng; optional city; optional bbox corners.
 * Direct axios POST to https://rooms.aero/feapi/search unless ROOMS_USE_PUPPETEER=true (then uses Chrome).
 * Before POST, axios does a GET of the same search URL and merges Set-Cookie into the feapi request (disable: ROOMS_SKIP_WARMUP_GET=true).
 * Optional cookies: X-Rooms-Cookie or ROOMS_COOKIE (merged after warm-up; client values override same cookie names).
 */
router.get("/search", async (req, res, next) => {
  try {
    rejectUnknownQueryKeys(req.query);
    const fields = pickAllowlistedQuery(req.query);
    assertRequired(fields);

    const cookieHeader =
      String(req.get("x-rooms-cookie") || "").trim() ||
      String(process.env.ROOMS_COOKIE || "").trim();
    const hadCookie = Boolean(cookieHeader);

    const { status, contentType, bodyText } = await runRoomsSearchFromQuery(
      fields,
      cookieHeader
    );

    if (status < 200 || status >= 300) {
      const payload = {
        error: `rooms.aero feapi error: HTTP ${status}`,
        externalContentType: contentType,
        bodyPreview: bodyText.slice(0, 500)
      };
      attachCloudflareHint(payload, bodyText);
      if (!payload.hint && (status === 401 || status === 403) && !hadCookie) {
        payload.hint =
          "Try ROOMS_COOKIE or X-Rooms-Cookie with cookies from rooms.aero (cf_clearance, aws-waf-token, __cf_bm). If you already send cookies and still see Cloudflare HTML, see hint when cloudflareBlock is true or use ROOMS_USE_PUPPETEER=true.";
      }
      return res.status(502).json(payload);
    }

    const looksJson = contentType.toLowerCase().includes("application/json");
    if (!looksJson) {
      const payload = {
        error: "rooms.aero feapi did not return JSON",
        externalContentType: contentType,
        bodyPreview: bodyText.slice(0, 500)
      };
      attachCloudflareHint(payload, bodyText);
      return res.status(502).json(payload);
    }

    try {
      return res.json(JSON.parse(bodyText));
    } catch {
      return res.status(502).json({
        error: "rooms.aero feapi returned invalid JSON",
        externalContentType: contentType,
        bodyPreview: bodyText.slice(0, 500)
      });
    }
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/rooms/scrape
 * Fetches the public search page HTML and parses static fields with Cheerio (title, meta, headings, links).
 * Listing data is usually injected by JS after load; Cloudflare often returns challenge HTML to Node (see cloudflareBlock).
 */
router.get("/scrape", async (req, res, next) => {
  try {
    rejectUnknownQueryKeys(req.query);
    const fields = pickAllowlistedQuery(req.query);
    assertRequired(fields);

    const cookieHeader =
      String(req.get("x-rooms-cookie") || "").trim() ||
      String(process.env.ROOMS_COOKIE || "").trim();

    const result = await scrapeRoomsSearchPage(fields, cookieHeader);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
