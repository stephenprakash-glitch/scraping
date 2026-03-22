/**
 * Parse a proxied HTTP response whose body is expected to be JSON delivered as text (axios responseType: "text").
 * @param {import("axios").AxiosResponse} axiosRes
 * @param {string} serviceName — used in error messages (e.g. "MaxMyPoint")
 * @returns {{ ok: true, status: number, body: object } | { ok: false, status: number, body: object }}
 */
function jsonFromMaybeTextResponse(axiosRes, serviceName) {
  const status = axiosRes.status;
  const contentType = axiosRes.headers["content-type"] || "";
  const bodyText =
    typeof axiosRes.data === "string"
      ? axiosRes.data
      : String(axiosRes.data ?? "");

  if (status < 200 || status >= 300) {
    return {
      ok: false,
      status,
      body: {
        error: `${serviceName} API error: HTTP ${status}`,
        externalContentType: contentType,
        bodyPreview: bodyText.slice(0, 500)
      }
    };
  }

  const looksJson = contentType.toLowerCase().includes("application/json");
  if (!looksJson) {
    return {
      ok: false,
      status: 502,
      body: {
        error: `${serviceName} did not return JSON`,
        externalContentType: contentType,
        bodyPreview: bodyText.slice(0, 500)
      }
    };
  }

  try {
    return { ok: true, status, body: JSON.parse(bodyText) };
  } catch {
    return {
      ok: false,
      status: 502,
      body: {
        error: `${serviceName} returned invalid JSON`,
        externalContentType: contentType,
        bodyPreview: bodyText.slice(0, 500)
      }
    };
  }
}

module.exports = { jsonFromMaybeTextResponse };
