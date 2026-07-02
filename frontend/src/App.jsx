import { useEffect, useMemo, useState } from 'react';
import WelcomePage from './components/WelcomePage.jsx';
import MapView from './components/MapView.jsx';
import TopDelays from './components/TopDelays.jsx';
import HubImpact from './components/HubImpact.jsx';
import NetworkView from './components/NetworkView.jsx';
import AirportDetail from './components/AirportDetail.jsx';
import AirportSearch from './components/AirportSearch.jsx';
import MethodologyModal from './components/MethodologyModal.jsx';
import TrendPanel from './components/TrendPanel.jsx';
import RouteRiskAnalyzer from './components/RouteRiskAnalyzer.jsx';
import { buildFallbackDashboardData } from './utils/dashboardData.js';

const refreshIntervalMs = 60 * 1000;
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
const FALLBACK_DATA_BASE_URL = `${import.meta.env.BASE_URL}data`;
const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const ESTIMATED_PROVIDER = 'estimated-operational-metrics';

const navigationItems = [
  { id: 'welcome', label: 'Home' },
  { id: 'dashboard', label: 'Live Airport Dashboard' },
  { id: 'route-risk', label: 'Route Risk Analyzer' },
  { id: 'network', label: 'Hub Network Analysis' },
  { id: 'about', label: 'About' },
];

const viewPaths = {
  welcome: '',
  dashboard: 'dashboard',
  'route-risk': 'route-risk',
  network: 'network',
  about: 'about',
};

function viewFromLocation() {
  const path = window.location.pathname.replace(BASE_PATH, '').replace(/^\/+|\/+$/g, '');
  return Object.entries(viewPaths).find(([, value]) => value === path)?.[0] || 'welcome';
}

