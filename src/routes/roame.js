const express = require("express");
const { runRoameSearch } = require("../lib/roameSearch");
const {
  runRoameHotelsLocations,
  runRoameHotelsAvailablePeriods
} = require("../lib/roameHotels");

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

/**
 * POST /api/roame/hotels/locations
 * Body: { value: string }
 */
router.post("/hotels/locations", async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await runRoameHotelsLocations(body);
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

/**
 * POST /api/roame/hotels/available-periods
 * Body: subset of HotelRoomPeriodWhereInput (see lib for defaults)
 */
router.post("/hotels/available-periods", async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const out = await runRoameHotelsAvailablePeriods(body);
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
