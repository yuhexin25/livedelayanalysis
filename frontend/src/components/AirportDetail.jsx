function formatTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function metricQualifier(providerMode) {
  return providerMode === 'flightaware' ? 'Observed' : 'Estimated';
}

function formatOpenSkyTime(value) {
  if (!value) return 'Unavailable';
  return formatTime(value);
}

export default function AirportDetail({ airport, sourceMode, providerMode, faaUpdatedAt }) {
  if (!airport) {
    return (
      <div>
        <span className="section-kicker">Inspection</span>
        <h2>Airport Detail</h2>
        <p className="no-data">Select an airport on the map or in a ranking to inspect its operational status.</p>
      </div>
    );
  }

  const qualifier = metricQualifier(providerMode);

  return (
    <div>
      <div className="detail-header">
        <div>
          <span className="section-kicker">{airport.isHub ? 'Major hub airport' : 'Monitored airport'}</span>
          <h2>{airport.iata}</h2>
          <p>{airport.name}</p>
        </div>
        <span className={`severity-pill severity-${airport.severity}`}>{airport.operationalStatus || airport.disruptionType}</span>
      </div>
      <div className="detail-grid">
        <div><span>Airport Name</span><strong>{airport.name}</strong></div>
        <div><span>IATA Code</span><strong>{airport.iata}</strong></div>
        <div><span>FAA Status</span><strong>{airport.faaStatus || airport.status || 'No active advisory'}</strong></div>
        <div><span>Operational Status</span><strong>{airport.operationalStatus || 'Normal operations'}</strong></div>
        <div><span>{qualifier} Departure Delay</span><strong>{airport.departureDelayMinutes || 0} min</strong></div>
        <div><span>{qualifier} Arrival Delay</span><strong>{airport.arrivalDelayMinutes || 0} min</strong></div>
        <div><span>{qualifier} Cancellation Environment</span><strong>{(((airport.cancellationRate || 0) * 100).toFixed(1))}%</strong></div>
        <div><span>Hub Status</span><strong>{airport.isHub ? 'Major hub' : 'Non-hub airport'}</strong></div>
        <div><span>Connected Airports</span><strong>{airport.connectedAirports?.length ?? airport.hubConnectivityScore ?? 'N/A'}</strong></div>
        <div><span>Derived Impact Score</span><strong>{airport.hubImpactScore ?? 'N/A'} {airport.hubImpactClassification ? `· ${airport.hubImpactClassification}` : ''}</strong></div>
        <div><span>Observed OpenSky Nearby Aircraft</span><strong>{airport.nearbyAircraftCount ?? 0}</strong></div>
        <div><span>Observed OpenSky Inbound / Outbound</span><strong>{airport.inboundAircraftCount ?? 0} / {airport.outboundAircraftCount ?? 0}</strong></div>
        <div><span>OpenSky Traffic Density Proxy</span><strong>{airport.airborneTrafficDensity ?? 0}</strong></div>
        <div><span>OpenSky fetch</span><strong>{formatOpenSkyTime(airport.lastOpenSkyFetchTime)}</strong></div>
        <div><span>FAA update</span><strong>{formatTime(faaUpdatedAt)}</strong></div>
      </div>
      <div className="advisory-box">
        <span>{sourceMode === 'live' ? 'Live FAA airport advisory/status feed' : 'Sample supplemental advisory'}</span>
        <p>{airport.rawFaaAdvisory || airport.faaStatus || airport.status}</p>
        <small>
          FAA advisory/status data is live when connected. {providerMode !== 'flightaware'
            ? 'Delay and cancellation fields are estimated model output, not official real-time airport statistics.'
            : 'Delay and cancellation fields are populated by the configured live provider.'}
        </small>
        {airport.trend && <small>Trend: {airport.trend}</small>}
      </div>
      <div className="advisory-box traffic-box">
        <span>Observed OpenSky aircraft position signal</span>
        <p>{airport.openSkyMessage || 'OpenSky aircraft state vectors are used as a traffic-density proxy, not official delay data.'}</p>
        <small>
          Nearby, inbound, outbound, and density fields are aircraft position/activity proxies around the hub. They do
          not indicate official airport delay, cancellation, or capacity statistics.
        </small>
      </div>
      <p className="panel-footnote">This is airport-level operational risk analysis, not an exact prediction for any individual flight.</p>
    </div>
  );
}
