/**
 * PointsYeah flight search on api2.pointsyeah.com (create_task + fetch_result).
 *
 * Crypto (reverse-engineered from browser payloads, not from shipped source — verify in DevTools):
 * - `encrypted`: RSA-2048-OAEP ciphertext (256 bytes) over the random 32-byte AES-256 key.
 * - `data`: base64( IV(12) || AES-256-GCM ciphertext || auth tag(16) ) over UTF-8 JSON.
 *
 * Public key is not in public route bundles; set POINTSYEAH_FLIGHT_RSA_PUBLIC_KEY_PEM (or SPKI base64 env below).
 */

const crypto = require("crypto");
const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");
const { fetchPointsYeahIdToken } = require("./pointsYeahCognito");

const FLIGHT_API2_BASE =
  process.env.POINTSYEAH_FLIGHT_API2_BASE || "https://api2.pointsyeah.com";

const DEFAULT_UA =
  process.env.POINTSYEAH_FLIGHT_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

const OAEP_HASH = (
  process.env.POINTSYEAH_FLIGHT_RSA_OAEP_HASH || "sha256"
).toLowerCase();

function resolvePublicKeyPem() {
  const pem = process.env.POINTSYEAH_FLIGHT_RSA_PUBLIC_KEY_PEM;
  if (pem && String(pem).trim()) {
    return String(pem).replace(/\\n/g, "\n").trim();
  }
  const spkiB64 = process.env.POINTSYEAH_FLIGHT_RSA_PUBLIC_KEY_SPKI_BASE64;
  if (spkiB64 && String(spkiB64).trim()) {
    const b64 = String(spkiB64).replace(/\s/g, "");
    return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
  }
  return null;
}

function oaepHashOption() {
  if (OAEP_HASH === "sha1" || OAEP_HASH === "sha-1") {
    return { oaepHash: "sha1" };
  }
  return { oaepHash: "sha256" };
}

/**
 * Build plaintext JSON for create_task. Override with `plain` on the request body.
 * Field names are best-effort; adjust `plain` from DevTools Network → Request payload.
 */
function buildFlightSearchPlain(input) {
  if (input && typeof input.plain === "object" && input.plain !== null) {
    return input.plain;
  }
  const fs = input && typeof input.flightSearch === "object" && input.flightSearch !== null
    ? input.flightSearch
    : input;
  if (!fs || typeof fs !== "object") {
    const err = new Error("Missing flight search fields: send flightSearch or plain object");
    err.statusCode = 400;
    throw err;
  }
  const out = {};
  const copy = [
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
  for (const k of copy) {
    if (fs[k] !== undefined && fs[k] !== null && fs[k] !== "") {
      out[k] = fs[k];
    }
  }
  if (Object.keys(out).length === 0) {
    const err = new Error("flightSearch has no recognized fields");
    err.statusCode = 400;
    throw err;
  }
  return out;
}

/**
 * @param {object|string} plainObjectOrJson
 * @param {string} publicKeyPem
 * @returns {{ data: string, encrypted: string }}
 */
function encryptCreateTaskBody(plainObjectOrJson, publicKeyPem) {
  const json =
    typeof plainObjectOrJson === "string"
      ? plainObjectOrJson
      : JSON.stringify(plainObjectOrJson);
  const plainBuf = Buffer.from(json, "utf8");
  const maxJson = Number(process.env.POINTSYEAH_FLIGHT_MAX_JSON_BYTES) || 256000;
  if (plainBuf.length > maxJson) {
    const err = new Error(`Flight search JSON exceeds POINTSYEAH_FLIGHT_MAX_JSON_BYTES (${plainBuf.length})`);
    err.statusCode = 400;
    throw err;
  }

  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const dataBuf = Buffer.concat([iv, ciphertext, tag]);

  const encryptedBuf = crypto.publicEncrypt(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      ...oaepHashOption()
    },
    aesKey
  );

  if (encryptedBuf.length !== 256) {
    const err = new Error(
      `Unexpected RSA ciphertext length ${encryptedBuf.length} (expected 2048-bit = 256). Check public key.`
    );
    err.statusCode = 500;
    throw err;
  }

  return {
    data: dataBuf.toString("base64"),
    encrypted: encryptedBuf.toString("base64")
  };
}

function api2Headers(authorization) {
  const h = {
    accept: "*/*",
    "accept-language":
      process.env.POINTSYEAH_FLIGHT_ACCEPT_LANGUAGE ||
      "en-GB,en-US;q=0.9,en;q=0.8",
    "content-type": "application/json",
    origin: process.env.POINTSYEAH_ORIGIN || "https://www.pointsyeah.com",
    referer: `${process.env.POINTSYEAH_ORIGIN || "https://www.pointsyeah.com"}/`,
    "user-agent": DEFAULT_UA,
    priority: "u=1, i",
    "sec-ch-ua": '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site"
  };
  if (authorization) {
    h.authorization = authorization;
  }
  return h;
}

