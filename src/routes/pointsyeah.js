const express = require("express");
const { runPointsYeahSearch } = require("../lib/pointsYeahSearch");
const { runFlightSearchApi2 } = require("../lib/pointsYeahFlightApi2");

const router = express.Router();

/**
 * POST /api/pointsyeah/search
 *
 * Body:
 * - path (string, required unless flightParams + POINTSYEAH_AWARD_SEARCH_PATH): e.g. "/explorer/search"
 * - method (optional): "GET" | "POST" (default POST)
 * - json (optional): request JSON for POST
 * - flightParams (optional): map of URL-style keys (departure, arrival, departDate, …) for award search
 * - authorization (optional): Cognito id token; prefer header X-PointsYeah-Authorization or env POINTSYEAH_AUTHORIZATION
 *
 * Auto token (no header/body authorization): set env
 * - POINTSYEAH_COGNITO_REFRESH_TOKEN (best), and POINTSYEAH_COGNITO_EMAIL if the app client uses a secret; or
 * - POINTSYEAH_COGNITO_EMAIL + POINTSYEAH_COGNITO_PASSWORD (only if the pool allows USER_PASSWORD_AUTH)
 * Dev only: POINTSYEAH_ALLOW_CREDENTIALS_IN_BODY=true and JSON cognitoEmail / cognitoPassword / cognitoRefreshToken
 */
router.post("/search", async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await runPointsYeahSearch(body, req.headers);
    return res.status(out.status).json(out.payload);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

/**
 * POST /api/pointsyeah/flight/search
 *
 * Body:
 * - flightSearch: object (departure, arrival, departDate, …) or use `plain` for exact JSON to encrypt
 * - encryptedPayload: optional { data, encrypted } to skip local encrypt (browser-captured)
 * - waitForResults: optional boolean (default true) — poll fetch_result
 * - authorization / X-PointsYeah-Authorization / Cognito env (same as /search)
 *
 * Requires POINTSYEAH_FLIGHT_RSA_PUBLIC_KEY_PEM (or SPKI base64) unless encryptedPayload is sent.
 */
router.post("/flight/search", async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await runFlightSearchApi2(body, req.headers);
    return res.status(out.status).json(out.payload);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

module.exports = router;
