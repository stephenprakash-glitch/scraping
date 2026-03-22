const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");
const { fetchPointsYeahIdToken } = require("./pointsYeahCognito");

const POINTSYEAH_LIVE_BASE =
  process.env.POINTSYEAH_LIVE_BASE || "https://api.pointsyeah.com/v2/live";
const POINTSYEAH_ORIGIN =
  process.env.POINTSYEAH_ORIGIN || "https://www.pointsyeah.com";

const DEFAULT_USER_AGENT =
  process.env.POINTSYEAH_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/**
 * @param {Record<string, string>} [reqHeaders] Lowercase keys from Express (optional).
 */
function resolveAuthorization(body, reqHeaders) {
  const fromBody =
    body && typeof body.authorization === "string" ? body.authorization.trim() : "";
  const fromHeader =
    reqHeaders &&
    typeof reqHeaders["x-pointsyeah-authorization"] === "string"
      ? reqHeaders["x-pointsyeah-authorization"].trim()
      : "";
  const fromEnv =
    typeof process.env.POINTSYEAH_AUTHORIZATION === "string"
      ? process.env.POINTSYEAH_AUTHORIZATION.trim()
      : "";
  return fromBody || fromHeader || fromEnv || "";
}

function normalizePath(p) {
  const s = String(p || "").trim();
  if (!s.startsWith("/")) return null;
  return s;
}

function bodyPreview(data, max = 2000) {
  try {
    const t = typeof data === "string" ? data : JSON.stringify(data);
    return String(t).slice(0, max);
  } catch {
    return String(data).slice(0, max);
  }
}

function pointsYeahAxiosHeaders(authorization) {
  const headers = {
    Accept: "*/*",
    "Accept-Language":
      process.env.POINTSYEAH_ACCEPT_LANGUAGE ||
      "en-US,en;q=0.9,zh-CN;q=0.8,zh-TW;q=0.7,zh;q=0.6",
    "Content-Type": "application/json",
    Origin: POINTSYEAH_ORIGIN,
    Referer: `${POINTSYEAH_ORIGIN}/`,
    "User-Agent": DEFAULT_USER_AGENT,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site"
  };
  if (authorization) {
    headers.authorization = authorization;
  }
  return headers;
}

/**
 * Optional GET of the public search page to collect cookies (usually requires login for /search).
 * @param {URLSearchParams} params
 */
async function warmUpSearchPage(params) {
  const qs = params.toString();
  const url = qs
    ? `${POINTSYEAH_ORIGIN}/search?${qs}`
    : `${POINTSYEAH_ORIGIN}/search`;
  const res = await axios.get(url, {
    ...upstreamAxiosOptions({ envKey: "POINTSYEAH_AXIOS_TIMEOUT_MS" }),
    responseType: "text",
    transformResponse: [(d) => d],
    validateStatus: () => true,
    maxRedirects: 5,
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": DEFAULT_USER_AGENT
    }
  });
  const setCookie = res.headers["set-cookie"];
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = arr
    .map((c) => String(c).split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
  return { status: res.status, cookie };
}

/**
 * Map URL-style award search fields (as on pointsyeah.com/search?...) into a plain object
 * for POST JSON. Upstream schema is not public — pass through for APIs that accept these keys.
 */
function flightParamsToJson(input) {
  const fp =
    input && typeof input.flightParams === "object" && input.flightParams !== null
      ? input.flightParams
      : null;
  if (!fp) return null;
  const out = {};
  const keys = [
    "cabins",
    "cabin",
    "banks",
    "airlineProgram",
    "tripType",
    "adults",
    "children",
    "departure",
    "arrival",
    "departDate",
    "departDateSec",
    "multiday",
    "returnDate",
    "departure2",
    "arrival2",
    "departDate2"
  ];
  for (const k of keys) {
    if (fp[k] !== undefined && fp[k] !== null && fp[k] !== "") {
      out[k] = fp[k];
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * POST (or GET) https://api.pointsyeah.com/v2/live{path}
 * @param {object} body
 * @param {Record<string, string>} [reqHeaders]
 */
async function runPointsYeahSearch(body, reqHeaders) {
  const raw = body && typeof body === "object" ? body : {};
  let authorization = resolveAuthorization(raw, reqHeaders);
  if (!authorization) {
    authorization = await fetchPointsYeahIdToken(raw);
  }

  const explicitPath = normalizePath(raw.path);
  const awardPathEnv =
    typeof process.env.POINTSYEAH_AWARD_SEARCH_PATH === "string"
      ? normalizePath(process.env.POINTSYEAH_AWARD_SEARCH_PATH)
      : null;
  const flightJson = flightParamsToJson(raw);

  let path = explicitPath;
  let method = String(raw.method || "POST").toUpperCase();
  let jsonPayload =
    raw.json !== undefined && raw.json !== null ? raw.json : undefined;

  if (!path && flightJson && awardPathEnv) {
    path = awardPathEnv;
    method = "POST";
    jsonPayload = flightJson;
  }

  if (!path) {
    const err = new Error(
      "Missing path: set JSON path (e.g. \"/explorer/search\") or flightParams + POINTSYEAH_AWARD_SEARCH_PATH (from browser Network tab)."
    );
    err.statusCode = 400;
    throw err;
  }

  if (method !== "GET" && method !== "POST") {
    const err = new Error("method must be GET or POST");
    err.statusCode = 400;
    throw err;
  }

  if (method === "POST" && jsonPayload === undefined) {
    jsonPayload = explicitPath ? {} : undefined;
  }
  if (method === "POST" && jsonPayload === undefined) {
    const err = new Error(
      "POST requires json (or flightParams when using POINTSYEAH_AWARD_SEARCH_PATH)"
    );
    err.statusCode = 400;
    throw err;
  }

  let extraCookie = "";
  if (process.env.POINTSYEAH_WARMUP_GET === "true" && flightJson) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(flightJson)) {
      sp.set(k, String(v));
    }
    const w = await warmUpSearchPage(sp);
    extraCookie = w.cookie || "";
  }

  const headers = pointsYeahAxiosHeaders(authorization);
  const envCookie = process.env.POINTSYEAH_COOKIE
    ? String(process.env.POINTSYEAH_COOKIE).trim()
    : "";
  const headerCookie =
    reqHeaders && typeof reqHeaders["x-pointsyeah-cookie"] === "string"
      ? reqHeaders["x-pointsyeah-cookie"].trim()
      : "";
  const mergedCookie = [envCookie, headerCookie, extraCookie]
    .filter(Boolean)
    .join("; ");
  if (mergedCookie) {
    headers.Cookie = mergedCookie;
  }

  const url = `${POINTSYEAH_LIVE_BASE.replace(/\/$/, "")}${path}`;

  const axiosOpts = {
    ...upstreamAxiosOptions({ envKey: "POINTSYEAH_AXIOS_TIMEOUT_MS" }),
    validateStatus: () => true,
    headers,
    url,
    method,
    ...(method === "POST" ? { data: jsonPayload } : {})
  };

  const res = await axios(axiosOpts);
  const status = res.status;
  const data = res.data;

  if (status < 200 || status >= 300) {
    return {
      status,
      payload: {
        error: `PointsYeah API HTTP ${status}`,
        path,
        method,
        upstreamPreview: bodyPreview(data)
      }
    };
  }

  return {
    status,
    payload: data
  };
}

module.exports = {
  runPointsYeahSearch,
  resolveAuthorization,
  pointsYeahAxiosHeaders,
  POINTSYEAH_LIVE_BASE,
  fetchPointsYeahIdToken
};
