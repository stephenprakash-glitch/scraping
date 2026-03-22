const express = require("express");
const { runRoameSearch } = require("../lib/roameSearch");

const router = express.Router();

/**
 * POST /api/roame/search
 * Body: FlightSearchInput fields plus optional endDepartureDate, waitForResults.
 */
router.post("/search", async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await runRoameSearch(body);
    return res.status(out.status).json(out.payload);
  } catch (err) {
    if (err.roameBody) {
      return res.status(err.statusCode || 502).json({
        error: err.message,
        roame: err.roameBody
      });
    }
    return next(err);
  }
});

module.exports = router;
