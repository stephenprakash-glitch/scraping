const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");
const { jsonFromMaybeTextResponse } = require("./jsonTextResponse");

const HOTELS_API = "https://service.maxmypoint.com/hotels";
const HOTEL_BY_ID_API = "https://service.maxmypoint.com/hotel-by-id";
const HOTEL_REWARDS_AVAIL_API =
  "https://service.maxmypoint.com/hotel-rewards-avail";
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

function maxMyPointHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${SITE_ORIGIN}/`,
    Origin: SITE_ORIGIN,
    "User-Agent":
      process.env.MAXMYPOINT_USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  };
}

function resolveMonthOrThrow(dateStr) {
  if (dateStr === undefined || dateStr === null || dateStr === "") {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  }
  const s = String(dateStr);
  if (!/^\d{4}-\d{2}$/.test(s)) {
    const err = new Error('Invalid "date" format. Expected YYYY-MM.');
    err.statusCode = 400;
    throw err;
  }
  return s;
}

async function fetchHotelByIdJson(hotelId) {
  const safeId = encodeURIComponent(String(hotelId));
  const url = `${HOTEL_BY_ID_API}/${safeId}`;

  const externalRes = await axios.get(url, {
    ...upstreamAxiosOptions({ envKey: "MAXMYPOINT_TIMEOUT_MS" }),
    responseType: "text",
    headers: maxMyPointHeaders()
  });

  return jsonFromMaybeTextResponse(externalRes, "MaxMyPoint");
}

async function fetchHotelCalendarJson(hotelId, yyyyMm, nights = 1) {
  const month = resolveMonthOrThrow(yyyyMm);
  const params = new URLSearchParams({
    id: String(hotelId),
    nights: String(nights)
  });
  const url = `${HOTEL_REWARDS_AVAIL_API}?${params.toString()}`;

  const externalRes = await axios.get(url, {
    ...upstreamAxiosOptions({ envKey: "MAXMYPOINT_TIMEOUT_MS" }),
    responseType: "text",
    headers: maxMyPointHeaders()
  });

  const parsed = jsonFromMaybeTextResponse(externalRes, "MaxMyPoint");
  if (!parsed.ok) return parsed;

  const hra = Array.isArray(parsed.body?.hra) ? parsed.body.hra : [];
  const monthPrefix = `${month}-`;
  const filtered = hra.filter(
    (row) => row && typeof row.avail_date === "string" && row.avail_date.startsWith(monthPrefix)
  );

  return {
    ok: true,
    status: parsed.status,
    body: {
      hotelId: String(hotelId),
      dateMonth: month,
      nights: Number(nights),
      hra: filtered
    }
  };
}

module.exports = {
  fetchHotelsJson,
  fetchHotelByIdJson,
  fetchHotelCalendarJson,
  resolveMonthOrThrow,
  ALLOWED_KEYS
};
