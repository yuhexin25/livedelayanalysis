export default function WelcomePage({ sourceMode, providerMode, onOpenDashboard, onViewMethodology, onExploreNetwork }) {
  const isLive = sourceMode === 'live';
  const isFlightAwareActive = providerMode === 'flightaware';

  return (
    <section className="welcome-landing">
      <span className="section-kicker">GIS / aviation analytics portfolio project</span>
      <h1>Hub Resilience Monitor</h1>
      <h2>{isFlightAwareActive ? 'Live Airport and Flight Delay Risk Platform' : 'Live FAA Advisory + Estimated Operational Metrics Platform'}</h2>
      <p>
        This platform combines {isLive ? 'live FAA airport advisory/status feeds' : 'sample operational delay scenarios'},
        {isFlightAwareActive ? ' provider-backed operational metrics' : ' estimated operational metrics'}, static
        route network data, and estimated network impact scoring to explore delay propagation, hub vulnerability, and
        airport network resilience.
      </p>
      <div className="provenance-row">
        <span><i className={`provenance-dot ${isLive ? 'live-dot' : 'estimate-dot'}`} />{isLive ? 'Live FAA advisory data' : 'Sample operational data'}</span>
        <span><i className="provenance-dot static-dot" />Static route network</span>
        <span><i className="provenance-dot estimate-dot" />{isFlightAwareActive ? 'Derived risk scoring' : 'Estimated metrics and scoring'}</span>
      </div>
      <div className="welcome-actions">
        <button type="button" onClick={onOpenDashboard}>Open Live Dashboard</button>
        <button type="button" onClick={onViewMethodology}>View Methodology</button>
        <button type="button" onClick={onExploreNetwork}>Explore Airport Network</button>
      </div>
      <p className="honesty-note">
        FAA advisory/status data is live when connected. Delay and cancellation metrics are estimated until FlightAware
        or another live flight-level provider is configured.
      </p>
    </section>
  );
}