async function resolveAuthToken(body, reqHeaders) {
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
  let token = fromBody || fromHeader || fromEnv;
  if (!token) {
    token = await fetchPointsYeahIdToken(body);
  }
  return token || "";
}

async function axiosPostJson(url, authorization, jsonBody) {
  const res = await axios.post(url, jsonBody, {
    ...upstreamAxiosOptions({ envKey: "POINTSYEAH_FLIGHT_AXIOS_TIMEOUT_MS" }),
    validateStatus: () => true,
    headers: api2Headers(authorization)
  });
  return { status: res.status, data: res.data };
}

async function createFlightSearchTask(authorization, encryptedPayload) {
  const url = `${FLIGHT_API2_BASE.replace(/\/$/, "")}/flight/search/create_task`;
  return axiosPostJson(url, authorization, encryptedPayload);
}

async function fetchFlightSearchResult(authorization, taskId) {
  const url = `${FLIGHT_API2_BASE.replace(/\/$/, "")}/flight/search/fetch_result`;
  return axiosPostJson(url, authorization, { task_id: taskId });
}

function extractTaskId(body) {
  if (!body || typeof body !== "object") return null;
  return (
    body.task_id ||
    body.taskId ||
    body.data?.task_id ||
    body.data?.taskId ||
    null
  );
}

function isProbablyComplete(fetchBody) {
  if (fetchBody == null) return false;
  if (typeof fetchBody === "object") {
    if (fetchBody.status === "complete" || fetchBody.state === "complete") return true;
    if (fetchBody.done === true || fetchBody.finished === true) return true;
    if (Array.isArray(fetchBody.results) && fetchBody.results.length > 0) return true;
    if (Array.isArray(fetchBody.data) && fetchBody.data.length > 0) return true;
  }
  return false;
}

/**
 * @param {object} body
 * @param {Record<string,string>} [reqHeaders]
 */
async function runFlightSearchApi2(body, reqHeaders) {
  const raw = body && typeof body === "object" ? body : {};
  const skipEncrypt = raw.skipEncrypt === true;
  const prebuilt =
    raw.encryptedPayload &&
    typeof raw.encryptedPayload.data === "string" &&
    typeof raw.encryptedPayload.encrypted === "string"
      ? raw.encryptedPayload
      : null;

  const authorization = await resolveAuthToken(raw, reqHeaders);
  if (!authorization) {
    const err = new Error("Missing authorization: set header, body.authorization, env, or Cognito env vars");
    err.statusCode = 401;
    throw err;
  }

  let payload = prebuilt;
  if (!payload && !skipEncrypt) {
    const pem = resolvePublicKeyPem();
    if (!pem) {
      const err = new Error(
        "Set POINTSYEAH_FLIGHT_RSA_PUBLIC_KEY_PEM or POINTSYEAH_FLIGHT_RSA_PUBLIC_KEY_SPKI_BASE64 (from DevTools Sources search: MIIB or BEGIN PUBLIC KEY on /search)."
      );
      err.statusCode = 400;
      throw err;
    }
    const plain = buildFlightSearchPlain(raw);
    payload = encryptCreateTaskBody(plain, pem);
  }

  if (!payload) {
    const err = new Error("Provide encryptedPayload { data, encrypted } or enable encryption with a public key");
    err.statusCode = 400;
    throw err;
  }

  const createRes = await createFlightSearchTask(authorization, payload);
  if (createRes.status < 200 || createRes.status >= 300) {
    return {
      status: createRes.status,
      payload: {
        error: `create_task HTTP ${createRes.status}`,
        upstream: createRes.data
      }
    };
  }

  const taskId = extractTaskId(createRes.data);
  if (!taskId) {
    return {
      status: 502,
      payload: {
        error: "create_task did not return task_id",
        upstream: createRes.data
      }
    };
  }

  const waitForResults =
    raw.waitForResults === undefined ? true : Boolean(raw.waitForResults);

  if (!waitForResults) {
    return {
      status: 200,
      payload: {
        task_id: taskId,
        create_task: createRes.data,
        waitForResults: false
      }
    };
  }

  const intervalMs = Number(process.env.POINTSYEAH_FLIGHT_POLL_INTERVAL_MS) || 800;
  const maxMs = Number(process.env.POINTSYEAH_FLIGHT_POLL_MAX_MS) || 120000;
  const started = Date.now();
  let last = null;

  while (Date.now() - started < maxMs) {
    const fetchRes = await fetchFlightSearchResult(authorization, taskId);
    last = fetchRes;
    if (fetchRes.status >= 200 && fetchRes.status < 300) {
      if (isProbablyComplete(fetchRes.data)) {
        return { status: 200, payload: { task_id: taskId, result: fetchRes.data } };
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    status: 504,
    payload: {
      error: "flight search poll timed out",
      task_id: taskId,
      last_fetch: last?.data,
      last_status: last?.status
    }
  };
}

module.exports = {
  buildFlightSearchPlain,
  encryptCreateTaskBody,
  createFlightSearchTask,
  fetchFlightSearchResult,
  runFlightSearchApi2,
  resolvePublicKeyPem,
  FLIGHT_API2_BASE
};
