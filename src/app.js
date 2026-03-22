const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const healthRoutes = require("./routes/health");
const seatsRoutes = require("./routes/seats");
const maxmypointRoutes = require("./routes/maxmypoint");
const roameRoutes = require("./routes/roame");
const roomsRoutes = require("./routes/rooms");
const pointsyeahRoutes = require("./routes/pointsyeah");
const errorHandler = require("./middleware/errorHandler");

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(morgan("dev"));

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get("/", (req, res) => {
    res.json({ status: "ok", service: "express-server" });
  });

  app.use("/health", healthRoutes);
  app.use("/api/seats", seatsRoutes);
  app.use("/api/maxmypoint", maxmypointRoutes);
  app.use("/api/roame", roameRoutes);
  app.use("/api/rooms", roomsRoutes);
  app.use("/api/pointsyeah", pointsyeahRoutes);

  // 404 handler (keeps errors centralized)
  app.use((req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  app.use(errorHandler);

  return app;
}

module.exports = createApp();

