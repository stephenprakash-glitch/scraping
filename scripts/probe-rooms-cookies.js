#!/usr/bin/env node
/**
 * One-off: GET rooms.aero search URL with axios; log status, Set-Cookie *names* only, body preview.
 * Does not log cookie values. No Puppeteer.
 *
 * Usage: node scripts/probe-rooms-cookies.js
 *        ROOMS_PROBE_URL="https://rooms.aero/search?..." node scripts/probe-rooms-cookies.js
 */

const axios = require("axios");
const { upstreamAxiosOptions } = require("../src/lib/upstreamAxios");

const DEFAULT_PROBE_URL =
  "https://rooms.aero/search?city=Florida%2C+United+States&start=2026-03-25&end=2026-03-26&nights=1&lat=28.944465&lng=-82.03363";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

/** @param {string|string[]|undefined} setCookie */
function setCookieNames(setCookie) {
  if (setCookie == null) return [];
  const parts = Array.isArray(setCookie) ? setCookie : [setCookie];
  return parts.map((raw) => {
    const first = String(raw).split(";")[0].trim();
    const eq = first.indexOf("=");
    return eq > 0 ? first.slice(0, eq) : first;
  });
}

async function main() {
  const url = process.env.ROOMS_PROBE_URL || DEFAULT_PROBE_URL;
  const userAgent = process.env.ROOMS_USER_AGENT || DEFAULT_UA;

  const res = await axios.get(url, {
    ...upstreamAxiosOptions({ envKey: "ROOMS_AXIOS_TIMEOUT_MS" }),
    responseType: "text",
    transformResponse: [(d) => d],
    validateStatus: () => true,
    maxRedirects: 5,
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
      "User-Agent": userAgent
    }
  });

  const names = setCookieNames(res.headers["set-cookie"]);
  const body = String(res.data ?? "");
  const preview = body.slice(0, 200).replace(/\s+/g, " ");

  console.log("rooms.aero probe (axios GET, no cookies sent)");
  console.log("url:", url);
  console.log("status:", res.status);
  console.log("set-cookie names:", names.length ? names.join(", ") : "(none)");
  console.log("content-type:", res.headers["content-type"] || "(missing)");
  console.log("body preview:", preview);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
