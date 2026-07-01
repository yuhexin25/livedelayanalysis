const severityBaseline = {
  green: 6,
  yellow: 32,
  orange: 62,
  red: 88,
};

export default function TrendPanel({ airport, sourceMode }) {
  const baseline = severityBaseline[airport?.severity || 'green'] || 8;
  const points = Array.from({ length: 12 }, (_, index) => {
    const wave = Math.sin(index * 0.9) * 8;
    const ramp = (index - 5) * (baseline > 50 ? 1.6 : 0.6);
    return Math.max(4, Math.min(96, baseline + wave + ramp));
  });
  const coordinates = points.map((value, index) => `${index * 36},${112 - value}`).join(' ');

  return (
    <div>
      <div className="section-heading">
        <div>
          <span className="section-kicker">24-hour operational risk trend</span>
          <h2>{airport ? `${airport.iata} Estimated Risk Trend` : 'Estimated Risk Trend'}</h2>
        </div>
        <span className="count-badge">{sourceMode === 'live' ? 'FAA + OpenSky + estimated input' : 'Sample input'}</span>
      </div>
      <svg className="trend-svg" viewBox="0 0 396 130" role="img" aria-label="Estimated trend visualization based on current operational risk severity">
        <line x1="0" y1="112" x2="396" y2="112" className="trend-axis" />
        <line x1="0" y1="52" x2="396" y2="52" className="trend-gridline" />
        <polyline points={coordinates} className="trend-line" />
        {points.map((value, index) => (
          <circle key={index} cx={index * 36} cy={112 - value} r="3" className="trend-dot" />
        ))}
      </svg>
      <p className="panel-footnote">
        Estimated trend visualization based on current operational severity, FAA advisory context, and OpenSky traffic
        proxy signals. This is not live historical flight delay data.
      </p>
    </div>
  );
}
