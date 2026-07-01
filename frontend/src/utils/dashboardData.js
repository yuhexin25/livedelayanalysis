const HUB_CODES = [
  'ATL', 'ORD', 'DFW', 'DEN', 'LAX', 'JFK', 'EWR', 'SFO', 'SEA', 'CLT', 'PHX', 'IAH', 'LAS', 'MIA',
];

function normalStatus(code) {
  return {
    airportCode: code,
    status: 'No active sample status advisory',
    disruptionType: 'Normal',
    delayMinutes: 0,
    departureDelayMinutes: 0,
    arrivalDelayMinutes: 0,
    cancellationRate: 0.01,
    delayedFlights: 0,
    totalFlights: 220,
    delayRange: null,
    groundStop: false,
    groundDelayProgram: false,
    faaClosureAdvisory: false,
    closure: false,
    weatherDelay: false,
    nearbyAircraftCount: 0,
    inboundAircraftCount: 0,
    outboundAircraftCount: 0,
    airborneTrafficDensity: 0,
    openSkyTrafficPressureScore: 0,
    lastOpenSkyFetchTime: null,
    openSkySignalAvailable: false,
    openSkyMessage: 'OpenSky traffic signal unavailable in sample fallback mode',
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

function classifySeverity(status) {
  const delay = Math.max(status.departureDelayMinutes || status.delayMinutes || 0, status.arrivalDelayMinutes || 0);
  if (status.groundStop || delay > 60 || (status.cancellationRate || 0) > 0.1) return 'red';
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
    if (!neighbors.has(origin)) neighbors.set(origin, new Set());
    if (!neighbors.has(destination)) neighbors.set(destination, new Set());
    neighbors.get(origin).add(destination);
    neighbors.get(destination).add(origin);
  }
  return neighbors;
}

export function buildFallbackDashboardData({ airports, routes, statuses }) {
  const normalizedStatuses = statuses.map(status => ({
    ...normalStatus(status.airportCode),
    ...status,
    disruptionType: inferDisruptionType(status),
  }));
  const statusMap = new Map(normalizedStatuses.map(status => [status.airportCode, status]));
  const network = buildNetwork(routes);
  const airportByCode = new Map(airports.map(airport => [airport.iata, airport]));

  const allAirports = airports.map(airport => {
    const status = statusMap.get(airport.iata) || normalStatus(airport.iata);
    const departureDelayMinutes = status.departureDelayMinutes ?? status.delayMinutes ?? 0;
    const arrivalDelayMinutes = status.arrivalDelayMinutes ?? Math.round((status.delayMinutes || 0) * 0.7);
    const enrichedStatus = {
      ...status,
      departureDelayMinutes,
      arrivalDelayMinutes,
      cancellationRate: status.cancellationRate ?? (status.groundStop ? 0.12 : status.groundDelayProgram ? 0.04 : 0.01),
      delayMinutes: Math.max(departureDelayMinutes, arrivalDelayMinutes),
    };
    const severity = classifySeverity(enrichedStatus);
    return {
      ...airport,
      ...enrichedStatus,
      faaStatus: status.status,
      rawFaaAdvisory: status.status,
      operationalStatus: operationalStatusFromSeverity(severity),
      disruptionType: operationalStatusFromSeverity(severity),
      averageDelayMinutes: Math.round((departureDelayMinutes + arrivalDelayMinutes) / 2),
      provider: 'sample-operational-metrics',
      severity,
      isHub: HUB_CODES.includes(airport.iata),
      isDisrupted: severity !== 'green',
    };
  });

  const dashboardAirportByCode = new Map(allAirports.map(airport => [airport.iata, airport]));
  const hubs = HUB_CODES.map(code => {
    const airport = dashboardAirportByCode.get(code);
    const connectedAirports = Array.from(network.get(code) || [])
      .sort()
      .map(connectedCode => airportByCode.get(connectedCode) || { iata: connectedCode, name: connectedCode });
    const affectedAirportsCount = airport.isDisrupted ? connectedAirports.length : 0;
    const hubConnectivityScore = connectedAirports.length;
    const groundStopBonus = airport.groundStop ? 35 : 0;
    const hubImpactScore = Number((
      (airport.departureDelayMinutes || 0) * 0.4
      + (airport.arrivalDelayMinutes || 0) * 0.2
      + (airport.cancellationRate || 0) * 200
      + hubConnectivityScore * 0.8
      + (airport.openSkyTrafficPressureScore || 0) * 0.4
      + groundStopBonus
    ).toFixed(1));

    return {
      ...airport,
      connectedAirports,
      affectedAirportsCount,
      averageDelayMinutes: airport.averageDelayMinutes,
      hubConnectivityScore,
      hubImpactScore,
      hubImpactClassification: classifyImpact(hubImpactScore),
      groundStopBonus,
    };
  });

  return {
    sourceMode: 'fallback',
    sourceLabel: 'Sample Data Mode',
    faaUpdatedAt: null,
    fetchedAt: new Date().toISOString(),
    notice: 'Using sample fallback operational metrics — backend not connected',
    methodology: 'Sample fallback data. Derived Hub Impact Score = departure delay × 0.4 + arrival delay × 0.2 + cancellation environment × 200 + connected airports × 0.8 + OpenSky traffic pressure × 0.4 + ground stop bonus.',
    openSky: {
      ok: false,
      source: 'opensky',
      lastOpenSkyFetchTime: null,
      message: 'OpenSky traffic signal unavailable in sample fallback mode',
      cacheMs: 600000,
    },
    providerMode: 'sample-operational-metrics',
    hubs,
    allAirports,
    routes,
  };
}
