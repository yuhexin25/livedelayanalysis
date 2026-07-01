const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const DEFAULT_CACHE_MS = 10 * 60 * 1000;
const MIN_CACHE_MS = 5 * 60 * 1000;
const HUB_RADIUS_KM = 130;
const EARTH_RADIUS_KM = 6371;

let cachedSignals = null;
let cachedAt = 0;
let lastFetchInfo = {
  ok: false,
  source: 'opensky',
  lastOpenSkyFetchTime: null,
  message: 'OpenSky traffic signals have not been fetched yet.',
  cacheMs: cacheMs(),
  authenticated: Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET),
};
let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

function cacheMs() {
  const configured = Number(process.env.OPENSKY_CACHE_MS || DEFAULT_CACHE_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_CACHE_MS;
  return Math.max(configured, MIN_CACHE_MS);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function distanceKm(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDegrees(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLon = toRadians(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function angleDifference(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function boundingBox(airports) {
  const lats = airports.map(airport => airport.lat).filter(Number.isFinite);
  const lons = airports.map(airport => airport.lon).filter(Number.isFinite);
  return {
    lamin: Math.max(-90, Math.min(...lats) - 2),
    lamax: Math.min(90, Math.max(...lats) + 2),
    lomin: Math.max(-180, Math.min(...lons) - 2),
    lomax: Math.min(180, Math.max(...lons) + 2),
  };
}

function emptySignal(airport, message = 'OpenSky traffic signal unavailable') {
  return {
    airportCode: airport.iata,
    nearbyAircraftCount: 0,
    inboundAircraftCount: 0,
    outboundAircraftCount: 0,
    airborneTrafficDensity: 0,
    openSkyTrafficPressureScore: 0,
    lastOpenSkyFetchTime: null,
    openSkySignalAvailable: false,
    openSkyMessage: message,
  };
}

function normalizeState(row) {
  const lon = row?.[5];
  const lat = row?.[6];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    icao24: row[0],
    callsign: String(row[1] || '').trim(),
    lon,
    lat,
    onGround: Boolean(row[8]),
    velocity: Number(row[9] || 0),
    trueTrack: Number.isFinite(row[10]) ? row[10] : null,
    verticalRate: Number.isFinite(row[11]) ? row[11] : 0,
  };
}

function buildSignals({ airports, states, fetchedAt }) {
  const radiusAreaThousandsKm2 = (Math.PI * HUB_RADIUS_KM ** 2) / 1000;
  const signals = new Map();

  for (const airport of airports) {
    const center = { lat: airport.lat, lon: airport.lon };
    let nearbyAircraftCount = 0;
    let inboundAircraftCount = 0;
    let outboundAircraftCount = 0;

    for (const state of states) {
      if (state.onGround) continue;
      const aircraft = { lat: state.lat, lon: state.lon };
      if (distanceKm(center, aircraft) > HUB_RADIUS_KM) continue;
      nearbyAircraftCount += 1;

      if (state.trueTrack == null) continue;
      const bearingToAirport = bearingDegrees(aircraft, center);
      const trackDifference = angleDifference(state.trueTrack, bearingToAirport);
      if (trackDifference <= 65 || state.verticalRate < -1.5) inboundAircraftCount += 1;
      if (trackDifference >= 115 || state.verticalRate > 1.5) outboundAircraftCount += 1;
    }

    const airborneTrafficDensity = Number((nearbyAircraftCount / radiusAreaThousandsKm2).toFixed(2));
    const openSkyTrafficPressureScore = Number(Math.min(20,
      nearbyAircraftCount * 0.22
      + inboundAircraftCount * 0.28
      + outboundAircraftCount * 0.16,
    ).toFixed(1));

    signals.set(airport.iata, {
      airportCode: airport.iata,
      nearbyAircraftCount,
      inboundAircraftCount,
      outboundAircraftCount,
      airborneTrafficDensity,
      openSkyTrafficPressureScore,
      lastOpenSkyFetchTime: fetchedAt,
      openSkySignalAvailable: true,
      openSkyMessage: 'OpenSky aircraft state vectors are used as a traffic-density proxy, not official delay data.',
    });
  }

  return signals;
}

async function getOpenSkyToken() {
  const clientId = process.env.OPENSKY_CLIENT_ID || '';
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return null;
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const response = await fetch(OPENSKY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`OpenSky token request returned ${response.status}`);
  const payload = await response.json();
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, (payload.expires_in || 1800) - 30) * 1000,
  };
  return tokenCache.accessToken;
}

async function fetchOpenSkyStates(airports) {
  const bounds = boundingBox(airports);
  const url = new URL(OPENSKY_STATES_URL);
  for (const [key, value] of Object.entries(bounds)) {
    url.searchParams.set(key, String(Number(value.toFixed(4))));
  }

  const token = await getOpenSkyToken();
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OpenSky states request returned ${response.status}`);
  const payload = await response.json();
  return (payload.states || []).map(normalizeState).filter(Boolean);
}

export async function getOpenSkyTrafficSignals(airports) {
  const cacheDuration = cacheMs();
  const now = Date.now();
  if (cachedSignals && now - cachedAt < cacheDuration) {
    return cachedSignals;
  }

  const targetAirports = airports.filter(airport => (
    airport?.iata && Number.isFinite(airport.lat) && Number.isFinite(airport.lon)
  ));
  if (!targetAirports.length) {
    cachedSignals = new Map();
    cachedAt = now;
    return cachedSignals;
  }

  try {
    const states = await fetchOpenSkyStates(targetAirports);
    const fetchedAt = new Date().toISOString();
    cachedSignals = buildSignals({ airports: targetAirports, states, fetchedAt });
    cachedAt = now;
    lastFetchInfo = {
      ok: true,
      source: 'opensky',
      lastOpenSkyFetchTime: fetchedAt,
      message: 'OpenSky aircraft state vectors loaded as live traffic proxy signals.',
      cacheMs: cacheDuration,
      authenticated: Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET),
      statesReturned: states.length,
    };
  } catch (error) {
    console.warn(`[opensky] Traffic signal fetch failed: ${error.message}`);
    const message = `OpenSky traffic signal unavailable: ${error.message}`;
    cachedSignals = new Map(targetAirports.map(airport => [airport.iata, emptySignal(airport, message)]));
    cachedAt = now;
    lastFetchInfo = {
      ok: false,
      source: 'opensky',
      lastOpenSkyFetchTime: null,
      message,
      cacheMs: cacheDuration,
      authenticated: Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET),
    };
  }

  return cachedSignals;
}

export function openSkyFallbackSignal(airport) {
  return emptySignal(airport, 'OpenSky traffic signal unavailable in fallback/sample mode');
}

export function getOpenSkyDiagnostics() {
  return lastFetchInfo;
}
