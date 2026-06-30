import { useMemo, useState } from 'react';

const connectionOptions = ['Direct', 'One-stop', 'Any'];

function riskLabel(score) {
  if (score >= 75) return 'Critical';
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

function exposureLabel(score) {
  if (score >= 50) return 'High';
  if (score >= 25) return 'Moderate';
  return 'Low';
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function formatAirportLabel(airport) {
  return airport ? `${airport.iata} - ${airport.name}` : '';
}

function airportDelay(airport) {
  return Math.max(airport?.departureDelayMinutes || 0, airport?.arrivalDelayMinutes || 0);
}

function formatDelayPhrase(airport) {
  const delay = airportDelay(airport);
  if (delay >= 60) return 'critical operational delay conditions';
  if (delay >= 30) return 'elevated operational delay conditions';
  if (delay >= 15) return 'moderate operational delay conditions';
  return 'normal commercial operational conditions';
}

function hasActiveDisruption(airport) {
  return airportDelay(airport) >= 15
    || airport?.groundStop
    || airport?.groundDelayProgram
    || ['orange', 'red'].includes(airport?.severity);
}

function routeExists(routes, origin, destination) {
  return routes.some(route => (
    (route.origin === origin && route.destination === destination)
    || (route.origin === destination && route.destination === origin)
  ));
}

function connectedCodes(routes, code) {
  return new Set(routes.flatMap(route => {
    if (route.origin === code) return [route.destination];
    if (route.destination === code) return [route.origin];
    return [];
  }));
}

function findSharedConnections(routes, origin, destination) {
  const originConnections = connectedCodes(routes, origin);
  const destinationConnections = connectedCodes(routes, destination);
  return [...originConnections].filter(code => destinationConnections.has(code)).sort();
}

function buildRouteAssessment({ origin, destination, routes, airports, connectionPreference, avoidDisruptedHubs }) {
  if (!origin || !destination || origin.iata === destination.iata) return null;

  const airportByCode = new Map(airports.map(airport => [airport.iata, airport]));
  const directRoute = routeExists(routes, origin.iata, destination.iata);
  const sharedConnections = findSharedConnections(routes, origin.iata, destination.iata)
    .map(code => airportByCode.get(code))
    .filter(Boolean);
  const highRiskConnections = sharedConnections.filter(airport => (
    airport.isHub && hasActiveDisruption(airport)
  ));
  const candidateConnections = avoidDisruptedHubs
    ? sharedConnections.filter(airport => !highRiskConnections.some(hub => hub.iata === airport.iata))
    : sharedConnections;

  const originConnectivity = origin.connectedAirports?.length || origin.hubConnectivityScore || connectedCodes(routes, origin.iata).size;
  const destinationConnectivity = destination.connectedAirports?.length || destination.hubConnectivityScore || connectedCodes(routes, destination.iata).size;
  const propagationPotentialScore = Math.min(100, Math.round((originConnectivity + destinationConnectivity) * 4));
  const hubExposureScore = Math.min(100, Math.round(Math.max(origin.hubImpactScore || 0, destination.hubImpactScore || 0, ...sharedConnections.map(airport => airport.hubImpactScore || 0))));
  const groundProgramBonus = origin.groundStop || destination.groundStop ? 25 : origin.groundDelayProgram || destination.groundDelayProgram ? 12 : 0;
  const connectionComplexity = connectionPreference === 'Direct' ? (directRoute ? 4 : 18)
    : connectionPreference === 'One-stop' ? 12
      : directRoute ? 6 : 14;
  const originDelayMinutes = airportDelay(origin);
  const destinationDelayMinutes = airportDelay(destination);
  const currentDisruptionSignal = originDelayMinutes
    + destinationDelayMinutes
    + (origin.groundStop || destination.groundStop ? 60 : 0)
    + (origin.groundDelayProgram || destination.groundDelayProgram ? 30 : 0);
  const connectivityMultiplier = 1 + Math.min(1, (originConnectivity + destinationConnectivity) / 30);

  const originDelayContribution = clamp(Math.round(
    originDelayMinutes * 0.28
    + (origin.cancellationRate || 0) * 90
    + (origin.groundStop ? 10 : origin.groundDelayProgram ? 5 : 0),
  ), 0, 35);
  const destinationDelayContribution = clamp(Math.round(
    destinationDelayMinutes * 0.24
    + (destination.cancellationRate || 0) * 80
    + (destination.groundStop ? 9 : destination.groundDelayProgram ? 4 : 0),
  ), 0, 30);
  const hubConnectivityContribution = clamp(Math.round(hubExposureScore * 0.04), 0, 5);
  const networkPropagationContribution = 0;
  const currentDisruptionAmplification = currentDisruptionSignal < 15
    ? clamp(Math.round(currentDisruptionSignal * 0.08), 0, 3)
    : clamp(Math.round(currentDisruptionSignal * 0.18 * connectivityMultiplier), 0, 30);
  const faaAdvisoryContribution = clamp(groundProgramBonus, 0, 25);
  const routeRiskScore = clamp(
    originDelayContribution
    + destinationDelayContribution
    + hubConnectivityContribution
    + networkPropagationContribution
    + currentDisruptionAmplification
    + faaAdvisoryContribution,
    0,
    currentDisruptionSignal < 15 ? 24 : 100,
  );
  const riskLevel = riskLabel(routeRiskScore);

  const reasons = [];
  reasons.push(`${origin.iata} is ${origin.isHub ? 'a major hub' : 'an airport'} with ${exposureLabel(origin.hubImpactScore || 0).toLowerCase()} static network exposure.`);
  reasons.push(`${destination.iata} currently shows ${destination.operationalStatus || 'normal commercial operational risk'}.`);
  if (originConnectivity + destinationConnectivity >= 16) {
    reasons.push('Route connects high-connectivity airports, creating propagation potential if operational disruption emerges.');
  }
  if (!directRoute && connectionPreference === 'Direct') {
    reasons.push('A direct connection is not present in the static route network, so direct routing may be limited in this model.');
  }
  if (highRiskConnections.length) {
    reasons.push(`Potential one-stop paths include elevated-risk hub${highRiskConnections.length > 1 ? 's' : ''}: ${highRiskConnections.map(airport => airport.iata).join(', ')}.`);
  }

  const advisoryExplanation = origin.groundStop || destination.groundStop
    ? 'A FAA ground stop signal is active at one endpoint, which substantially increases operational risk context.'
    : origin.groundDelayProgram || destination.groundDelayProgram
      ? 'A FAA ground delay program signal is active at one endpoint, adding advisory context to the route.'
      : 'No FAA ground stop or ground delay program signal is active for the selected endpoint airports.';

  const drivers = [
    {
      title: 'Origin Operational Delay',
      severity: riskLabel(originDelayContribution * 3),
      contribution: originDelayContribution,
      explanation: `${origin.iata} currently shows ${formatDelayPhrase(origin)} based on airport-level delay and cancellation environment.`,
    },
    {
      title: 'Destination Operational Delay',
      severity: riskLabel(destinationDelayContribution * 3),
      contribution: destinationDelayContribution,
      explanation: `${destination.iata} currently shows ${formatDelayPhrase(destination)} at the destination side of the route.`,
    },
    {
      title: 'Hub Connectivity Exposure',
      label: 'Exposure',
      severity: exposureLabel(hubExposureScore),
      contribution: hubConnectivityContribution,
      explanation: `${origin.iata} and ${destination.iata} are evaluated against major hub status and hub impact scores. This is static exposure, not active delay risk by itself.`,
    },
    {
      title: 'Network Propagation Potential',
      label: 'Potential',
      severity: exposureLabel(propagationPotentialScore),
      contribution: networkPropagationContribution,
      explanation: currentDisruptionSignal < 15
        ? 'The selected airports have high propagation potential, but current operational signals are low, so active propagation risk is limited.'
        : 'These airports are highly connected and could propagate disruption if operational issues emerge.',
    },
    {
      title: 'Current Disruption Amplification',
      severity: riskLabel(currentDisruptionAmplification * 4),
      contribution: currentDisruptionAmplification,
      explanation: currentDisruptionAmplification <= 3
        ? 'Current origin and destination disruption signals are low, so hub connectivity is not meaningfully amplifying route risk.'
        : 'Current operational disruption signals are being amplified by hub connectivity and route exposure.',
    },
    {
      title: 'FAA Ground Stop / GDP Advisory',
      severity: riskLabel(faaAdvisoryContribution * 4),
      contribution: faaAdvisoryContribution,
      explanation: advisoryExplanation,
    },
  ];

  const contributionSummary = [
    { label: 'Origin Delay Environment', value: originDelayContribution },
    { label: 'Destination Delay Environment', value: destinationDelayContribution },
    { label: 'Hub Connectivity Exposure', value: hubConnectivityContribution },
    { label: 'Network Propagation Potential', value: networkPropagationContribution },
    { label: 'Current Disruption Amplification', value: currentDisruptionAmplification },
    { label: 'FAA Advisory Context', value: faaAdvisoryContribution },
  ];

  const recommendations = [];
  if (directRoute && connectionPreference !== 'One-stop') {
    recommendations.push('Prefer direct routing when possible to reduce connection exposure.');
  }
  if (highRiskConnections.length && avoidDisruptedHubs) {
    recommendations.push(`Avoid adding connections through elevated-risk hubs such as ${highRiskConnections.map(airport => airport.iata).join(', ')}.`);
  }
  if (!directRoute && candidateConnections.length) {
    recommendations.push(`If a connection is needed, compare lower-risk hubs such as ${candidateConnections.slice(0, 3).map(airport => airport.iata).join(', ')}.`);
  }
  if (faaAdvisoryContribution > 0) {
    recommendations.push('Monitor FAA operational advisories if traveling through an endpoint with active ground stop or GDP context.');
  }
  if (destinationDelayContribution <= 6 && originDelayContribution > destinationDelayContribution) {
    recommendations.push('Destination airport appears stable; main risk comes from origin airport conditions or hub exposure.');
  } else if (destinationDelayContribution >= 12) {
    recommendations.push('Destination airport conditions are a meaningful part of the route risk; monitor arrival-side advisories before departure.');
  }
  if (!recommendations.length) {
    recommendations.push('Monitor both endpoint airports and choose the simplest available routing.');
  }

  return {
    origin,
    destination,
    directRoute,
    candidateConnections,
    highRiskConnections,
    routeRiskScore,
    riskLevel,
    originAirportRisk: riskLabel(originDelayContribution * 3),
    destinationAirportRisk: riskLabel(destinationDelayContribution * 3),
    hubExposureScore,
    propagationPotentialScore,
    recommendations,
    reasons,
    drivers,
    contributionSummary,
  };
}

function AirportSummary({ label, airport }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{airport?.iata || '—'}</strong>
      <small>{airport?.name}</small>
      <small>{airport?.operationalStatus || 'Normal operations'}</small>
    </div>
  );
}

export default function RouteRiskAnalyzer({ airports, routes, providerMode }) {
  const isFlightAwareActive = providerMode === 'flightaware';
  const metricSourceLabel = isFlightAwareActive
    ? 'FlightAware-backed airport metrics active'
    : 'Live FAA advisory + estimated operational metrics';

  const sortedAirports = useMemo(
    () => [...airports].sort((a, b) => a.iata.localeCompare(b.iata)),
    [airports],
  );
  const [originCode, setOriginCode] = useState('ATL');
  const [destinationCode, setDestinationCode] = useState('LAX');
  const [airlinePreference, setAirlinePreference] = useState('');
  const [connectionPreference, setConnectionPreference] = useState('Any');
  const [avoidDisruptedHubs, setAvoidDisruptedHubs] = useState(true);

  const airportByCode = useMemo(
    () => new Map(sortedAirports.map(airport => [airport.iata, airport])),
    [sortedAirports],
  );
  const origin = airportByCode.get(originCode) || sortedAirports[0] || null;
  const destination = airportByCode.get(destinationCode) || sortedAirports.find(airport => airport.iata !== origin?.iata) || null;
  const assessment = buildRouteAssessment({
    origin,
    destination,
    routes: routes || [],
    airports: sortedAirports,
    connectionPreference,
    avoidDisruptedHubs,
  });

  return (
    <section className="route-risk-page">
      <div className="card route-risk-intro">
        <span className="section-kicker">Route-level operational exposure</span>
        <h2>Route Delay Risk Analyzer</h2>
        <p>
          Compare airport pairs using {isFlightAwareActive ? 'provider-backed' : 'estimated'} airport operational
          metrics, derived hub impact scores, static route connectivity, and live FAA ground stop or ground delay
          program signals when available.
        </p>
        <p className="panel-footnote">
          This tool estimates route-level operational risk. It does not search live tickets, seats, prices, airline
          rebooking inventory, or flight-level delays unless a live flight data provider is configured.
        </p>
      </div>

      <div className="dashboard-grid route-risk-grid">
        <form className="card risk-form" aria-label="Route delay risk analyzer" onSubmit={event => event.preventDefault()}>
          <div className="section-heading">
            <div>
              <span className="section-kicker">Route inputs</span>
              <h2>Analyze Airport Pair</h2>
            </div>
          </div>
          <label className="risk-field">
            <span>Origin Airport</span>
            <select value={origin?.iata || ''} onChange={event => setOriginCode(event.target.value)}>
              {sortedAirports.map(airport => (
                <option key={airport.iata} value={airport.iata}>{formatAirportLabel(airport)}</option>
              ))}
            </select>
          </label>
          <label className="risk-field">
            <span>Destination Airport</span>
            <select value={destination?.iata || ''} onChange={event => setDestinationCode(event.target.value)}>
              {sortedAirports.map(airport => (
                <option key={airport.iata} value={airport.iata}>{formatAirportLabel(airport)}</option>
              ))}
            </select>
          </label>
          <label className="risk-field">
            <span>Airline Preference Optional</span>
            <input
              value={airlinePreference}
              onChange={event => setAirlinePreference(event.target.value)}
              placeholder="Example: Delta, United, American"
            />
          </label>
          <label className="risk-field">
            <span>Connection Preference Optional</span>
            <select value={connectionPreference} onChange={event => setConnectionPreference(event.target.value)}>
              {connectionOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="risk-check">
            <input
              type="checkbox"
              checked={avoidDisruptedHubs}
              onChange={event => setAvoidDisruptedHubs(event.target.checked)}
            />
            <span>Avoid disrupted hubs when possible</span>
          </label>
          <div className="risk-source-note">
            <span>{metricSourceLabel}</span>
            <span>Airline preference is used as context only; no ticket inventory or flight schedule search is performed.</span>
          </div>
        </form>

        <div className="card risk-output">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Output</span>
              <h2>Route Risk Assessment</h2>
            </div>
            {assessment && <span className={`risk-level risk-${assessment.riskLevel.toLowerCase()}`}>{assessment.riskLevel}</span>}
          </div>

          {assessment ? (
            <>
              <div className="risk-summary-grid">
                <AirportSummary label="Origin" airport={assessment.origin} />
                <AirportSummary label="Destination" airport={assessment.destination} />
                <div><span>Derived Route Risk Score</span><strong>{assessment.routeRiskScore} / 100</strong><small>{assessment.riskLevel}</small></div>
                <div><span>Connection Model</span><strong>{connectionPreference}</strong><small>{assessment.directRoute ? 'Direct route in static network' : 'No direct route in static network'}</small></div>
              </div>

              <div className="risk-meter" aria-label={`Route risk score ${assessment.routeRiskScore} out of 100`}>
                <i style={{ width: `${assessment.routeRiskScore}%` }} />
              </div>

              <section className="risk-driver-card">
                <h3>Potential Delay Drivers</h3>
                <p className="section-note compact-note">
                  Driver values are {isFlightAwareActive ? 'provider-backed and then scored' : 'estimated model inputs and derived scores'}.
                </p>
                <div className="risk-driver-list">
                  {assessment.drivers.map(driver => (
                    <article className="risk-driver" key={driver.title}>
                      <div className="risk-driver-header">
                        <div>
                          <h4>{driver.title}</h4>
                          <span className={`risk-level risk-${driver.severity.toLowerCase()}`}>
                            {driver.label || 'Severity'}: {driver.severity}
                          </span>
                        </div>
                        <strong>+{driver.contribution}</strong>
                      </div>
                      <p>{driver.explanation}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="contribution-summary">
                <h3>Contribution Summary</h3>
                {assessment.contributionSummary.map(item => (
                  <div className="contribution-row" key={item.label}>
                    <span>{item.label}</span>
                    <strong>+{item.value}</strong>
                  </div>
                ))}
                <div className="contribution-row contribution-total">
                  <span>Total Derived Route Risk Score</span>
                  <strong>{assessment.routeRiskScore} / 100</strong>
                </div>
              </section>

              <div className="risk-details-grid">
                <div>
                  <h3>Reason</h3>
                  <ul className="risk-factors">
                    {assessment.reasons.map(reason => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
                <div className="risk-recommendation">
                  <h3>Suggested Routing Strategy</h3>
                  <ul className="risk-factors">
                    {assessment.recommendations.map(recommendation => <li key={recommendation}>{recommendation}</li>)}
                  </ul>
                  {airlinePreference && <small>Airline preference: {airlinePreference}</small>}
                </div>
              </div>

              <div className="risk-summary-grid route-metrics-grid">
                <div><span>Origin Airport Risk</span><strong>{assessment.originAirportRisk}</strong><small>{assessment.origin.iata}</small></div>
                <div><span>Destination Airport Risk</span><strong>{assessment.destinationAirportRisk}</strong><small>{assessment.destination.iata}</small></div>
                <div><span>Derived Hub Exposure Score</span><strong>{assessment.hubExposureScore}</strong><small>Endpoint and candidate hub exposure</small></div>
                <div><span>Network Propagation Potential</span><strong>{assessment.propagationPotentialScore}</strong><small>Static route exposure, not active risk by itself</small></div>
              </div>

              <details className="risk-explainer">
                <summary>How is this risk estimated?</summary>
                <p>
                  This score is an analytical estimate based on airport-level operational status, hub connectivity,
                  route exposure, and FAA advisory context. FAA advisory/status data is live when connected. Delay and
                  cancellation metrics are estimated model output unless FlightAware is active. It is not an official
                  FAA prediction and does not use ticket inventory or airline rebooking data.
                </p>
              </details>
            </>
          ) : (
            <p className="no-data">Choose two different airports to calculate route risk.</p>
          )}
        </div>
      </div>
    </section>
  );
}
