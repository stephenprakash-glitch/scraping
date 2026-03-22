const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Common axios options for third-party APIs (tolerate any status; caller interprets).
 * @param {{ envKey?: string, fallbackMs?: number }} [opts]
 *   envKey — e.g. ROAME_AXIOS_TIMEOUT_MS; if unset, falls back to UPSTREAM_TIMEOUT_MS then fallbackMs.
 */
function upstreamAxiosOptions({ envKey, fallbackMs = DEFAULT_TIMEOUT_MS } = {}) {
  let timeout = fallbackMs;
  if (envKey && process.env[envKey] != null) {
    const n = Number(process.env[envKey]);
    if (Number.isFinite(n) && n > 0) timeout = n;
  } else if (process.env.UPSTREAM_TIMEOUT_MS != null) {
    const n = Number(process.env.UPSTREAM_TIMEOUT_MS);
    if (Number.isFinite(n) && n > 0) timeout = n;
  }
  return {
    timeout,
    maxRedirects: 5,
    validateStatus: () => true
  };
}

module.exports = { upstreamAxiosOptions, DEFAULT_TIMEOUT_MS };
