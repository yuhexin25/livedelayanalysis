import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseStringPromise } from 'xml2js';
import { createFlightDataProvider } from './flightDataProvider.js';
import { getOpenSkyDiagnostics, getOpenSkyTrafficSignals, openSkyFallbackSignal } from './openSkyService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const HUB_CODES = [
  'ATL', 'ORD', 'DFW', 'DEN', 'LAX', 'JFK', 'EWR', 'SFO', 'SEA', 'CLT', 'PHX', 'IAH', 'LAS', 'MIA',
];

export const FAA_API_URL = 'https://nasstatus.faa.gov/api/airport-status-information';
export const FETCH_INTERVAL_MS = 5 * 60 * 1000;

let latestStatus = {
  sourceMode: 'initializing',
  sourceLabel: 'Waiting for airport operational data',
  faaUpdatedAt: null,
  fetchedAt: null,
  refreshIntervalMinutes: 5,
  notice: 'Operational delay risk is estimated; FAA advisories are supplemental context.',
  openSky: getOpenSkyDiagnostics(),
  hubs: [],
  allAirports: [],
  routes: [],
};

let latestProviderInfo = {
  configuredProvider: 'estimated-operational-metrics',
  flightAwareApiKeyConfigured: false,
  airportFlightsEndpoint: 'https://aeroapi.flightaware.com/aeroapi/airports/{ICAO}/flights',
  flightStatusEndpoint: 'https://aeroapi.flightaware.com/aeroapi/flights/{ident}',
};

async function readJson(relativePath) {
  const filePath = path.resolve(__dirname, '../data', relativePath);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value == null) return '';
  if (typeof value === 'object' && '_' in value) return String(value._).trim();
  return String(value).trim();
}

