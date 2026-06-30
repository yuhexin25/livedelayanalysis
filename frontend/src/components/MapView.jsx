import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

const severityColors = {
  green: '#45d483',
  yellow: '#f6d365',
  orange: '#ff9f43',
  red: '#ff5d73',
};

const modeOptions = [
  { id: 'status', label: 'Airport Status' },
  { id: 'hub', label: 'Hub Network' },
  { id: 'propagation', label: 'Propagation View' },
];

const darkGlobeStyle = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {
    cartoDark: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    },
  },
  layers: [
    {
      id: 'carto-dark',
      type: 'raster',
      source: 'cartoDark',
      paint: {
        'raster-opacity': 0.82,
        'raster-saturation': -0.25,
      },
    },
  ],
};

function airportDelay(airport) {
  return Math.max(airport?.departureDelayMinutes || 0, airport?.arrivalDelayMinutes || 0, airport?.delayMinutes || 0);
}

function getSeverity(airport) {
  return airport?.severity || 'green';
}

function getConnectivity(airport, routeDegree) {
  return airport?.connectedAirports?.length || airport?.hubConnectivityScore || routeDegree.get(airport?.iata) || 0;
}

function isElevatedRisk(airport) {
  return airportDelay(airport) >= 15 || airport?.groundStop || airport?.groundDelayProgram || ['yellow', 'orange', 'red'].includes(getSeverity(airport));
}

function normalizeLngLat(airport) {
  if (!Number.isFinite(Number(airport?.lat)) || !Number.isFinite(Number(airport?.lon))) return null;
  return [Number(airport.lon), Number(airport.lat)];
}

function interpolateGreatCircle(start, end, steps = 48) {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const [lng1, lat1] = [start[0] * toRad, start[1] * toRad];
  const [lng2, lat2] = [end[0] * toRad, end[1] * toRad];
  const delta = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2,
  ));

  if (!Number.isFinite(delta) || delta === 0) return [start, end];

  const coordinates = [];
  for (let i = 0; i <= steps; i += 1) {
    const fraction = i / steps;
    const a = Math.sin((1 - fraction) * delta) / Math.sin(delta);
    const b = Math.sin(fraction * delta) / Math.sin(delta);
    const x = a * Math.cos(lat1) * Math.cos(lng1) + b * Math.cos(lat2) * Math.cos(lng2);
    const y = a * Math.cos(lat1) * Math.sin(lng1) + b * Math.cos(lat2) * Math.sin(lng2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lng = Math.atan2(y, x);
    coordinates.push([lng * toDeg, lat * toDeg]);
  }
  return coordinates;
}

function buildRouteDegree(routes) {
  const degree = new Map();
  for (const route of routes || []) {
    degree.set(route.origin, (degree.get(route.origin) || 0) + 1);
    degree.set(route.destination, (degree.get(route.destination) || 0) + 1);
  }
  return degree;
}

function connectedCodesForAirport(airport, routes) {
  const fromAirport = airport?.connectedAirports?.map(item => item.iata) || [];
  const fromRoutes = (routes || []).flatMap(route => {
    if (route.origin === airport?.iata) return [route.destination];
    if (route.destination === airport?.iata) return [route.origin];
    return [];
  });
  return [...new Set([...fromAirport, ...fromRoutes])];
}

function makeAirportFeatureCollection({ airports, selectedAirport, connectedCodes, routeDegree, mode }) {
  const selectedCode = selectedAirport?.iata;
  const connectedSet = new Set(connectedCodes);
  return {
    type: 'FeatureCollection',
    features: airports
      .map(airport => {
        const coordinates = normalizeLngLat(airport);
        if (!coordinates) return null;
        const connected = connectedSet.has(airport.iata);
        const selected = airport.iata === selectedCode;
        const elevated = isElevatedRisk(airport);
        const connectivity = getConnectivity(airport, routeDegree);
        const dim = mode !== 'status' && selectedCode && !selected && !connected;
        return {
          type: 'Feature',
          id: airport.iata,
          geometry: { type: 'Point', coordinates },
          properties: {
            code: airport.iata,
            name: airport.name || airport.iata,
            severity: getSeverity(airport),
            color: severityColors[getSeverity(airport)] || severityColors.green,
            status: airport.operationalStatus || airport.disruptionType || 'Normal operations',
            delay: airportDelay(airport),
            connectivity,
            impactScore: airport.hubImpactScore || 0,
            isHub: Boolean(airport.isHub),
            selected,
            connected,
            elevated,
            dim,
          },
        };
      })
      .filter(Boolean),
  };
}

