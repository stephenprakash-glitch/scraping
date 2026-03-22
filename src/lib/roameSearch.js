const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");

const ROAME_GRAPHQL = "https://roame.travel/api/graphql";
const ROAME_ORIGIN = "https://roame.travel";
const ROAME_REFERER = "https://roame.travel/search";

const FLIGHT_SEARCH_KEYS = new Set([
  "origin",
  "destination",
  "departureDate",
  "pax",
  "tripLength",
  "searchClass",
  "mileagePrograms"
]);

const DERIVED_ONLY_KEYS = new Set(["endDepartureDate"]);

const INITIATE_MUTATION = `mutation initiateFlightSearchMutation($flightSearchInput: FlightSearchInput!) {
  initiateFlightSearch(flightSearchInput: $flightSearchInput) { jobUUID }
}`;

const PING_QUERY = `query pingSearchResultsQuery($jobUUID: String!) {
  pingSearchResults(jobUUID: $jobUUID) {
    percentCompleted
    fares {
      arrivalDatetime
      availableSeats
      departureDate
      operatingAirlines
      flightsDepartureDatetimes
      flightsArrivalDatetimes
      fareClass
      md5
      flightNumberOrder
      durationMinutes
      equipmentTypes
      allAirports
      numStops
      mileageProgram
      percentPremiumInt
      cabinClasses
      itineraryHash
      updateTime
      originIata
      destinationIata
      departureDateStr
      awardPoints
      surcharge
      roameScore
    }
  }
}`;

function roameAxiosConfig(extra = {}) {
  return {
    ...upstreamAxiosOptions({ envKey: "ROAME_AXIOS_TIMEOUT_MS" }),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: ROAME_ORIGIN,
      Referer: ROAME_REFERER,
      "User-Agent":
        process.env.ROAME_USER_AGENT ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      ...extra
    }
  };
}

function inclusiveDaySpan(startStr, endStr) {
  const start = new Date(`${startStr}T12:00:00Z`);
  const end = new Date(`${endStr}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  return Math.max(1, days);
}

function normalizeMileagePrograms(value) {
  if (value == null) return ["ALL"];
  if (Array.isArray(value)) return value.map(String);
  const s = String(value).trim();
  if (!s) return ["ALL"];
  return s.split(/[\s,]+/).filter(Boolean);
}

function buildFlightSearchInput(body) {
  const input = {};
  for (const key of FLIGHT_SEARCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const v = body[key];
    if (v === undefined) continue;
    if (key === "pax" || key === "tripLength") {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        const err = new Error(`Invalid numeric field: ${key}`);
        err.statusCode = 400;
        throw err;
      }
      input[key] = n;
    } else if (key === "mileagePrograms") {
      input[key] = normalizeMileagePrograms(v);
    } else {
      input[key] = String(v);
    }
  }

  if (body.endDepartureDate != null && body.endDepartureDate !== "") {
    if (!input.departureDate) {
      const err = new Error("endDepartureDate requires departureDate");
      err.statusCode = 400;
      throw err;
    }
    const span = inclusiveDaySpan(input.departureDate, String(body.endDepartureDate));
    if (span == null) {
      const err = new Error("Invalid departureDate or endDepartureDate");
      err.statusCode = 400;
      throw err;
    }
    input.tripLength = span;
  }

  const required = [
    "origin",
    "destination",
    "departureDate",
    "pax",
    "tripLength",
    "searchClass",
    "mileagePrograms"
  ];
  for (const r of required) {
    if (input[r] === undefined || input[r] === null || input[r] === "") {
      const err = new Error(`Missing required field for Roame search: ${r}`);
      err.statusCode = 400;
      throw err;
    }
  }

  return input;
}

function rejectUnknownBodyKeys(body) {
  const allowed = new Set([...FLIGHT_SEARCH_KEYS, ...DERIVED_ONLY_KEYS]);
  allowed.add("waitForResults");
  const bad = Object.keys(body || {}).filter((k) => !allowed.has(k));
  if (bad.length) {
    const err = new Error(`Unknown JSON keys: ${bad.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
}

async function postGraphql(payload) {
  const res = await axios.post(ROAME_GRAPHQL, payload, roameAxiosConfig());
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Roame GraphQL HTTP ${res.status}`);
    err.statusCode = 502;
    err.roameBody = res.data;
    throw err;
  }
  return res.data;
}

/**
 * Runs initiate + optional polling; returns a plain object suitable for res.json().
 */
async function runRoameSearch(body) {
  rejectUnknownBodyKeys(body);

  const waitForResults =
    body.waitForResults === undefined ? true : Boolean(body.waitForResults);

  const flightSearchInput = buildFlightSearchInput(body);

  const initData = await postGraphql({
    operationName: "initiateFlightSearchMutation",
    query: INITIATE_MUTATION,
    variables: { flightSearchInput }
  });

  if (initData.errors && initData.errors.length) {
    return {
      type: "graphql_init_error",
      status: 400,
      payload: {
        error: "Roame GraphQL rejected the search request",
        graphqlErrors: initData.errors
      }
    };
  }

  const jobUUID = initData.data?.initiateFlightSearch?.jobUUID;
  if (!jobUUID) {
    return {
      type: "no_job",
      status: 502,
      payload: {
        error: "Roame did not return jobUUID",
        roame: initData
      }
    };
  }

  if (!waitForResults) {
    return {
      type: "ok",
      status: 200,
      payload: {
        jobUUID,
        flightSearchInput,
        waitForResults: false
      }
    };
  }

  const intervalMs = Number(process.env.ROAME_POLL_INTERVAL_MS) || 800;
  const maxMs = Number(process.env.ROAME_POLL_MAX_MS) || 45000;
  const maxStalePolls = Number(process.env.ROAME_POLL_MAX_STALE) || 10;

  const started = Date.now();
  let lastPercent = -1;
  let staleCount = 0;
  let lastPing = null;

  while (Date.now() - started < maxMs) {
    const pingData = await postGraphql({
      operationName: "pingSearchResultsQuery",
      query: PING_QUERY,
      variables: { jobUUID }
    });

    if (pingData.errors && pingData.errors.length) {
      return {
        type: "graphql_ping_error",
        status: 502,
        payload: {
          error: "Roame pingSearchResults failed",
          jobUUID,
          graphqlErrors: pingData.errors
        }
      };
    }

    lastPing = pingData.data?.pingSearchResults;
    const pct = lastPing?.percentCompleted ?? 0;
    const fares = lastPing?.fares ?? [];

    if (pct >= 100) {
      return {
        type: "ok",
        status: 200,
        payload: {
          jobUUID,
          percentCompleted: pct,
          fares,
          flightSearchInput,
          complete: true
        }
      };
    }

    if (pct === lastPercent) {
      staleCount += 1;
    } else {
      staleCount = 0;
      lastPercent = pct;
    }

    if (staleCount >= maxStalePolls && fares.length > 0) {
      return {
        type: "ok",
        status: 200,
        payload: {
          jobUUID,
          percentCompleted: pct,
          fares,
          flightSearchInput,
          complete: false,
          note:
            "Stopped polling after stable percentCompleted with partial fares (Roame may not reach 100% for this query)."
        }
      };
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return {
    type: "ok",
    status: 200,
    payload: {
      jobUUID,
      percentCompleted: lastPing?.percentCompleted ?? null,
      fares: lastPing?.fares ?? [],
      flightSearchInput,
      complete: false,
      note: `Polling stopped after ${maxMs}ms cap.`
    }
  };
}

module.exports = { runRoameSearch };