function parseMinutes(value) {
  const match = text(value).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function getCategoryEntries(value) {
  if (!value || typeof value !== 'object') return [];
  if ('ARPT' in value) return [value];
  return Object.values(value).flatMap(item => asArray(item).flatMap(getCategoryEntries));
}

function categoryKind(name) {
  const lower = name.toLowerCase();
  if (lower.includes('ground stop')) return 'Ground Stop';
  if (lower.includes('ground delay')) return 'Ground Delay Program';
  if (lower.includes('closure')) return 'FAA Closure Advisory';
  if (lower.includes('deicing')) return 'Weather Delay';
  return 'Delay';
}

function normalizeEntry(entry, kind) {
  const arrivalDeparture = entry?.Arrival_Departure;
  const min = parseMinutes(arrivalDeparture?.Min || entry?.Avg || entry?.Min || entry?.Delay);
  const max = parseMinutes(arrivalDeparture?.Max || entry?.Max);
  const delayMinutes = max || min;
  const reason = text(entry?.Reason);
  const airportCode = text(entry?.ARPT || entry?.Airport || entry?.airportCode).toUpperCase();
  const weatherDelay = /WX|weather|thunderstorm|snow|wind|fog|deicing/i.test(reason);
  const disruptionType = weatherDelay && kind === 'Delay' ? 'Weather Delay' : kind;

  return {
    airportCode,
    status: reason || kind,
    disruptionType,
    delayMinutes,
    delayRange: min || max ? { min, max: max || min } : null,
    groundStop: disruptionType === 'Ground Stop',
    groundDelayProgram: disruptionType === 'Ground Delay Program',
    faaClosureAdvisory: disruptionType === 'FAA Closure Advisory',
    closure: false,
    weatherDelay: weatherDelay || kind === 'Weather Delay',
    trend: text(arrivalDeparture?.Trend || entry?.Trend),
    start: text(entry?.Start),
    end: text(entry?.Reopen || entry?.End_Time),
  };
}

function mergeStatus(existing, incoming) {
  if (!existing) return incoming;
  const priority = { 'Ground Stop': 5, 'Ground Delay Program': 4, 'Weather Delay': 3, Delay: 2, 'FAA Closure Advisory': 1 };
  const primary = (priority[incoming.disruptionType] || 0) > (priority[existing.disruptionType] || 0)
    ? incoming
    : existing;

  return {
    ...primary,
    delayMinutes: Math.max(existing.delayMinutes, incoming.delayMinutes),
    delayRange: primary.delayRange || existing.delayRange || incoming.delayRange,
    groundStop: existing.groundStop || incoming.groundStop,
    groundDelayProgram: existing.groundDelayProgram || incoming.groundDelayProgram,
    faaClosureAdvisory: existing.faaClosureAdvisory || incoming.faaClosureAdvisory,
    closure: false,
    weatherDelay: existing.weatherDelay || incoming.weatherDelay,
    status: [existing.status, incoming.status].filter(Boolean).join(' | '),
  };
}

export async function parseFaaStatusXml(xmlText) {
  const json = await parseStringPromise(xmlText, { explicitArray: false, mergeAttrs: true });
  const root = json?.AIRPORT_STATUS_INFORMATION || json?.['airport-status-information'] || json;
  const statusMap = new Map();

  for (const delayType of asArray(root?.Delay_type)) {
    const kind = categoryKind(text(delayType?.Name));
    for (const entry of getCategoryEntries(delayType)) {
      const normalized = normalizeEntry(entry, kind);
      if (!normalized.airportCode) continue;
      statusMap.set(normalized.airportCode, mergeStatus(statusMap.get(normalized.airportCode), normalized));
    }
  }

  return {
    faaUpdatedAt: text(root?.Update_Time) || null,
    statuses: Array.from(statusMap.values()),
  };
}

function classifySeverity(metrics) {
  if (!metrics) return 'green';
  const delay = Math.max(metrics.departureDelayMinutes || 0, metrics.arrivalDelayMinutes || 0);
  if (metrics.groundStop || delay > 60 || (metrics.cancellationRate || 0) > 0.1) return 'red';
  if (delay >= 30) return 'orange';
  if (delay >= 15) return 'yellow';
  return 'green';
}

function classifyImpact(score) {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

function operationalStatusFromSeverity(severity) {
  if (severity === 'red') return 'Severe operational delay risk';
  if (severity === 'orange') return 'Moderate operational delay risk';
  if (severity === 'yellow') return 'Minor operational delay risk';
  return 'Normal operations';
}

function buildNetwork(routes) {
  const neighbors = new Map();
  for (const { origin, destination } of routes) {
    if (!origin || !destination) continue;
    if (!neighbors.has(origin)) neighbors.set(origin, new Set());
    if (!neighbors.has(destination)) neighbors.set(destination, new Set());
    neighbors.get(origin).add(destination);
    neighbors.get(destination).add(origin);
  }
  return neighbors;
}

function normalStatus(code) {
  return {
    airportCode: code,
    status: 'No active FAA airport status advisory',
    disruptionType: 'Normal',
    delayMinutes: 0,
    delayRange: null,
    groundStop: false,
    groundDelayProgram: false,
    faaClosureAdvisory: false,
    closure: false,
    weatherDelay: false,
    trend: '',
    start: '',
    end: '',
  };
}

function inferDisruptionType(status) {
  if (status.disruptionType) return status.disruptionType;
  if (status.groundStop) return 'Ground Stop';
  if (status.groundDelayProgram) return 'Ground Delay Program';
  if (status.weatherDelay) return 'Weather Delay';
  if (status.delayMinutes > 0 || /delay/i.test(status.status || '')) return 'Delay';
  return 'Normal';
}

function shouldFetchOpenSky(sourceMode) {
  return sourceMode === 'live'
    && process.env.OPENSKY_ENABLED !== 'false'
    && process.env.NODE_ENV !== 'test'
    && process.env.npm_lifecycle_event !== 'test';
}

export async function buildDashboardData({ airports, routes, statuses, sourceMode, sourceLabel, faaUpdatedAt, fetchedAt }) {
  const normalizedStatuses = statuses.map(item => ({
    ...normalStatus(item.airportCode),
    ...item,
    disruptionType: inferDisruptionType(item),
  }));
  const network = buildNetwork(routes);
  const airportByCode = new Map(airports.map(airport => [airport.iata, airport]));
  const flightDataProvider = createFlightDataProvider({ airports, routes, faaStatuses: normalizedStatuses });
  latestProviderInfo = flightDataProvider.getProviderInfo();
  const openSkySignals = shouldFetchOpenSky(sourceMode)
    ? await getOpenSkyTrafficSignals(airports.filter(airport => HUB_CODES.includes(airport.iata)))
    : new Map(airports.map(airport => [airport.iata, openSkyFallbackSignal(airport)]));
  const metricsEntries = await Promise.all(airports.map(async airport => [
    airport.iata,
    await flightDataProvider.getAirportDelayMetrics(airport.iata),
  ]));
  const metricsMap = new Map(metricsEntries);

  const allAirports = airports.map(airport => {
    const faaStatus = normalizedStatuses.find(status => status.airportCode === airport.iata) || normalStatus(airport.iata);
    const metrics = metricsMap.get(airport.iata);
    const openSkySignal = openSkySignals.get(airport.iata) || openSkyFallbackSignal(airport);
    const severity = classifySeverity(metrics);
    const operationalStatus = operationalStatusFromSeverity(severity);
    const delayMinutes = Math.max(metrics.departureDelayMinutes || 0, metrics.arrivalDelayMinutes || 0);
    return {
      ...airport,
      ...faaStatus,
      ...metrics,
      ...openSkySignal,
      faaStatus: faaStatus.status,
      rawFaaAdvisory: faaStatus.status,
      operationalStatus,
      disruptionType: operationalStatus,
      delayMinutes,
      averageDelayMinutes: Math.round(((metrics.departureDelayMinutes || 0) + (metrics.arrivalDelayMinutes || 0)) / 2),
      severity,
      isHub: HUB_CODES.includes(airport.iata),
      isDisrupted: severity !== 'green',
    };
  });

  const dashboardAirportByCode = new Map(allAirports.map(airport => [airport.iata, airport]));
  const hubs = HUB_CODES.map(code => {
    const airport = dashboardAirportByCode.get(code) || { ...normalStatus(code), iata: code, name: code, lat: 0, lon: 0 };
    const connectedCodes = Array.from(network.get(code) || []).sort();
    const connectedAirports = connectedCodes.map(connectedCode => {
      const connected = airportByCode.get(connectedCode);
      return connected || { iata: connectedCode, name: connectedCode };
    });
    const affectedAirportsCount = airport.isDisrupted ? connectedAirports.length : 0;
    const hubConnectivityScore = connectedAirports.length;
    const groundStopBonus = airport.groundStop ? 35 : 0;
    const openSkyTrafficPressureScore = airport.openSkyTrafficPressureScore || 0;
    const hubImpactScore = Number((
      (airport.departureDelayMinutes || 0) * 0.4
      + (airport.arrivalDelayMinutes || 0) * 0.2
      + (airport.cancellationRate || 0) * 200
      + hubConnectivityScore * 0.8
      + openSkyTrafficPressureScore * 0.4
      + groundStopBonus
    ).toFixed(1));

    return {
      ...airport,
      connectedAirports,
      affectedAirportsCount,
      averageDelayMinutes: airport.averageDelayMinutes || 0,
      hubConnectivityScore,
      hubImpactScore,
      hubImpactClassification: classifyImpact(hubImpactScore),
      groundStopBonus,
      openSkyTrafficPressureScore,
      affected_airports_count: affectedAirportsCount,
      disruption_type: airport.disruptionType,
      average_delay_minutes: airport.averageDelayMinutes || 0,
      hub_connectivity_score: hubConnectivityScore,
      hub_impact_score: hubImpactScore,
    };
  });

  const providerMode = allAirports.some(airport => airport.provider === 'flightaware')
    ? 'flightaware'
    : 'estimated-operational-metrics';
  const effectiveSourceLabel = sourceMode === 'live'
    ? providerMode === 'flightaware'
      ? 'Live FAA Advisory + OpenSky Traffic Signals + FlightAware Operational Metrics'
      : 'Live FAA Advisory + OpenSky Traffic Signals + Estimated Operational Metrics'
    : sourceLabel;
  const openSky = getOpenSkyDiagnostics();

  return {
    sourceMode,
    sourceLabel: effectiveSourceLabel,
    faaUpdatedAt,
    fetchedAt,
    refreshIntervalMinutes: 5,
    notice: 'Live FAA advisory/status data and OpenSky aircraft traffic signals are combined with estimated operational metrics unless FlightAware is active.',
    methodology: 'Derived Hub Impact Score = departure delay × 0.4 + arrival delay × 0.2 + cancellation environment × 200 + connected airports × 0.8 + OpenSky traffic pressure × 0.4 + ground stop bonus. Delay and cancellation values are estimated unless providerMode is flightaware.',
    providerMode,
    dataProvider: providerMode,
    flightAwareApiKeyConfigured: latestProviderInfo.flightAwareApiKeyConfigured,
    isFlightAwareActive: providerMode === 'flightaware',
    openSky,
    hubs,
    allAirports,
    routes,
  };
}

export async function refreshLiveStatus() {
  const [airports, routes] = await Promise.all([readJson('airports.json'), readJson('routes.json')]);
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetch(FAA_API_URL, {
      headers: { Accept: 'application/xml,text/xml' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`FAA API returned ${response.status}`);
    const parsed = await parseFaaStatusXml(await response.text());
    latestStatus = await buildDashboardData({
      airports,
      routes,
      statuses: parsed.statuses,
      sourceMode: 'live',
      sourceLabel: 'Live FAA Advisory + OpenSky Traffic Signals + Estimated Operational Metrics',
      faaUpdatedAt: parsed.faaUpdatedAt,
      fetchedAt,
    });
    console.log(`[status] Loaded ${parsed.statuses.length} live FAA airport advisories`);
  } catch (error) {
    const fallback = await readJson('fallback_status.json');
    latestStatus = await buildDashboardData({
      airports,
      routes,
      statuses: fallback,
      sourceMode: 'fallback',
      sourceLabel: 'Sample fallback operational metrics (not live)',
      faaUpdatedAt: null,
      fetchedAt,
    });
    console.warn(`[status] FAA fetch failed; using sample fallback data: ${error.message}`);
  }

  return latestStatus;
}

export function getLatestStatus() {
  return latestStatus;
}

export function getProviderDiagnostics() {
  const dataProvider = latestStatus.dataProvider || latestStatus.providerMode || 'estimated-operational-metrics';
  const sampleAirport = latestStatus.allAirports.find(airport => airport.provider === dataProvider)
    || latestStatus.allAirports[0]
    || null;

  return {
    ok: true,
    dataProvider,
    providerMode: dataProvider,
    flightAwareApiKeyConfigured: latestProviderInfo.flightAwareApiKeyConfigured,
    configuredProvider: latestProviderInfo.configuredProvider,
    isFlightAwareActive: dataProvider === 'flightaware',
    openSky: getOpenSkyDiagnostics(),
    airportFlightsEndpoint: latestProviderInfo.airportFlightsEndpoint,
    flightStatusEndpoint: latestProviderInfo.flightStatusEndpoint,
    sampleAirport: sampleAirport ? {
      airport: sampleAirport.iata,
      provider: sampleAirport.provider,
      providerAirportCode: sampleAirport.providerAirportCode,
      departureDelayMinutes: sampleAirport.departureDelayMinutes,
      arrivalDelayMinutes: sampleAirport.arrivalDelayMinutes,
      totalFlights: sampleAirport.totalFlights,
      delayedFlights: sampleAirport.delayedFlights,
      nearbyAircraftCount: sampleAirport.nearbyAircraftCount,
      inboundAircraftCount: sampleAirport.inboundAircraftCount,
      outboundAircraftCount: sampleAirport.outboundAircraftCount,
      airborneTrafficDensity: sampleAirport.airborneTrafficDensity,
      lastOpenSkyFetchTime: sampleAirport.lastOpenSkyFetchTime,
      timestamp: sampleAirport.timestamp,
    } : null,
    message: dataProvider === 'flightaware'
      ? 'FlightAware AeroAPI is active for airport-level delay metrics; OpenSky remains an additional traffic proxy signal.'
      : 'Live FAA advisory/status data and OpenSky traffic proxy signals are active when available; delay and cancellation metrics are estimated because FlightAware is not configured or not active.',
  };
}

function riskLevelFromScore(score) {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

function airportByIata(iata) {
  return latestStatus.allAirports.find(airport => airport.iata === iata) || null;
}

export async function getFlightRiskAssessment(flightNumber) {
  const airports = await readJson('airports.json');
  const routes = await readJson('routes.json');
  const provider = createFlightDataProvider({
    airports,
    routes,
    faaStatuses: latestStatus.allAirports.map(airport => ({
      airportCode: airport.iata,
      status: airport.rawFaaAdvisory || airport.faaStatus,
      disruptionType: airport.faaDisruptionType || airport.disruptionType,
      delayMinutes: airport.delayMinutes || 0,
      groundStop: airport.groundStop,
      groundDelayProgram: airport.groundDelayProgram,
      weatherDelay: airport.weatherDelay,
    })),
  });
  const flight = await provider.getFlightStatus(flightNumber);
  const origin = airportByIata(flight.origin);
  const destination = airportByIata(flight.destination);
  if (!origin || !destination) {
    throw new Error(`Unable to resolve operational airports for ${flight.flightNumber}`);
  }

  const routeExists = routes.some(route => (
    (route.origin === origin.iata && route.destination === destination.iata)
    || (route.origin === destination.iata && route.destination === origin.iata)
  ));
  const hubExposure = Math.max(origin.hubImpactScore || 0, destination.hubImpactScore || 0);
  const delayEnvironment = Math.max(
    origin.departureDelayMinutes || 0,
    origin.arrivalDelayMinutes || 0,
    destination.departureDelayMinutes || 0,
    destination.arrivalDelayMinutes || 0,
  );
  const cancellationEnvironment = Math.max(origin.cancellationRate || 0, destination.cancellationRate || 0);
  const routeExposure = routeExists ? 8 : 14;
  const score = Math.round(Math.min(100,
    delayEnvironment * 0.45
    + cancellationEnvironment * 220
    + hubExposure * 0.35
    + routeExposure
    + (origin.groundStop || destination.groundStop ? 25 : 0),
  ));
  const riskLevel = riskLevelFromScore(score);

  return {
    flightNumber: flight.flightNumber,
    airline: flight.airline,
    originAirport: {
      iata: origin.iata,
      name: origin.name,
      departureDelayMinutes: origin.departureDelayMinutes,
      arrivalDelayMinutes: origin.arrivalDelayMinutes,
      severity: origin.severity,
      hubImpactScore: origin.hubImpactScore || 0,
    },
    destinationAirport: {
      iata: destination.iata,
      name: destination.name,
      departureDelayMinutes: destination.departureDelayMinutes,
      arrivalDelayMinutes: destination.arrivalDelayMinutes,
      severity: destination.severity,
      hubImpactScore: destination.hubImpactScore || 0,
    },
    currentOriginDelay: origin.departureDelayMinutes || 0,
    currentDestinationDelay: destination.arrivalDelayMinutes || 0,
    cancellationEnvironment,
    airportRisk: riskLevelFromScore(Math.max(origin.hubImpactScore || 0, destination.hubImpactScore || 0)),
    hubExposure: Number(hubExposure.toFixed(1)),
    estimatedDelayRisk: riskLevel,
    riskScore: score,
    riskLevel,
    routeExposure: routeExists ? 'Direct route appears in static network' : 'Connection complexity estimated from static network',
    timestamp: new Date().toISOString(),
    disclaimer: 'This is an analytical estimate generated by the Hub Resilience Monitor and is not an official FAA prediction.',
  };
}

export async function startStatusRefresh() {
  await refreshLiveStatus();
  const timer = setInterval(refreshLiveStatus, FETCH_INTERVAL_MS);
  timer.unref?.();
}
