const axios = require("axios");
const { upstreamAxiosOptions } = require("./upstreamAxios");

const ROAME_HOTELS_GRAPHQL = "https://roame.travel/encore/graphql";
const ROAME_ORIGIN = "https://roame.travel";
const ROAME_REFERER = "https://roame.travel/hotels";

const LOCATIONS_ALLOWED_KEYS = new Set(["value"]);
const AVAILABLE_PERIODS_ALLOWED_KEYS = new Set([
  "stayDateRange",
  "bounding",
  "minNights",
  "mileagePrograms",
  "awardPointsRange",
  "cppMin",
  "brands",
  "roomType",
  "sortBy",
  "startCursorGT",
  "mapBoundInput"
]);

const SEARCH_LOCATIONS_QUERY = `query SearchLocations($value: String!, $productType: ProductType!) {
  searchLocations(value: $value, searchType: $productType) {
    results {
      label {
        label
        value
        __typename
      }
      bounding
      type
      desc
      __typename
    }
    searchType
    __typename
  }
}`;

const HOTEL_AVAILABLE_PERIODS_QUERY = `query HotelAvailablePeriods($input: HotelRoomPeriodWhereInput!) {
  hotelAvailablePeriods(input: $input) {
    availableHotels {
      hotelDetail {
        id
        name
        description
        category
        brand
        addressLine1
        addressLine2
        city
        stateProvince
        stateProvinceLabel
        country
        previewImg
        url
        logo
        mileageProgram
        location
        lowestCashUsd
        __typename
      }
      availableRooms {
        roomDetail {
          hotelId
          roomCode
          roomName
          roomDescription
          roomType
          roomTypeLabel
          roomBedType
          roomBedCount
          thumbnail
          mediaUrls
          __typename
        }
        offerPeriods {
          avgAwardPoints
          avgCpp
          avgSurchargeUsd
          avgCashPriceUsd
          brand
          offerCode
          category
          createTime
          hotelId
          mileageProgram
          nights
          roomCode
          roomType
          startDate
          __typename
        }
        __typename
      }
      availabilityPercent
      lastUpdated
      offerSummary {
        availabilityPercent
        cashPriceUsd
        awardPoints
        cpp
        __typename
      }
      __typename
    }
    hotelFilter {
      mask
      __typename
    }
    hasMore
    endCursor
    __typename
  }
}`;

function roameAxiosConfig(extraHeaders = {}) {
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
      ...extraHeaders
    }
  };
}

