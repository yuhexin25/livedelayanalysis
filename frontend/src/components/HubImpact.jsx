export default function HubImpact({ hubs, sourceMode, providerMode, onSelect }) {
  const ranked = [...hubs].sort((a, b) => b.hubImpactScore - a.hubImpactScore);
  const disrupted = ranked.filter(hub => hub.isDisrupted);
  const maxScore = Math.max(...ranked.map(hub => hub.hubImpactScore), 1);
  const mostCritical = ranked[0];
  const averageDelay = hubs.length
    ? Math.round(hubs.reduce((sum, hub) => sum + Math.max(hub.departureDelayMinutes || 0, hub.arrivalDelayMinutes || 0), 0) / hubs.length)
    : 0;
  const networkRiskIndex = hubs.length
    ? Math.round(ranked.reduce((sum, hub) => sum + hub.hubImpactScore, 0) / hubs.length)
    : 0;
  const totalNearbyAircraft = hubs.reduce((sum, hub) => sum + (hub.nearbyAircraftCount || 0), 0);

  return (
    <div>
      <div className="section-heading">
        <div>
          <span className="section-kicker">Estimated network effect</span>
          <h2>Hub Impact Score</h2>
        </div>
        <span className="count-badge">{disrupted.length} elevated</span>
      </div>
      <p className="section-note">
        {providerMode === 'flightaware' ? 'Provider-backed' : 'Estimated'} departure delay, arrival delay, and
        cancellation environment are combined with route connectivity, FAA ground stop context, and OpenSky traffic
        pressure proxies.
      </p>
      <div className="hub-summary-grid">
        <div><span>Most Critical Hub</span><strong>{mostCritical?.iata || '—'}</strong></div>
        <div><span>{providerMode === 'flightaware' ? 'Observed' : 'Estimated'} Avg Delay</span><strong>{averageDelay} min</strong></div>
        <div><span>OpenSky Aircraft Near Hubs</span><strong>{totalNearbyAircraft}</strong></div>
        <div><span>Derived Risk Index</span><strong>{networkRiskIndex}</strong></div>
      </div>
      <div className="impact-list">
        {ranked.slice(0, 8).map(hub => (
          <button className="impact-row" key={hub.iata} onClick={() => onSelect(hub)}>
            <span className={`status-dot dot-${hub.severity}`} />
            <strong>{hub.iata}</strong>
            <span className="impact-track"><i style={{ width: `${(hub.hubImpactScore / maxScore) * 100}%` }} /></span>
            <span>{hub.hubImpactScore.toFixed(1)} · {hub.nearbyAircraftCount || 0} ac</span>
          </button>
        ))}
      </div>
      <p className="panel-footnote">
        Higher bars identify hubs where operational delay metrics intersect with larger static route connectivity.
        FAA advisories and OpenSky aircraft positions are observed context when connected; the score is a derived
        analytical estimate, not an official FAA or airport delay metric.
      </p>
    </div>
  );
}
