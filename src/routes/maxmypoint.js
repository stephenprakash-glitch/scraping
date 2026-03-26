const express = require("express");
const {
  fetchHotelsJson,
  fetchHotelByIdJson,
  fetchHotelCalendarJson,
  resolveMonthOrThrow
} = require("../lib/maxmypointHotels");

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

/**
 * GET /api/maxmypoint/hotel/:id?date=YYYY-MM
 * Aggregates:
 * - https://service.maxmypoint.com/hotel-by-id/:id
 * - https://service.maxmypoint.com/hotel-rewards-avail?id=:id&nights=1 (filtered to the requested month)
 */
router.get("/hotel/:id", async (req, res, next) => {
  try {
    const hotelId = req.params.id;
    const dateMonth = resolveMonthOrThrow(req.query.date);

    const hotelRes = await fetchHotelByIdJson(hotelId);
    if (!hotelRes.ok) return res.status(hotelRes.status).json(hotelRes.body);

    const calendarRes = await fetchHotelCalendarJson(hotelId, dateMonth, 1);
    if (!calendarRes.ok)
      return res.status(calendarRes.status).json(calendarRes.body);

    return res.json({
      hotelId: String(hotelId),
      dateMonth,
      hotel: hotelRes.body,
      calendar: calendarRes.body
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

module.exports = router;