function rejectUnknownBodyKeys(body, allowedKeys) {
  const bad = Object.keys(body || {}).filter((k) => !allowedKeys.has(k));
  if (bad.length) {
    const err = new Error(`Unknown JSON keys: ${bad.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
}

function normalizeOneLocationRow(r) {
  return {
    label: r?.label?.label ?? null,
    value: r?.label?.value ?? null,
    type: r?.type ?? null,
    desc: r?.desc ?? null,
    bounding: r?.bounding ?? null
  };
}

function normalizeResults(searchLocationsNode) {
  // Roame currently returns `searchLocations` as an array of result groups.
  // Each group has `{ results: [...], searchType }`.
  const groups = Array.isArray(searchLocationsNode)
    ? searchLocationsNode
    : searchLocationsNode
      ? [searchLocationsNode]
      : [];

  const out = [];
  for (const g of groups) {
    const results = Array.isArray(g?.results) ? g.results : [];
    for (const r of results) out.push(normalizeOneLocationRow(r));
  }
  return out;
}

async function postGraphql(payload) {
  const res = await axios.post(
    ROAME_HOTELS_GRAPHQL,
    payload,
    roameAxiosConfig()
  );

  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`Roame GraphQL HTTP ${res.status}`);
    err.statusCode = 502;
    err.roameBody = res.data;
    throw err;
  }

  return res.data;
}

/**
 * Runs Roame hotel location search; returns a plain object suitable for res.json().
 * Body: { value: string }
 */
async function runRoameHotelsLocations(body) {
  const safeBody = body && typeof body === "object" ? body : {};
  rejectUnknownBodyKeys(safeBody, LOCATIONS_ALLOWED_KEYS);

  const value = safeBody.value == null ? "" : String(safeBody.value).trim();
  if (!value) {
    const err = new Error('Missing required field: "value"');
    err.statusCode = 400;
    throw err;
  }

  const data = await postGraphql({
    operationName: "SearchLocations",
    query: SEARCH_LOCATIONS_QUERY,
    variables: { productType: "HOTELS", value }
  });

  if (data.errors && data.errors.length) {
    return {
      type: "graphql_error",
      status: 400,
      payload: {
        error: "Roame GraphQL rejected the request",
        graphqlErrors: data.errors
      }
    };
  }

  const searchLocations = data.data?.searchLocations;
  const groups = Array.isArray(searchLocations)
    ? searchLocations
    : searchLocations
      ? [searchLocations]
      : [];
  const inferredSearchType =
    groups.find((g) => g && g.searchType)?.searchType ?? "HOTELS";

  return {
    type: "ok",
    status: 200,
    payload: {
      searchType: inferredSearchType,
      results: normalizeResults(searchLocations)
    }
  };
}

function isYyyyMmDd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function requireObject(v, name) {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    const err = new Error(`Invalid "${name}" (expected object)`);
    err.statusCode = 400;
    throw err;
  }
  return v;
}

function buildHotelAvailablePeriodsInput(body) {
  const stayDateRange = requireObject(body.stayDateRange, "stayDateRange");
  const startDate = stayDateRange.startDate;
  const endDate = stayDateRange.endDate;
  if (!isYyyyMmDd(startDate) || !isYyyyMmDd(endDate)) {
    const err = new Error(
      'Invalid "stayDateRange" (expected { startDate: YYYY-MM-DD, endDate: YYYY-MM-DD })'
    );
    err.statusCode = 400;
    throw err;
  }

  const input = {
    awardPointsRange: body.awardPointsRange ?? { start: 0, end: 300000 },
    cppMin: body.cppMin ?? 0,
    mileagePrograms: body.mileagePrograms ?? ["ALL"],
    brands: body.brands ?? { values: [], includes: false },
    stayDateRange: { startDate, endDate },
    minNights: body.minNights ?? 1,
    roomType: body.roomType ?? "All",
    startCursorGT: body.startCursorGT ?? null,
    sortBy: body.sortBy ?? "AwardPoints"
  };

  // Support either `bounding` (simple) or full `mapBoundInput`.
  if (body.mapBoundInput != null) {
    input.mapBoundInput = body.mapBoundInput;
  } else {
    const bounding = requireObject(body.bounding, "bounding");
    input.mapBoundInput = { bounding, enforce: true };
  }

  return input;
}

/**
 * Proxies Roame's HotelAvailablePeriods query.
 */
async function runRoameHotelsAvailablePeriods(body) {
  const safeBody = body && typeof body === "object" ? body : {};
  rejectUnknownBodyKeys(safeBody, AVAILABLE_PERIODS_ALLOWED_KEYS);

  const input = buildHotelAvailablePeriodsInput(safeBody);

  const data = await postGraphql({
    operationName: "HotelAvailablePeriods",
    query: HOTEL_AVAILABLE_PERIODS_QUERY,
    variables: { input }
  });

  if (data.errors && data.errors.length) {
    return {
      type: "graphql_error",
      status: 400,
      payload: {
        error: "Roame GraphQL rejected the request",
        graphqlErrors: data.errors
      }
    };
  }

  const hap = data.data?.hotelAvailablePeriods;
  if (!hap) {
    return {
      type: "no_data",
      status: 502,
      payload: { error: "Roame did not return hotelAvailablePeriods", roame: data }
    };
  }

  return {
    type: "ok",
    status: 200,
    payload: {
      hasMore: Boolean(hap.hasMore),
      endCursor: hap.endCursor ?? null,
      hotelFilter: hap.hotelFilter ?? null,
      availableHotels: Array.isArray(hap.availableHotels) ? hap.availableHotels : []
    }
  };
}

module.exports = { runRoameHotelsLocations, runRoameHotelsAvailablePeriods };

