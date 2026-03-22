const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");
const { getPuppeteerLaunchOptions } = require("./seatsPuppeteerCookies");

const ROOMS_ORIGIN = "https://rooms.aero";
const FEAPI_SEARCH_URL = `${ROOMS_ORIGIN}/feapi/search`;

/** Matches rooms.aero browser profile (Chrome 144 on macOS) for axios calls without cookies. */
const DEFAULT_ROOMS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function looksLikeCloudflareChallenge(bodyText) {
  const s = String(bodyText || "").slice(0, 4000);
  return (
    /Attention Required!.*Cloudflare/is.test(s) ||
    /cf-browser-verification/is.test(s) ||
    /\bJust a moment\b/i.test(s) ||
    /__cf_chl_/i.test(s)
  );
}

/**
 * Client hints + fetch metadata (same shape as Chrome on rooms.aero). Disable with ROOMS_BROWSER_LIKE_HEADERS=false.
 */
function addBrowserLikeFetchHeaders(headers) {
  if (process.env.ROOMS_BROWSER_LIKE_HEADERS === "false") return;
  headers["sec-ch-ua"] =
    '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"';
  headers["sec-ch-ua-mobile"] = "?0";
  headers["sec-ch-ua-platform"] = '"macOS"';
  headers["sec-fetch-dest"] = "empty";
  headers["sec-fetch-mode"] = "cors";
  headers["sec-fetch-site"] = "same-origin";
  headers.Priority = "u=1, i";
}

/** Merge raw `Cookie` / `Set-Cookie` name=value segments; later strings win on duplicate names. */
function mergeRoomCookieHeaders(...parts) {
  const map = new Map();
  for (const raw of parts) {
    if (!raw || !String(raw).trim()) continue;
    for (const segment of String(raw).split(";")) {
      const p = segment.trim();
      if (!p.includes("=")) continue;
      const eq = p.indexOf("=");
      const name = p.slice(0, eq).trim();
      const value = p.slice(eq + 1).trim();
      if (name) map.set(name, value);
    }
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function cookieHeaderFromAxiosSetCookie(res) {
  const setCookie = res.headers["set-cookie"];
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return arr
    .map((c) => String(c).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * GET search page first to collect Set-Cookie (__cf_bm, etc.). Does not obtain cf_clearance from Node alone.
 */
async function warmUpRoomsSearchSession(searchPageUrl) {
  const userAgent = process.env.ROOMS_USER_AGENT || DEFAULT_ROOMS_USER_AGENT;
  const headers = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language":
      process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-GB,en-US;q=0.9,en;q=0.8",
    "User-Agent": userAgent,
    Origin: ROOMS_ORIGIN,
    Referer: `${ROOMS_ORIGIN}/`
  };
  addBrowserLikeFetchHeaders(headers);

  const res = await axios.get(searchPageUrl, {
    ...upstreamAxiosOptions({ envKey: "ROOMS_AXIOS_TIMEOUT_MS" }),
    responseType: "text",
    transformResponse: [(d) => d],
    validateStatus: () => true,
    maxRedirects: 5,
    headers
  });

  return {
    cookieHeader: cookieHeaderFromAxiosSetCookie(res),
    warmUpStatus: res.status
  };
}

function buildRoomsSearchPageUrl(fields) {
  const params = new URLSearchParams();
  if (fields.city != null && String(fields.city).trim() !== "") {
    params.set("city", String(fields.city));
  }
  params.set("start", String(fields.start));
  params.set("end", String(fields.end));
  params.set("nights", String(fields.nights));
  params.set("lat", String(fields.lat));
  params.set("lng", String(fields.lng));
  return `${ROOMS_ORIGIN}/search?${params.toString()}`;
}

function buildFeapiBody(fields) {
  const lat = Number(fields.lat);
  const lng = Number(fields.lng);
  const num_nights = Number(fields.nights);
  const start = String(fields.start);
  const end = String(fields.end);

  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    const err = new Error("start and end must be YYYY-MM-DD");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const err = new Error("lat and lng must be numbers");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(num_nights) || num_nights < 1) {
    const err = new Error("nights must be a positive number");
    err.statusCode = 400;
    throw err;
  }

  const hasSw =
    fields.southwest_latitude != null &&
    fields.southwest_latitude !== "" &&
    fields.southwest_longitude != null &&
    fields.southwest_longitude !== "" &&
    fields.northeast_latitude != null &&
    fields.northeast_latitude !== "" &&
    fields.northeast_longitude != null &&
    fields.northeast_longitude !== "";

  let southwest_latitude;
  let southwest_longitude;
  let northeast_latitude;
  let northeast_longitude;

  if (hasSw) {
    southwest_latitude = Number(fields.southwest_latitude);
    southwest_longitude = Number(fields.southwest_longitude);
    northeast_latitude = Number(fields.northeast_latitude);
    northeast_longitude = Number(fields.northeast_longitude);
    if (
      ![
        southwest_latitude,
        southwest_longitude,
        northeast_latitude,
        northeast_longitude
      ].every((n) => Number.isFinite(n))
    ) {
      const err = new Error("Invalid bbox: southwest_* and northeast_* must be numbers");
      err.statusCode = 400;
      throw err;
    }
  } else {
    const halfDeg = Number(process.env.ROOMS_BBOX_HALF_DEG);
    const half = Number.isFinite(halfDeg) && halfDeg > 0 ? halfDeg : 0.2;
    southwest_latitude = lat - half;
    northeast_latitude = lat + half;
    southwest_longitude = lng - half;
    northeast_longitude = lng + half;
  }

  return {
    southwest_latitude,
    southwest_longitude,
    northeast_latitude,
    northeast_longitude,
    num_nights,
    date_range_start: `${start}T00:00:00Z`,
    date_range_end: `${end}T00:00:00Z`
  };
}

/**
 * POST rooms.aero/feapi/search via axios (no headless browser).
 * Cloudflare / AWS WAF often require a Cookie header — use ROOMS_COOKIE or X-Rooms-Cookie on the request.
 * @param {string} searchPageUrl — used as Referer
 * @param {object} feapiBody — JSON body for feapi
 * @param {string} [cookieHeader] — raw Cookie header value
 * @returns {Promise<{ status: number, contentType: string, bodyText: string }>}
 */
async function fetchRoomsFeapiViaAxios(searchPageUrl, feapiBody, cookieHeader) {
  const userAgent = process.env.ROOMS_USER_AGENT || DEFAULT_ROOMS_USER_AGENT;

  let mergedCookie = String(cookieHeader || "").trim();
  if (process.env.ROOMS_SKIP_WARMUP_GET !== "true") {
    try {
      const warm = await warmUpRoomsSearchSession(searchPageUrl);
      mergedCookie = mergeRoomCookieHeaders(warm.cookieHeader, mergedCookie);
    } catch {
      /* POST without warm cookies */
    }
  }

  const headers = {
    Accept: "*/*",
    "Accept-Language":
      process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-GB,en-US;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    Origin: ROOMS_ORIGIN,
    Referer: searchPageUrl,
    "User-Agent": userAgent
  };
  addBrowserLikeFetchHeaders(headers);
  if (mergedCookie) {
    headers.Cookie = mergedCookie;
  }

  const axiosRes = await axios.post(FEAPI_SEARCH_URL, feapiBody, {
    ...upstreamAxiosOptions({ envKey: "ROOMS_AXIOS_TIMEOUT_MS" }),
    responseType: "text",
    transformResponse: [(d) => d],
    headers
  });

  const status = axiosRes.status;
  const contentType = axiosRes.headers["content-type"] || "";
  const bodyText = String(axiosRes.data ?? "");

  return { status, contentType, bodyText };
}

function roomsPuppeteerLaunchOptions() {
  const opts = { ...getPuppeteerLaunchOptions() };
  if (process.env.ROOMS_PUPPETEER_HEADLESS != null) {
    opts.headless = process.env.ROOMS_PUPPETEER_HEADLESS !== "false";
  }
  return opts;
}

/**
 * Same feapi POST from inside Chromium (Cloudflare sees a real browser TLS + cookies).
 * Enable with env ROOMS_USE_PUPPETEER=true when axios gets 403 / challenge HTML.
 */
async function fetchRoomsFeapiViaPuppeteer(searchPageUrl, feapiBody) {
  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    throw new Error("puppeteer is not installed. Run: npm run puppeteer:install");
  }

  const waitMs = Number(process.env.ROOMS_PUPPETEER_WAIT_MS || 3000);
  const gotoTimeout = Number(process.env.ROOMS_PUPPETEER_GOTO_TIMEOUT_MS || 90000);
  const userAgent = process.env.ROOMS_USER_AGENT || DEFAULT_ROOMS_USER_AGENT;

  const browser = await puppeteer.launch(roomsPuppeteerLaunchOptions());

  try {
    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setExtraHTTPHeaders({
      "Accept-Language":
        process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-GB,en-US;q=0.9,en;q=0.8",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    });

    await page.goto(searchPageUrl, {
      waitUntil: "networkidle2",
      timeout: gotoTimeout
    });

    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }

    return await page.evaluate(
      async ({ apiUrl, referer, body }) => {
        const r = await fetch(apiUrl, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "*/*",
            Referer: referer
          },
          body: JSON.stringify(body)
        });
        const text = await r.text();
        const contentType = r.headers.get("content-type") || "";
        return {
          status: r.status,
          contentType,
          bodyText: text
        };
      },
      {
        apiUrl: FEAPI_SEARCH_URL,
        referer: searchPageUrl,
        body: feapiBody
      }
    );
  } finally {
    await browser.close();
  }
}

