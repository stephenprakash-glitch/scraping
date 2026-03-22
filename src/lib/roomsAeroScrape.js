const cheerio = require("cheerio");
const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");
const {
  buildRoomsSearchPageUrl,
  looksLikeCloudflareChallenge,
  addBrowserLikeFetchHeaders,
  DEFAULT_ROOMS_USER_AGENT
} = require("./roomsAeroSearch");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateScrapeFields(fields) {
  const need = ["start", "end", "nights", "lat", "lng"];
  for (const k of need) {
    if (fields[k] == null || String(fields[k]).trim() === "") {
      const err = new Error(`Missing required field: ${k}`);
      err.statusCode = 400;
      throw err;
    }
  }
  if (!DATE_RE.test(String(fields.start)) || !DATE_RE.test(String(fields.end))) {
    const err = new Error("start and end must be YYYY-MM-DD");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(Number(fields.lat)) || !Number.isFinite(Number(fields.lng))) {
    const err = new Error("lat and lng must be numbers");
    err.statusCode = 400;
    throw err;
  }
  const n = Number(fields.nights);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error("nights must be a number >= 0");
    err.statusCode = 400;
    throw err;
  }
}

/**
 * GET the public search HTML and parse static structure with Cheerio.
 * Hotel/result rows are usually client-rendered; expect Cloudflare challenge HTML from Node without cookies.
 *
 * @param {Record<string, string>} fields — city optional; start, end, nights, lat, lng required
 * @param {string} [cookieHeader]
 */
async function scrapeRoomsSearchPage(fields, cookieHeader) {
  validateScrapeFields(fields);
  const fetchedUrl = buildRoomsSearchPageUrl(fields);
  const userAgent = process.env.ROOMS_USER_AGENT || DEFAULT_ROOMS_USER_AGENT;

  const headers = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language":
      process.env.EXTERNAL_ACCEPT_LANGUAGE || "en-GB,en-US;q=0.9,en;q=0.8",
    "User-Agent": userAgent,
    Origin: "https://rooms.aero",
    Referer: "https://rooms.aero/"
  };
  addBrowserLikeFetchHeaders(headers);
  if (cookieHeader && String(cookieHeader).trim()) {
    headers.Cookie = String(cookieHeader).trim();
  }

  const res = await axios.get(fetchedUrl, {
    ...upstreamAxiosOptions({ envKey: "ROOMS_AXIOS_TIMEOUT_MS" }),
    responseType: "text",
    transformResponse: [(d) => d],
    validateStatus: () => true,
    maxRedirects: 5,
    headers
  });

  const httpStatus = res.status;
  const contentType = res.headers["content-type"] || "";
  const html = String(res.data ?? "");
  const cloudflareBlock = looksLikeCloudflareChallenge(html);

  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;

  const headings = [];
  $("h1, h2").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && headings.length < 15) headings.push(t);
  });

  const links = [];
  $("a[href]").each((_, el) => {
    if (links.length >= 40) return false;
    const href = $(el).attr("href") || "";
    const text = $(el).text().replace(/\s+/g, " ").trim().slice(0, 120);
    if (href) links.push({ href, text: text || null });
    return undefined;
  });

  const scriptSrcs = [];
  $("script[src]").each((_, el) => {
    const s = $(el).attr("src");
    if (s && scriptSrcs.length < 25) scriptSrcs.push(s);
  });

  return {
    fetchedUrl,
    httpStatus,
    contentType,
    cloudflareBlock,
    parsed: {
      title: title || null,
      description,
      headings,
      links,
      scriptSrcCount: $("script[src]").length,
      scriptSrcSample: scriptSrcs
    }
  };
}

module.exports = { scrapeRoomsSearchPage, validateScrapeFields };
