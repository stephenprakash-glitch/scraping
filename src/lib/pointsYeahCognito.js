const crypto = require("crypto");
const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");

/** From PointsYeah web client (override via env if they rotate clients). */
const DEFAULT_REGION = process.env.POINTSYEAH_COGNITO_REGION || "us-east-1";
const DEFAULT_CLIENT_ID =
  process.env.POINTSYEAH_COGNITO_CLIENT_ID || "3im8jrentts1pguuouv5s57gfu";

const COGNITO_TARGET = "AWSCognitoIdentityProviderService.InitiateAuth";

/** In-memory cache (per process). */
let cache = {
  idToken: null,
  expMs: 0,
  refreshToken: null
};

function cognitoIdpBase(region) {
  return `https://cognito-idp.${region}.amazonaws.com`;
}

function jwtExpMs(idToken) {
  try {
    const part = idToken.split(".")[1];
    if (!part) return 0;
    const json = Buffer.from(part, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    const exp = Number(payload.exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function cognitoSecretHash(username, clientId, clientSecret) {
  return crypto
    .createHmac("sha256", clientSecret)
    .update(username + clientId)
    .digest("base64");
}

/**
 * @param {object} opts
 * @param {string} opts.authFlow
 * @param {Record<string, string>} opts.authParameters
 * @param {string} [opts.secretHashUsername] For REFRESH_TOKEN_AUTH when client has a secret (usually same as login email).
 */
async function initiateAuth(opts) {
  const region = DEFAULT_REGION;
  const clientId = DEFAULT_CLIENT_ID;
  const clientSecret =
    typeof process.env.POINTSYEAH_COGNITO_CLIENT_SECRET === "string"
      ? process.env.POINTSYEAH_COGNITO_CLIENT_SECRET
      : "";

  const authParameters = { ...opts.authParameters };
  const hashUser =
    opts.secretHashUsername || authParameters.USERNAME || "";
  if (clientSecret && hashUser) {
    authParameters.SECRET_HASH = cognitoSecretHash(hashUser, clientId, clientSecret);
  }

  const res = await axios.post(
    `${cognitoIdpBase(region)}/`,
    {
      AuthFlow: opts.authFlow,
      ClientId: clientId,
      AuthParameters: authParameters
    },
    {
      ...upstreamAxiosOptions({ envKey: "POINTSYEAH_AXIOS_TIMEOUT_MS" }),
      validateStatus: () => true,
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": COGNITO_TARGET
      }
    }
  );

  return { status: res.status, data: res.data };
}

function cacheTokens(idToken, refreshToken) {
  const expMs = jwtExpMs(idToken);
  cache.idToken = idToken;
  cache.expMs = expMs || Date.now() + 55 * 60 * 1000;
  if (refreshToken) {
    cache.refreshToken = refreshToken;
  }
}

function clearCache() {
  cache = { idToken: null, expMs: 0, refreshToken: null };
}

/**
 * Obtain id token using env, optional request body (gated), and in-memory refresh.
 * @param {object} [body] PointsYeah search body (optional creds if env flag set)
 */
async function fetchPointsYeahIdToken(body = {}) {
  const allowBodyCreds = process.env.POINTSYEAH_ALLOW_CREDENTIALS_IN_BODY === "true";
  const envRefresh = String(process.env.POINTSYEAH_COGNITO_REFRESH_TOKEN || "").trim();
  const envEmail = String(process.env.POINTSYEAH_COGNITO_EMAIL || "").trim();
  const envPassword = String(process.env.POINTSYEAH_COGNITO_PASSWORD || "").trim();

  const bodyRefresh =
    allowBodyCreds && typeof body.cognitoRefreshToken === "string"
      ? body.cognitoRefreshToken.trim()
      : "";
  const bodyEmail =
    allowBodyCreds && typeof body.cognitoEmail === "string" ? body.cognitoEmail.trim() : "";
  const bodyPassword =
    allowBodyCreds && typeof body.cognitoPassword === "string"
      ? body.cognitoPassword.trim()
      : "";

  const refreshToken = bodyRefresh || envRefresh || cache.refreshToken;
  const email = bodyEmail || envEmail;
  const password = bodyPassword || envPassword;

  const skewMs = 90_000;
  const now = Date.now();
  if (cache.idToken && cache.expMs > now + skewMs) {
    return cache.idToken;
  }

  if (refreshToken) {
    const emailForSecret = String(process.env.POINTSYEAH_COGNITO_EMAIL || "").trim();
    const { status, data } = await initiateAuth({
      authFlow: "REFRESH_TOKEN_AUTH",
      authParameters: { REFRESH_TOKEN: refreshToken },
      secretHashUsername: emailForSecret || undefined
    });
    if (status >= 200 && status < 300 && data.AuthenticationResult?.IdToken) {
      const id = data.AuthenticationResult.IdToken;
      const nextRefresh =
        data.AuthenticationResult.RefreshToken || refreshToken;
      cacheTokens(id, nextRefresh);
      return id;
    }
    clearCache();
    const msg =
      data?.__type || data?.message || data?.message_ || JSON.stringify(data).slice(0, 300);
    const err = new Error(`Cognito refresh failed (${status}): ${msg}`);
    err.statusCode = 502;
    throw err;
  }

  if (email && password) {
    const { status, data } = await initiateAuth({
      authFlow: "USER_PASSWORD_AUTH",
      authParameters: { USERNAME: email, PASSWORD: password }
    });
    if (status >= 200 && status < 300 && data.AuthenticationResult?.IdToken) {
      const id = data.AuthenticationResult.IdToken;
      const rt = data.AuthenticationResult.RefreshToken || null;
      cacheTokens(id, rt);
      return id;
    }
    if (data.ChallengeName) {
      const err = new Error(
        `Cognito challenge required: ${data.ChallengeName} (complete in browser or use refresh token)`
      );
      err.statusCode = 400;
      throw err;
    }
    const msg =
      data?.__type || data?.message || data?.message_ || JSON.stringify(data).slice(0, 300);
    const err = new Error(`Cognito USER_PASSWORD_AUTH failed (${status}): ${msg}`);
    err.statusCode = 401;
    throw err;
  }

  return "";
}

module.exports = {
  fetchPointsYeahIdToken,
  clearPointsYeahTokenCache: clearCache,
  DEFAULT_CLIENT_ID,
  DEFAULT_REGION
};