/**
 * @param {Record<string, string>} fields — allowlisted query fields only
 * @param {string} [cookieHeader]
 */
async function runRoomsSearchFromQuery(fields, cookieHeader) {
  const searchPageUrl = buildRoomsSearchPageUrl(fields);
  const feapiBody = buildFeapiBody(fields);
  if (process.env.ROOMS_USE_PUPPETEER === "true") {
    return fetchRoomsFeapiViaPuppeteer(searchPageUrl, feapiBody);
  }

  const axiosResult = await fetchRoomsFeapiViaAxios(
    searchPageUrl,
    feapiBody,
    cookieHeader
  );

  const tryPuppeteerFallback =
    process.env.ROOMS_AUTO_PUPPETEER_ON_CLOUDFLARE === "true";
  if (
    tryPuppeteerFallback &&
    (axiosResult.status === 401 ||
      axiosResult.status === 403 ||
      axiosResult.status === 503) &&
    looksLikeCloudflareChallenge(axiosResult.bodyText)
  ) {
    try {
      return await fetchRoomsFeapiViaPuppeteer(searchPageUrl, feapiBody);
    } catch {
      /* return axios result below */
    }
  }

  return axiosResult;
}

module.exports = {
  buildRoomsSearchPageUrl,
  buildFeapiBody,
  fetchRoomsFeapiViaAxios,
  fetchRoomsFeapiViaPuppeteer,
  runRoomsSearchFromQuery,
  looksLikeCloudflareChallenge,
  addBrowserLikeFetchHeaders,
  DEFAULT_ROOMS_USER_AGENT,
  FEAPI_SEARCH_URL
};