function hasValidApiBaseUrl() {
  try {
    const url = new URL(API_BASE_URL);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON but received ${contentType || 'an unknown content type'}`);
  }
  return response.json();
}

async function loadFallbackData() {
  const [statuses, airports, routes] = await Promise.all([
    fetchJson(`${FALLBACK_DATA_BASE_URL}/fallback-status.json`),
    fetchJson(`${FALLBACK_DATA_BASE_URL}/airports.json`),
    fetchJson(`${FALLBACK_DATA_BASE_URL}/routes.json`),
  ]);
  return buildFallbackDashboardData({ statuses, airports, routes });
}

function formatTime(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isEstimatedProvider(data) {
  return data?.providerMode === ESTIMATED_PROVIDER || data?.dataProvider === ESTIMATED_PROVIDER;
}

function providerLabelFor(data) {
  if (data?.providerMode === 'flightaware') return 'FlightAware flight-level delay metrics';
  if (isEstimatedProvider(data)) return 'OpenSky traffic signals + estimated operational metrics';
  return data?.providerMode || 'Provider unavailable';
}

function sourceBadgeLabel(data) {
  if (!data) return 'Loading dashboard data';
  if (data.sourceMode !== 'live') return 'Sample Data Mode';
  return 'Live operations signals connected';
}

function hasActiveFaaAdvisory(airport) {
  const advisory = airport?.rawFaaAdvisory || airport?.faaStatus || airport?.status || '';
  return Boolean(
    airport?.groundStop
    || airport?.groundDelayProgram
    || airport?.weatherDelay
    || airport?.faaClosureAdvisory
    || (advisory && !/no active/i.test(advisory)),
  );
}

function kpiValue(value, available = true) {
  if (!available) return 'Unavailable';
  return value;
}

function buildDashboardMetrics(data) {
  const airports = data?.allAirports || [];
  const hubs = data?.hubs || [];
  const live = data?.sourceMode === 'live';
  const openSkyAvailable = Boolean(data?.openSky?.ok);
  return {
    faaAdvisories: kpiValue(airports.filter(hasActiveFaaAdvisory).length, live && airports.length > 0),
    observedAircraftNearby: kpiValue(
      airports.reduce((sum, airport) => sum + (airport.nearbyAircraftCount || 0), 0),
      live && openSkyAvailable,
    ),
    highRiskAirports: kpiValue(
      airports.filter(airport => ['orange', 'red'].includes(airport.severity)).length,
      live && airports.length > 0,
    ),
    majorHubs: kpiValue(hubs.length, hubs.length > 0),
  };
}

function findBusiestOpenSkyHub(hubs) {
  return [...(hubs || [])].sort((a, b) => (b.nearbyAircraftCount || 0) - (a.nearbyAircraftCount || 0))[0] || null;
}

function findHighestRiskHub(hubs) {
  return [...(hubs || [])].sort((a, b) => (b.hubImpactScore || 0) - (a.hubImpactScore || 0))[0] || null;
}

function networkConditionLabel({ advisoryCount, highRiskCount, openSkyAvailable, busiestHub }) {
  if (advisoryCount >= 4 || highRiskCount >= 4) return 'Elevated';
  if (advisoryCount > 0 || highRiskCount > 0 || (openSkyAvailable && (busiestHub?.airborneTrafficDensity || 0) >= 0.5)) return 'Moderate';
  return 'Stable';
}

function AviationSnapshot({ data }) {
  if (!data?.allAirports?.length) return null;
  const hubs = data.hubs || [];
  const advisoryCount = data.sourceMode === 'live' ? data.allAirports.filter(hasActiveFaaAdvisory).length : null;
  const highRiskAirports = data.allAirports.filter(airport => ['orange', 'red'].includes(airport.severity));
  const busiestHub = data.openSky?.ok ? findBusiestOpenSkyHub(hubs) : null;
  const highestRiskHub = findHighestRiskHub(hubs);
  const condition = networkConditionLabel({
    advisoryCount: advisoryCount || 0,
    highRiskCount: highRiskAirports.length,
    openSkyAvailable: Boolean(data.openSky?.ok),
    busiestHub,
  });
  const advisoryText = advisoryCount == null
    ? 'FAA advisory status is unavailable because the dashboard is in sample fallback mode.'
    : advisoryCount === 0
      ? 'No major monitored FAA advisory signal is currently detected.'
      : `${advisoryCount} monitored airport${advisoryCount === 1 ? '' : 's'} show FAA advisory context.`;
  const trafficText = data.openSky?.ok && busiestHub
    ? `${busiestHub.iata} has the busiest observed OpenSky traffic proxy with ${busiestHub.nearbyAircraftCount || 0} nearby aircraft.`
    : 'OpenSky traffic proxy data is currently unavailable.';
  const riskText = highestRiskHub
    ? `${highestRiskHub.iata} has the highest derived hub risk score (${(highestRiskHub.hubImpactScore || 0).toFixed(1)}).`
    : 'Derived hub risk is unavailable.';

  return (
    <section className="snapshot-panel">
      <div>
        <span className="section-kicker">Executive summary</span>
        <h2>Today's Aviation Snapshot</h2>
        <p>
          {condition === 'Stable'
            ? 'No major nationwide FAA disruption is currently detected. Estimated operational risk remains broadly stable across monitored hubs.'
            : `Overall network condition is ${condition.toLowerCase()}, with attention driven by advisory, traffic-density, or derived risk signals.`}
        </p>
      </div>
      <div className="snapshot-grid">
        <div><span>FAA advisory status</span><strong>{advisoryText}</strong></div>
        <div><span>Busiest observed hub</span><strong>{trafficText}</strong></div>
        <div><span>Highest estimated-risk hub</span><strong>{riskText}</strong></div>
        <div><span>Overall network condition</span><strong>{condition}</strong></div>
      </div>
    </section>
  );
}

function DataMethodologyPanel({ data }) {
  if (!data || data.sourceMode !== 'live') return null;
  const estimated = isEstimatedProvider(data);
  const openSkyAvailable = data.openSky?.ok;
  return (
    <details className="methodology-compact">
      <summary>
        <span>
          <span className="section-kicker">Data Sources & Methodology</span>
          <strong>FAA advisory feed, OpenSky traffic proxy, and derived risk modeling</strong>
        </span>
        <span className="methodology-status-row">
          <i className="source-chip live">FAA live</i>
          <i className={`source-chip ${openSkyAvailable ? 'live' : 'muted'}`}>OpenSky {openSkyAvailable ? 'observed' : 'unavailable'}</i>
          <i className="source-chip estimate">Estimated risk</i>
          {estimated && (
            <i className="source-chip warning">
              {data.flightAwareApiKeyConfigured ? 'FlightAware inactive' : 'FlightAware not configured'}
            </i>
          )}
        </span>
      </summary>
      <div className="methodology-detail-grid">
        <div><strong>FAA Advisory</strong><span>Official airport/airspace advisory feed for ground stops, delay programs, closure advisories, and operational context.</span></div>
        <div><strong>OpenSky Traffic Signals</strong><span>Observed aircraft position data used only as a nearby airborne traffic and density proxy, not official delay data.</span></div>
        <div><strong>Estimated Operational Metrics</strong><span>Model-derived delay, cancellation environment, hub impact, and route risk estimates.</span></div>
        <div><strong>FlightAware</strong><span>{estimated ? 'Inactive unless explicitly configured and verified.' : 'Active provider-backed operational metrics.'}</span></div>
        {!openSkyAvailable && <div><strong>OpenSky status</strong><span>{data.openSky?.message || 'OpenSky traffic signals are currently unavailable.'}</span></div>}
      </div>
    </details>
  );
}

function SourcePanel({ data }) {
  return (
    <div className="source-panel">
      <span className={`source-badge ${data?.sourceMode === 'live' ? 'source-live' : 'source-fallback'}`}>
        <span className="pulse-dot" />
        {sourceBadgeLabel(data)}
      </span>
      <span>FAA advisory update: {formatTime(data?.faaUpdatedAt)}</span>
      <span>Metric provider: {providerLabelFor(data)}</span>
      <span>Dashboard fetch: {formatTime(data?.fetchedAt)}</span>
    </div>
  );
}

function Navigation({ activeView, setActiveView }) {
  return (
    <nav className="app-nav" aria-label="Dashboard sections">
      <div className="nav-brand">
        <span className="section-kicker">Airport Risk</span>
        <strong>Platform</strong>
      </div>
      <div className="nav-items">
        {navigationItems.map(item => (
          <button
            key={item.id}
            type="button"
            className={activeView === item.id ? 'active' : ''}
            onClick={() => setActiveView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function MethodologyContent({ refreshIntervalMinutes, onOpenModal }) {
  return (
    <>
      <div className="methodology-page-actions">
        <button className="methodology-button" type="button" onClick={onOpenModal}>Open Methodology Summary</button>
      </div>
      <div className="methodology-page-grid">
        <section className="card">
          <span className="section-kicker">Primary architecture</span>
          <h2>Estimated Operational Metrics</h2>
          <p className="page-copy">
            The scoring layer focuses on airport network resilience, hub disruption propagation, and route-level
            operational exposure. When FlightAware is not configured, delay and cancellation values are model outputs,
            not directly observed flight-level statistics.
          </p>
        </section>
        <section className="card">
          <span className="section-kicker">Live source</span>
          <h2>FAA Operational Advisories</h2>
          <p className="page-copy">
            FAA NAS Status, ground stops, and ground delay programs are displayed as context. Raw FAA text is not used
            as the primary airport-closure signal.
          </p>
        </section>
        <section className="card">
          <span className="section-kicker">Observed traffic signal</span>
          <h2>OpenSky Aircraft State Vectors</h2>
          <p className="page-copy">
            OpenSky contributes live aircraft position signals near hub airports: nearby aircraft, inbound/outbound
            movement proxies, traffic density, and congestion pressure. These are not official delay statistics.
          </p>
        </section>
        <section className="card">
          <span className="section-kicker">Estimated metric</span>
          <h2>Hub Impact Score</h2>
          <p className="formula page-formula">
            Hub Impact Score = Departure Delay × 0.4 + Arrival Delay × 0.2 + Cancellation Environment × 200 + Connectivity × 0.8 + OpenSky Traffic Pressure × 0.4 + Ground Stop Bonus
          </p>
          <p className="page-copy">Scores are derived analytical estimates and are not official FAA or airport metrics.</p>
        </section>
        <section className="card">
          <span className="section-kicker">Limitations</span>
          <h2>Flight-Level Data Availability</h2>
          <p className="page-copy">
            The dashboard updates every {refreshIntervalMinutes} minutes. FlightAware flight-level data is only used
            when its API key is configured and the provider reports active data.
          </p>
        </section>
      </div>
    </>
  );
}

function AboutContent() {
  return (
    <section className="card about-page-card">
      <span className="section-kicker">About this project</span>
      <h2>Live FAA Advisory + OpenSky Traffic Signals + Estimated Operational Metrics Platform</h2>
      <p>
        This project combines live FAA airport advisory/status feeds, OpenSky aircraft position signals, estimated
        operational delay and cancellation metrics, static route network data, and custom network impact scoring.
        Flight-level live delay data is used only when a provider such as FlightAware is configured.
      </p>
      <div className="tech-stack">
        <span>React</span>
        <span>MapLibre GL</span>
        <span>D3</span>
        <span>Node.js/Express</span>
        <span>Render</span>
        <span>GitHub Pages</span>
      </div>
      <div className="project-links">
        <a href="https://github.com/yuhexin25-oss/livedelayanalysis" target="_blank" rel="noreferrer">GitHub repository</a>
        <a href="https://livedelayanalysis-backend.onrender.com/api/health" target="_blank" rel="noreferrer">Live backend health</a>
        <a href="https://livedelayanalysis-backend.onrender.com/api/status" target="_blank" rel="noreferrer">Live backend status JSON</a>
      </div>
    </section>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [selectedAirport, setSelectedAirport] = useState(null);
  const [backendMessage, setBackendMessage] = useState(null);
  const [isMethodologyOpen, setIsMethodologyOpen] = useState(false);
  const [activeView, setActiveView] = useState(() => viewFromLocation());

  function navigateToView(view) {
    setActiveView(view);
    const targetPath = viewPaths[view] ? `${BASE_PATH}/${viewPaths[view]}` : `${BASE_PATH}/`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  }

  useEffect(() => {
    function handlePopState() {
      setActiveView(viewFromLocation());
    }
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function fetchStatus() {
      let payload;
      try {
        if (!hasValidApiBaseUrl()) {
          throw new Error('VITE_API_BASE_URL is not configured with an absolute URL');
        }
        payload = await fetchJson(`${API_BASE_URL}/api/status`);
        if (!payload?.allAirports || !payload?.hubs || !payload?.routes) {
          throw new Error('Backend response is missing dashboard data');
        }
        if (mounted) {
          setBackendMessage(payload.sourceMode === 'live'
            ? null
            : 'Backend connected, but it is serving sample fallback data. These values are not live.');
        }
      } catch (err) {
        try {
          payload = await loadFallbackData();
          if (mounted) setBackendMessage('Using sample fallback data — backend not connected');
        } catch (fallbackError) {
          if (mounted) {
            setBackendMessage(`Unable to load backend or fallback data: ${fallbackError.message}`);
          }
          return;
        }
      }

      if (mounted) {
        setData(payload);
        setSelectedAirport(current => {
          if (!current) return payload.hubs?.find(hub => hub.isDisrupted) || payload.hubs?.[0] || null;
          return payload.hubs?.find(hub => hub.iata === current.iata)
            || payload.allAirports?.find(airport => airport.iata === current.iata)
            || current;
        });
      }
    }
    fetchStatus();
    const interval = setInterval(fetchStatus, refreshIntervalMs);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const enrichedAirports = useMemo(() => {
    if (!data?.allAirports) return [];
    const hubMetrics = new Map((data.hubs || []).map(hub => [hub.iata, hub]));
    const routeDegree = new Map();
    for (const route of data.routes || []) {
      routeDegree.set(route.origin, (routeDegree.get(route.origin) || 0) + 1);
      routeDegree.set(route.destination, (routeDegree.get(route.destination) || 0) + 1);
    }

    return data.allAirports.map(airport => {
      const hub = hubMetrics.get(airport.iata);
      if (hub) return { ...airport, ...hub };
      const connectedAirportsCount = routeDegree.get(airport.iata) || 0;
      return {
        ...airport,
        connectedAirports: [],
        affectedAirportsCount: airport.isDisrupted ? connectedAirportsCount : 0,
        averageDelayMinutes: airport.delayMinutes || 0,
        hubConnectivityScore: connectedAirportsCount,
        hubImpactScore: 0,
      };
    });
  }, [data]);

  const topDelayed = useMemo(() => {
    if (!enrichedAirports.length) return [];
    return enrichedAirports
      .filter(airport => airport.isDisrupted)
      .sort((a, b) => Math.max(b.departureDelayMinutes || 0, b.arrivalDelayMinutes || 0) - Math.max(a.departureDelayMinutes || 0, a.arrivalDelayMinutes || 0) || (b.hubImpactScore || 0) - (a.hubImpactScore || 0))
      .slice(0, 6);
  }, [enrichedAirports]);

  const disruptedHubs = data?.hubs?.filter(hub => hub.isDisrupted) || [];
  const selectedAirportView = enrichedAirports.find(airport => airport.iata === selectedAirport?.iata) || selectedAirport;

  function handleAirportSelect(airport) {
    const enriched = enrichedAirports.find(item => item.iata === airport.iata) || airport;
    setSelectedAirport(enriched);
  }

  function selectAndNavigate(airport, view = 'dashboard') {
    if (airport) handleAirportSelect(airport);
    navigateToView(view);
  }

  const activeHub = data?.hubs?.find(hub => hub.iata === selectedAirportView?.iata)
    || disruptedHubs[0]
    || data?.hubs?.[0]
    || null;

  function renderActiveView() {
    switch (activeView) {
      case 'dashboard':
        return (
          <>
            {backendMessage && <div className="alert warning">{backendMessage}</div>}
            <DataMethodologyPanel data={data} />
            <AviationSnapshot data={data} />
            <section className="metric-strip" aria-label="Operational overview">
              {(() => {
                const metrics = buildDashboardMetrics(data);
                return (
                  <>
                    <div className="metric-card"><span>Current FAA Advisories</span><strong>{metrics.faaAdvisories}</strong></div>
                    <div className="metric-card"><span>Observed Aircraft Nearby / Across Monitored Airports</span><strong>{metrics.observedAircraftNearby}</strong></div>
                    <div className="metric-card"><span>Estimated High-risk Airports</span><strong className={Number(metrics.highRiskAirports) > 0 ? 'text-alert' : ''}>{metrics.highRiskAirports}</strong></div>
                    <div className="metric-card"><span>Major Hub Airports</span><strong>{metrics.majorHubs}</strong></div>
                  </>
                );
              })()}
            </section>
            <section className="control-bar">
              <AirportSearch airports={enrichedAirports} onSelect={airport => selectAndNavigate(airport, 'dashboard')} />
            </section>
            <section className="dashboard-grid live-dashboard-grid">
              <div className="card map-card">
                <MapView
                  airports={enrichedAirports}
                  routes={data?.routes || []}
                  selectedAirport={selectedAirportView}
                  sourceMode={data?.sourceMode}
                  onSelect={airport => selectAndNavigate(airport, 'dashboard')}
                />
              </div>
              <div className="dashboard-side-stack">
                <div className="card compact-card">
                  <AirportDetail airport={selectedAirportView} sourceMode={data?.sourceMode} providerMode={data?.providerMode} faaUpdatedAt={data?.faaUpdatedAt} />
                </div>
                <div className="card compact-card">
                  <TopDelays topDelayed={topDelayed} providerMode={data?.providerMode} onSelect={airport => selectAndNavigate(airport, 'dashboard')} />
                </div>
              </div>
            </section>
          </>
        );
      case 'network':
        return (
          <section className="dashboard-grid network-page-grid">
            <div className="card network-card">
              <div className="hub-focus-picker" aria-label="Select hub for propagation network">
                {(data?.hubs || []).map(hub => (
                  <button
                    key={hub.iata}
                    type="button"
                    className={activeHub?.iata === hub.iata ? 'active' : ''}
                    onClick={() => handleAirportSelect(hub)}
                  >
                    {hub.iata}
                  </button>
                ))}
              </div>
              <NetworkView
                hubs={data?.hubs || []}
                airports={enrichedAirports}
                selectedAirport={activeHub || selectedAirportView}
                onSelect={handleAirportSelect}
              />
            </div>
            <div className="card">
              <HubImpact hubs={data?.hubs || []} sourceMode={data?.sourceMode} providerMode={data?.providerMode} onSelect={airport => selectAndNavigate(airport, 'network')} />
            </div>
            <div className="card">
              <TrendPanel airport={activeHub || selectedAirportView} sourceMode={data?.sourceMode} />
            </div>
          </section>
        );
      case 'route-risk':
        return (
          <RouteRiskAnalyzer
            airports={enrichedAirports}
            routes={data?.routes || []}
            providerMode={data?.providerMode}
          />
        );
      case 'about':
        return (
          <>
            <AboutContent />
            <MethodologyContent
              refreshIntervalMinutes={data?.refreshIntervalMinutes || 5}
              onOpenModal={() => setIsMethodologyOpen(true)}
            />
          </>
        );
      case 'welcome':
      default:
        return (
          <WelcomePage
            sourceMode={data?.sourceMode}
            providerMode={data?.providerMode}
            onOpenDashboard={() => navigateToView('dashboard')}
            onViewMethodology={() => navigateToView('about')}
            onExploreNetwork={() => navigateToView('network')}
          />
        );
    }
  }

  return (
    <div className="dashboard-shell">
      <Navigation activeView={activeView} setActiveView={navigateToView} />
      <div className="content-shell">
        <header className="app-banner">
          <div className="banner-copy">
            <span className="eyebrow">GIS / Aviation Analytics Portfolio</span>
            <h1>Hub Resilience Monitor</h1>
            <p>
              {data?.sourceMode === 'live'
                ? 'A real-time aviation operations and hub resilience dashboard using FAA advisories, OpenSky observed traffic signals, and transparent estimated risk modeling.'
                : 'Sample aviation operations scenarios for hub vulnerability and network resilience.'}
            </p>
          </div>
          <SourcePanel data={data} />
        </header>

        <main className="view-content">
          {renderActiveView()}
        </main>

        <footer className="app-footer">
          <span>{data?.notice || 'Operational delay risk is estimated; FAA advisories are supplemental context.'}</span>
          <span>Built with React, MapLibre GL, D3, Node.js/Express, Render, and GitHub Pages.</span>
        </footer>
      </div>
      {isMethodologyOpen && (
        <MethodologyModal
          refreshIntervalMinutes={data?.refreshIntervalMinutes || 5}
          onClose={() => setIsMethodologyOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