function makeRouteFeatureCollection({ airportsByCode, routes, selectedAirport, connectedCodes, mode }) {
  if (mode === 'status' || !selectedAirport?.iata) {
    return { type: 'FeatureCollection', features: [] };
  }

  const selectedCode = selectedAirport.iata;
  const selected = airportsByCode.get(selectedCode);
  const selectedCoordinates = normalizeLngLat(selected);
  if (!selectedCoordinates) return { type: 'FeatureCollection', features: [] };

  const connectedSet = new Set(connectedCodes);
  const routePairs = (routes || []).filter(route => (
    (route.origin === selectedCode && connectedSet.has(route.destination))
    || (route.destination === selectedCode && connectedSet.has(route.origin))
  ));

  return {
    type: 'FeatureCollection',
    features: routePairs
      .map(route => {
        const downstreamCode = route.origin === selectedCode ? route.destination : route.origin;
        const downstream = airportsByCode.get(downstreamCode);
        const downstreamCoordinates = normalizeLngLat(downstream);
        if (!downstreamCoordinates) return null;
        const elevated = isElevatedRisk(selected);
        const downstreamImpact = downstream?.hubImpactScore || 0;
        return {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: interpolateGreatCircle(selectedCoordinates, downstreamCoordinates),
          },
          properties: {
            origin: selectedCode,
            destination: downstreamCode,
            importance: Math.max(1, Math.min(8, Math.round(((selected?.hubConnectivityScore || connectedSet.size || 1) + (downstream?.hubConnectivityScore || 1)) / 4))),
            elevated,
            exposure: Math.max(airportDelay(selected), downstreamImpact),
          },
        };
      })
      .filter(Boolean),
  };
}

function airportCircleColorExpression(viewMode) {
  return [
    'case',
    ['all', ['==', viewMode, 'propagation'], ['get', 'connected'], ['get', 'elevated']],
    ['interpolate', ['linear'], ['get', 'impactScore'], 0, '#f6d365', 35, '#ff9f43', 70, '#ff5d73'],
    ['get', 'color'],
  ];
}

function routeLineGradientExpression(viewMode) {
  if (viewMode === 'propagation') {
    return [
      'case',
      ['get', 'elevated'],
      ['interpolate', ['linear'], ['line-progress'], 0, '#ff5d73', 0.55, '#ff9f43', 1, '#f6d365'],
      ['interpolate', ['linear'], ['line-progress'], 0, '#4da3ff', 1, '#9fc9ff'],
    ];
  }

  return ['interpolate', ['linear'], ['line-progress'], 0, '#4da3ff', 1, '#b9dcff'];
}

function setSourceData(map, sourceId, data) {
  const source = map.getSource(sourceId);
  if (source) source.setData(data);
}

