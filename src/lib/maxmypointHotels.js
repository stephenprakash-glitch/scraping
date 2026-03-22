const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");
const { jsonFromMaybeTextResponse } = require("./jsonTextResponse");

const HOTELS_API = "https://service.maxmypoint.com/hotels";
const SITE_ORIGIN = "https://maxmypoint.com";

const ALLOWED_KEYS = new Set([
  "search",
  "latlow",
  "longlow",
  "lathi",
  "longhi",
  "sort",
  "order",
  "offset",
  "limit",
  "brand",
  "sub_brands",
  "cats",
  "min_points",
  "max_points",
  "hotel_tags",
  "favorite"
]);

function applyNonBboxDefaults(params) {
  const defaults = {
    search: "",
    sort: "popularity",
    order: "",
    offset: "0",
    limit: "12",
    brand: "",
    sub_brands: "",
    cats: "",
    min_points: "",
    max_points: "",
    hotel_tags: "",
    favorite: "0"
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!params.has(key)) params.set(key, value);
  }
}

function buildHotelsSearchParams(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (value === undefined) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  applyNonBboxDefaults(params);
  return params;
}

/**
 * Proxies MaxMyPoint hotels search; returns result for jsonFromMaybeTextResponse shape.
 */
async function fetchHotelsJson(query) {
  const params = buildHotelsSearchParams(query);
  const url = `${HOTELS_API}?${params.toString()}`;

  const externalRes = await axios.get(url, {
    ...upstreamAxiosOptions({ envKey: "MAXMYPOINT_TIMEOUT_MS" }),
    responseType: "text",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${SITE_ORIGIN}/`,
      Origin: SITE_ORIGIN,
      "User-Agent":
        process.env.MAXMYPOINT_USER_AGENT ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  });

  return jsonFromMaybeTextResponse(externalRes, "MaxMyPoint");
}

module.exports = { fetchHotelsJson, ALLOWED_KEYS };
