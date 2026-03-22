function errorHandler(err, req, res, next) {
  // If a previous handler already responded, delegate.
  if (res.headersSent) return next(err);

  const status = err.statusCode || err.status || 500;
  const message =
    process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : err.message || "Internal Server Error";

  res.status(status).json({
    error: message
  });
}

module.exports = errorHandler;