export default function MapView({ airports, routes = [], selectedAirport, sourceMode, providerMode, onSelect }) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const animationRef = useRef(null);
  const airportsByCodeRef = useRef(new Map());
  const onSelectRef = useRef(onSelect);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [viewMode, setViewMode] = useState('status');

  const routeDegree = useMemo(() => buildRouteDegree(routes), [routes]);
  const airportsByCode = useMemo(
    () => new Map((airports || []).map(airport => [airport.iata, airport])),
    [airports],
  );
  const connectedCodes = useMemo(
    () => connectedCodesForAirport(selectedAirport, routes),
    [selectedAirport, routes],
  );
  const airportFeatureCollection = useMemo(
    () => makeAirportFeatureCollection({
      airports: airports || [],
      selectedAirport,
      connectedCodes,
      routeDegree,
      mode: viewMode,
    }),
    [airports, selectedAirport, connectedCodes, routeDegree, viewMode],
  );
  const routeFeatureCollection = useMemo(
    () => makeRouteFeatureCollection({
      airportsByCode,
      routes,
      selectedAirport,
      connectedCodes,
      mode: viewMode,
    }),
    [airportsByCode, routes, selectedAirport, connectedCodes, viewMode],
  );

  useEffect(() => {
    airportsByCodeRef.current = airportsByCode;
  }, [airportsByCode]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: darkGlobeStyle,
      center: [-98.5, 40],
      zoom: 3.05,
      minZoom: 2,
      maxZoom: 9,
      pitch: 28,
      bearing: -8,
      projection: 'globe',
      attributionControl: false,
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      map.setProjection?.({ type: 'globe' });
      map.setSky?.({
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.2],
      });

      map.addSource('airport-routes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        lineMetrics: true,
      });
      map.addSource('airports', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        promoteId: 'code',
      });

      map.addLayer({
        id: 'route-arcs',
        type: 'line',
        source: 'airport-routes',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-gradient': routeLineGradientExpression(viewMode),
          'line-width': ['interpolate', ['linear'], ['get', 'importance'], 1, 1.2, 8, 4.2],
          'line-opacity': 0.42,
        },
      });

      map.addLayer({
        id: 'route-pulse',
        type: 'line',
        source: 'airport-routes',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#d7ebff',
          'line-width': ['interpolate', ['linear'], ['get', 'importance'], 1, 1, 8, 3.2],
          'line-opacity': 0.52,
          'line-dasharray': [0, 3, 1.4],
        },
      });

      map.addLayer({
        id: 'airport-glow',
        type: 'circle',
        source: 'airports',
        paint: {
          'circle-radius': [
            'case',
            ['get', 'selected'],
            ['+', ['interpolate', ['linear'], ['get', 'connectivity'], 0, 13, 14, 28], 9],
            ['get', 'connected'],
            ['+', ['interpolate', ['linear'], ['get', 'connectivity'], 0, 10, 14, 23], 6],
            0,
          ],
          'circle-color': '#d7ebff',
          'circle-opacity': [
            'case',
            ['get', 'selected'],
            0.28,
            ['get', 'connected'],
            0.16,
            0,
          ],
          'circle-blur': 0.55,
        },
      });

      map.addLayer({
        id: 'airport-points',
        type: 'circle',
        source: 'airports',
        paint: {
          'circle-radius': [
            'case',
            ['get', 'selected'],
            ['+', ['interpolate', ['linear'], ['get', 'connectivity'], 0, 7, 14, 15], 5],
            ['interpolate', ['linear'], ['get', 'connectivity'], 0, 5, 14, 13],
          ],
          'circle-color': airportCircleColorExpression(viewMode),
          'circle-stroke-color': [
            'case',
            ['get', 'selected'],
            '#f8fbff',
            ['get', 'connected'],
            '#a7d8ff',
            '#07101a',
          ],
          'circle-stroke-width': [
            'case',
            ['get', 'selected'],
            4,
            ['get', 'connected'],
            2.4,
            ['get', 'isHub'],
            1.6,
            0.9,
          ],
          'circle-opacity': ['case', ['get', 'dim'], 0.18, 0.92],
          'circle-stroke-opacity': ['case', ['get', 'dim'], 0.25, 0.95],
        },
      });

      map.addLayer({
        id: 'airport-labels',
        type: 'symbol',
        source: 'airports',
        layout: {
          'text-field': ['get', 'code'],
          'text-font': ['Open Sans Semibold'],
          'text-size': ['case', ['get', 'selected'], 13, ['get', 'isHub'], 11, 9],
          'text-offset': [0, 1.4],
          'text-allow-overlap': false,
          'text-ignore-placement': false,
        },
        paint: {
          'text-color': ['case', ['get', 'dim'], '#53677f', '#dce9f8'],
          'text-halo-color': '#050a11',
          'text-halo-width': 1.4,
        },
      });

      map.on('click', 'airport-points', event => {
        const feature = event.features?.[0];
        if (!feature) return;
        const airport = airportsByCodeRef.current.get(feature.properties.code);
        if (airport) onSelectRef.current(airport);
      });

      map.on('mouseenter', 'airport-points', event => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = event.features?.[0];
        if (!feature) return;
        const coordinates = feature.geometry.coordinates.slice();
        const props = feature.properties;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
          className: 'airport-maplibre-popup',
        })
          .setLngLat(coordinates)
          .setHTML(`
            <strong>${props.code} · ${props.name}</strong>
            <span>${props.status}</span>
            <small>Delay: ${props.delay || 0} min · Connectivity: ${props.connectivity || 0}</small>
          `)
          .addTo(map);
      });

      map.on('mouseleave', 'airport-points', () => {
        map.getCanvas().style.cursor = '';
        popupRef.current?.remove();
      });

      setMapLoaded(true);
    });

    return () => {
      cancelAnimationFrame(animationRef.current);
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    setSourceData(map, 'airports', airportFeatureCollection);
    setSourceData(map, 'airport-routes', routeFeatureCollection);
    if (map.getLayer('airport-points')) {
      map.setPaintProperty('airport-points', 'circle-color', airportCircleColorExpression(viewMode));
    }
    if (map.getLayer('route-arcs')) {
      map.setPaintProperty('route-arcs', 'line-gradient', routeLineGradientExpression(viewMode));
    }
  }, [airportFeatureCollection, routeFeatureCollection, mapLoaded, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !selectedAirport) return;
    const coordinates = normalizeLngLat(selectedAirport);
    if (!coordinates) return;
    map.flyTo({
      center: coordinates,
      zoom: Math.max(map.getZoom(), 4.9),
      pitch: viewMode === 'status' ? 28 : 42,
      bearing: viewMode === 'status' ? map.getBearing() : -18,
      speed: 0.85,
      curve: 1.35,
      essential: true,
    });
  }, [selectedAirport, viewMode, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return undefined;
    cancelAnimationFrame(animationRef.current);

    if (viewMode === 'status') {
      map.setPaintProperty('route-pulse', 'line-opacity', 0);
      return undefined;
    }

    let frame = 0;
    const animate = () => {
      frame = (frame + 1) % 120;
      const offset = Number((frame / 30).toFixed(2));
      if (map.getLayer('route-pulse')) {
        map.setPaintProperty('route-pulse', 'line-opacity', viewMode === 'propagation' ? 0.68 : 0.48);
        map.setPaintProperty('route-pulse', 'line-dasharray', [offset, 2.4, 1.2]);
      }
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => cancelAnimationFrame(animationRef.current);
  }, [viewMode, mapLoaded]);

  const selectedHasElevatedRisk = isElevatedRisk(selectedAirport);
  const selectedConnectivity = selectedAirport ? getConnectivity(selectedAirport, routeDegree) : 0;
  const mapTitle = sourceMode === 'live'
    ? providerMode === 'flightaware'
      ? 'Live FAA + FlightAware Operational Metrics'
      : 'Live FAA Advisory + Estimated Operational Metrics'
    : 'Sample Airport Operational Risk';

  return (
    <div className="map-wrapper">
      <div className="map-overlay">
        <div>
          <span className="section-kicker">MapLibre GL · Globe</span>
          <strong>{mapTitle}</strong>
          <small>
            {viewMode === 'status' && (providerMode === 'flightaware'
              ? 'Airport Status mode shows provider-backed operational conditions.'
              : 'Airport Status mode combines live FAA advisory context with estimated operational metrics.')}
            {viewMode === 'hub' && `${selectedAirport?.iata || 'Hub'} network mode highlights connected airports and outbound arcs.`}
            {viewMode === 'propagation' && (selectedHasElevatedRisk
              ? `${selectedAirport?.iata} propagation view shows estimated downstream exposure.`
              : 'Propagation view distinguishes static exposure from active disruption signals.')}
          </small>
        </div>
        <div className="map-controls">
          <div className="map-mode-toggle" aria-label="Map visualization mode">
            {modeOptions.map(option => (
              <button
                key={option.id}
                type="button"
                className={viewMode === option.id ? 'active' : ''}
                onClick={() => setViewMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="legend">
            <span><i className="legend-swatch swatch-green" />Normal</span>
            <span><i className="legend-swatch swatch-yellow" />Minor</span>
            <span><i className="legend-swatch swatch-orange" />Moderate</span>
            <span><i className="legend-swatch swatch-red" />Severe</span>
          </div>
        </div>
      </div>
      <div className="map-status-panel">
        <span>{selectedAirport?.iata || 'U.S.'}</span>
        <strong>{selectedAirport?.name || 'North America aviation network'}</strong>
        <small>
          Connectivity {selectedConnectivity} · {viewMode === 'propagation' ? 'Exposure gradient' : 'Great-circle routes'}
        </small>
      </div>
      <div className="maplibre-container" ref={mapContainerRef} />
    </div>
  );
}
