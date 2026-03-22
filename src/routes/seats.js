const express = require("express");
const axios = require("axios");
const {
  getCookiesFromPuppeteer,
  fetchSearchPartialViaPuppeteer
} = require("../lib/seatsPuppeteerCookies");

const router = express.Router();

const EXTERNAL_SEARCH_URL = "https://seats.aero/_api/search_partial";
const VUEREFDATA_URL = "https://seats.aero/_api/vuerefdata";
const PARTNER_SEARCH_URL = "https://seats.aero/partnerapi/search";
const EXTERNAL_ORIGIN = "https://seats.aero";

/** Merge multiple `Cookie` header strings; later values win on duplicate names. */
function mergeCookieStrings(...parts) {
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

/** GET /_api/vuerefdata — warm-up; use Set-Cookie for follow-up search_partial. */
async function fetchVuerefdataCookies(userAgent, referer, originHeader) {
  const timeoutMs = 12000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await axios.get(VUEREFDATA_URL, {
      method: "GET",
      signal: controller.signal,
      timeout: timeoutMs,
      maxRedirects: 5,
      responseType: "text",
      validateStatus: () => true,
      headers: {
        "User-Agent": userAgent,
        Accept: "application/json, text/plain, */*",
        "Accept-Language":
          process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-US,en;q=0.9",
        Referer: referer,
        Origin: originHeader
      }
    });
    const setCookie = res.headers["set-cookie"] || [];
    const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
    return arr
      .map((c) => String(c).split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  } catch {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

const USER_AGENT_POOL = [
  // Common desktop browser UAs (rotation helps avoid “static client” blocking).
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0"
];

let seatsCookieCache = {
  cookieHeader: "",
  expiresAtMs: 0,
  userAgent: "",
  pageUrl: ""
};

function pickUserAgent() {
  if (process.env.EXTERNAL_USER_AGENT) return process.env.EXTERNAL_USER_AGENT;
  return USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)];
}

async function fetchSeatsCookies(userAgent, pageUrl) {
  const now = Date.now();
  if (
    seatsCookieCache.cookieHeader &&
    seatsCookieCache.expiresAtMs > now &&
    seatsCookieCache.userAgent === userAgent &&
    seatsCookieCache.pageUrl === pageUrl
  ) {
    return seatsCookieCache.cookieHeader;
  }

  const cookieFetchUrl = pageUrl;

  const controller = new AbortController();
  const timeoutMs = 12000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let setCookiesArr = [];
  try {
    const res = await axios.get(cookieFetchUrl, {
      method: "GET",
      signal: controller.signal,
      timeout: timeoutMs,
      maxRedirects: 5,
      responseType: "text",
      validateStatus: () => true,
      headers: {
        "User-Agent": userAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language":
          process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-US,en;q=0.9",
        Referer: process.env.EXTERNAL_REFERER || EXTERNAL_ORIGIN + "/"
      }
    });

    const setCookie = res.headers["set-cookie"] || [];
    setCookiesArr = Array.isArray(setCookie) ? setCookie : [setCookie];
  } catch {
    setCookiesArr = [];
  } finally {
    clearTimeout(timeoutId);
  }

  // Convert `set-cookie` strings into a `Cookie` header.
  // We only keep the `name=value` part (first segment before `;`).
  const cookieHeader = setCookiesArr
    .map((c) => String(c).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // Cache cookies for a short period to avoid re-fetching each request.
  // If they expire sooner, the next request will re-fetch.
  const ttlMs = 5 * 60 * 1000;
  seatsCookieCache = {
    cookieHeader,
    expiresAtMs: now + ttlMs,
    userAgent,
    pageUrl
  };

  return cookieHeader;
}

// Only forward known keys to avoid turning this into an open proxy.
const ALLOWED_KEYS = new Set([
  "min_seats",
  "applicable_cabin",
  "additional_days",
  "additional_days_num",
  "max_fees",
  "disable_live_filtering",
  "date",
  "origins",
  "destinations",
  "seamless",
  "c"
]);

function cloudflareBlockedHint(bodyText) {
  if (!bodyText || typeof bodyText !== "string") return undefined;
  if (
    bodyText.includes("Cloudflare") ||
    bodyText.includes("Attention Required")
  ) {
    return (
      "Cloudflare is blocking this request. Fix one of: " +
      "(1) Run the server with SEATS_PUPPETEER=true (in-page fetch; see README), " +
      "(2) Pass your browser Cookie in header x-seats-cookie or SEATS_COOKIE in .env, " +
      "(3) Use the official API: SEATS_PARTNER_AUTH=pro_... " +
      "Check GET /api/seats/status to see what is enabled."
    );
  }
  return undefined;
}

function sendExternalApiResult(res, { status, contentType, bodyText }) {
  const preview = bodyText.slice(0, 500);
  const hint = cloudflareBlockedHint(bodyText);

  if (status < 200 || status >= 300) {
    return res.status(status).json({
      error: `External API error: HTTP ${status}`,
      externalContentType: contentType,
      bodyPreview: preview,
      ...(hint ? { hint } : {})
    });
  }

  const looksLikeJson = contentType.toLowerCase().includes("application/json");

  if (!looksLikeJson) {
    return res.status(502).json({
      error: "External API did not return JSON",
      externalContentType: contentType,
      bodyPreview: preview,
      ...(hint ? { hint } : {})
    });
  }

  try {
    const data = JSON.parse(bodyText);
    return res.json(data);
  } catch {
    return res.status(502).json({
      error: "External API returned invalid JSON",
      externalContentType: contentType,
      bodyPreview: preview,
      ...(hint ? { hint } : {})
    });
  }
}

/** See which seats integration is active (debugging 403 / Cloudflare). */
router.get("/status", (req, res) => {
  const puppeteerOn = process.env.SEATS_PUPPETEER === "true";
  const inPageFetch =
    puppeteerOn && process.env.SEATS_PUPPETEER_BROWSER_FETCH !== "false";
  res.json({
    partnerApiConfigured: Boolean(process.env.SEATS_PARTNER_AUTH),
    puppeteerEnabled: puppeteerOn,
    puppeteerInPageFetch: inPageFetch,
    vuerefdataWarmup: process.env.SEATS_VUEREFDATA !== "false",
    cookieSetInEnv: Boolean(process.env.SEATS_COOKIE),
    note:
      inPageFetch
        ? "Puppeteer in-page fetch is ON (good for Cloudflare)."
        : puppeteerOn
          ? "Puppeteer is on but SEATS_PUPPETEER_BROWSER_FETCH=false (cookie+axios path)."
          : "Puppeteer is OFF — /api/seats/search uses axios only; Cloudflare usually returns 403. Run: SEATS_PUPPETEER=true npm run dev"
  });
});

router.get("/search", async (req, res, next) => {
  try {
    const { date, origins, destinations } = req.query;

    if (!date || !origins || !destinations) {
      return res.status(400).json({
        error: "Missing required query params: date, origins, destinations"
      });
    }

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(req.query)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      if (value === undefined) continue;
      params.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }

    const partnerAuth = process.env.SEATS_PARTNER_AUTH || "";
    const usePartnerApi = Boolean(partnerAuth);
    const urlBase = usePartnerApi ? PARTNER_SEARCH_URL : EXTERNAL_SEARCH_URL;
    const url = `${urlBase}?${params.toString()}`;

    const userAgent = req.headers["x-seats-user-agent"]
      ? String(req.headers["x-seats-user-agent"])
      : pickUserAgent();

    const acceptLanguage = req.headers["x-seats-accept-language"]
      ? String(req.headers["x-seats-accept-language"])
      : process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-US,en;q=0.9";

    const referer = req.headers["x-seats-referer"]
      ? String(req.headers["x-seats-referer"])
      : process.env.EXTERNAL_REFERER || EXTERNAL_ORIGIN + "/";

    const originHeader = req.headers["x-seats-origin"]
      ? String(req.headers["x-seats-origin"])
      : process.env.EXTERNAL_ORIGIN_HEADER || EXTERNAL_ORIGIN;

    const controller = new AbortController();
    const timeoutMs = 15000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const providedCookie =
      (req.headers["x-seats-cookie"] && String(req.headers["x-seats-cookie"])) ||
      (process.env.SEATS_COOKIE && String(process.env.SEATS_COOKIE)) ||
      "";

    const seatsPageUrl = `${EXTERNAL_ORIGIN}/search?${params.toString()}`;

    // Puppeteer: load /search then fetch the API inside the page (same-origin fetch).
    // This avoids Cloudflare blocking Node/axios even when cookie strings are copied.
    if (
      !usePartnerApi &&
      process.env.SEATS_PUPPETEER === "true" &&
      !providedCookie &&
      process.env.SEATS_PUPPETEER_BROWSER_FETCH !== "false"
    ) {
      try {
        const result = await fetchSearchPartialViaPuppeteer(
          seatsPageUrl,
          url,
          userAgent,
          process.env.SEATS_VUEREFDATA === "false"
            ? { skipVueref: true }
            : { vuerefUrl: VUEREFDATA_URL }
        );
        return sendExternalApiResult(res, {
          status: result.status,
          contentType: result.contentType,
          bodyText: result.bodyText
        });
      } catch (puppetErr) {
        return res.status(500).json({
          error: "Puppeteer in-page fetch failed",
          details: String(puppetErr && puppetErr.message)
        });
      }
    }

    let cookieHeader = "";
    if (!usePartnerApi) {
      // Same cookie string Postman uses under "Cookie" — pass explicitly (do not rely on
      // browser Cookie header; it would be wrong for localhost).
      if (providedCookie) {
        if (providedCookie.length > 8000) {
          return res.status(400).json({
            error: "Cookie value is too large (max 8000 chars)"
          });
        }
        cookieHeader = providedCookie;
      } else {
        if (
          process.env.SEATS_PUPPETEER === "true" &&
          process.env.SEATS_PUPPETEER_BROWSER_FETCH === "false"
        ) {
          try {
            cookieHeader = await getCookiesFromPuppeteer(
              seatsPageUrl,
              userAgent
            );
          } catch (puppetErr) {
            return res.status(500).json({
              error: "Puppeteer cookie fetch failed",
              details: String(puppetErr && puppetErr.message)
            });
          }
        } else if (process.env.SEATS_FETCH_COOKIES !== "false") {
          cookieHeader = await fetchSeatsCookies(userAgent, seatsPageUrl);
        }
      }
    }

    let cookieForSearch = cookieHeader;
    if (
      !usePartnerApi &&
      process.env.SEATS_VUEREFDATA !== "false" &&
      !providedCookie
    ) {
      const vuCookies = await fetchVuerefdataCookies(
        userAgent,
        referer,
        originHeader
      );
      cookieForSearch = mergeCookieStrings(cookieForSearch, vuCookies);
    }

    try {
      const externalRes = await axios.get(url, {
        method: "GET",
        signal: controller.signal,
        timeout: timeoutMs,
        maxRedirects: 5,
        responseType: "text",
        validateStatus: () => true,
        headers: {
          Accept: "application/json,text/plain,*/*",
          ...(usePartnerApi ? { "Partner-Authorization": partnerAuth } : {}),
          "User-Agent": userAgent,
          ...(usePartnerApi
            ? {}
            : {
                "Accept-Language": acceptLanguage,
                Referer: referer,
                Origin: originHeader,
                ...(cookieForSearch ? { Cookie: cookieForSearch } : {})
              })
        }
      });

      const status = externalRes.status;
      const contentType = externalRes.headers["content-type"] || "";
      const externalData = externalRes.data;
      const bodyText = Buffer.isBuffer(externalData)
        ? externalData.toString("utf8")
        : String(externalData ?? "");

      return sendExternalApiResult(res, { status, contentType, bodyText });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

