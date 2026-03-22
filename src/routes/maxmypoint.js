const express = require("express");
const { fetchHotelsJson } = require("../lib/maxmypointHotels");

const router = express.Router();

/**
 * GET /api/maxmypoint/hotels
 * Proxies to https://service.maxmypoint.com/hotels with the same query string.
 */
router.get("/hotels", async (req, res, next) => {
  try {
    const result = await fetchHotelsJson(req.query);
    if (!result.ok) return res.status(result.status).json(result.body);
    return res.json(result.body);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
