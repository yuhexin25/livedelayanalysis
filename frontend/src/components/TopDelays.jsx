export default function TopDelays({ topDelayed, providerMode, onSelect }) {
  const delayLabel = providerMode === 'flightaware' ? 'Observed delay' : 'Estimated delay';

  return (
    <div>
      <div className="section-heading">
        <div>
          <span className="section-kicker">Operational delay risk</span>
          <h2>Top Elevated-Risk Airports</h2>
          <p className="section-note compact-note">
            {delayLabel}; FAA advisories and OpenSky traffic signals are live when available.
          </p>
        </div>
      </div>
      {topDelayed.length === 0 ? (
        <p className="no-data">No elevated operational delay risk is visible for monitored airports.</p>
      ) : (
        <div className="delay-list">
          {topDelayed.map((airport, index) => (
            <button key={airport.iata} className="delay-row" onClick={() => onSelect(airport)}>
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <span className={`status-dot dot-${airport.severity}`} />
              <span className="airport-name"><strong>{airport.iata}</strong><small>{airport.operationalStatus || airport.disruptionType}</small></span>
              <span className="delay-value">{Math.max(airport.departureDelayMinutes || 0, airport.arrivalDelayMinutes || 0) || '—'}<small>min</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
