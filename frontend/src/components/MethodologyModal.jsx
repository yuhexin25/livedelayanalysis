export default function MethodologyModal({ refreshIntervalMinutes, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="methodology-modal" role="dialog" aria-modal="true" aria-labelledby="methodology-title" onClick={event => event.stopPropagation()}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close methodology">×</button>
        <span className="section-kicker">Methodology</span>
        <h2 id="methodology-title">How The Platform Estimates Operational Delay Risk</h2>
        <div className="methodology-grid">
          <div>
            <h3>Live FAA Source</h3>
            <p>FAA airport advisory/status data is loaded from the backend when available and used as live operational context.</p>
          </div>
          <div>
            <h3>OpenSky Traffic Signal</h3>
            <p>OpenSky aircraft state vectors are observed position/activity data near hubs. They proxy traffic density and congestion pressure, not official delay.</p>
          </div>
          <div>
            <h3>Estimated Metrics</h3>
            <p>Departure delay, arrival delay, and cancellation environment are estimated model outputs unless FlightAware is active.</p>
          </div>
          <div>
            <h3>Derived Impact Score</h3>
            <p className="formula">
              Hub Impact Score = Departure Delay × 0.4 + Arrival Delay × 0.2 + Cancellation Environment × 200 + Connectivity × 0.8 + OpenSky Traffic Pressure × 0.4 + Ground Stop Bonus
            </p>
          </div>
          <div>
            <h3>FlightAware Availability</h3>
            <p>
              FlightAware flight-level data is unavailable unless `FLIGHTAWARE_API_KEY` is configured. Without it,
              scores are analytical estimates, not official FAA or airport statistics. Backend refresh: {refreshIntervalMinutes} minutes.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
