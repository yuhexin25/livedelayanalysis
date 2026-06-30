# Hub Resilience Monitor

Hub Resilience Monitor is a **Real-Time Airport and Flight Delay Risk Platform** for GIS and aviation analytics portfolios. It combines operational delay metrics, supplemental FAA airport advisories, static route network data, and estimated network impact scoring to explore delay propagation, hub vulnerability, and airport network resilience.

**Live dashboard:** <https://yuhexin25.github.io/livedelayanalysis/>

The dashboard is explicit about provenance:

- **Operational delay metrics** drive severity and Hub Impact Score.
- **FAA airport advisories** are supplemental context for ground stops, ground delay programs, and operational awareness.
- **Static route network data** is stored locally in `data/`.
- **Hub Impact Score and Route Risk Score** are analytical estimates, not FAA metrics or confirmed flight-delay forecasts.
- **Fallback status data** is clearly labeled as sample data and is never presented as live.

The project no longer uses FAA NOTAM-style keyword matching such as `CLSD`, `RWY CLSD`, or `AP CLSD` as the primary disruption signal.

GitHub Pages hosts only the static React frontend. It does not run the Node.js/Express backend. Without a separately deployed backend URL, the dashboard automatically operates in clearly labeled sample data mode.

## Features

- Welcome and methodology overview
- Live airport operational risk globe using MapLibre GL JS
- Route Delay Risk Analyzer for origin/destination airport pairs
- Top elevated-risk airports ranking
- Major hub vulnerability and connectivity analysis
- Estimated Hub Impact Score with Low / Moderate / High / Critical classes
- D3-based hub network exposure visualization
- Airport detail panel with operational metrics and supplemental FAA advisory text
- Five-minute backend cache and sample fallback data

Major hubs monitored: ATL, ORD, DFW, DEN, LAX, JFK, EWR, SFO, SEA, CLT, PHX, IAH, LAS, and MIA.

## Project Structure

```text
backend/   Node.js and Express API
backend/data/  Static data bundled with the Render backend
frontend/  React and Vite dashboard
data/      Local airport, route, and fallback status JSON
```

## Install

Node.js 18 or newer is required.

```bash
cd backend
npm install

cd ../frontend
npm install
```

## Run the Backend

```bash
cd backend
npm start
```

The backend listens on `http://localhost:3000` and exposes:

- `GET /` health message
- `GET /api/health` JSON health and latest FAA source metadata
- `GET /api/status` normalized dashboard JSON
- Optional `GET /api/flight-risk/:flightNumber` lookup for future provider-backed integrations; it does not generate synthetic flight routes when FlightAware is inactive
- `GET /api/provider-test` active provider diagnostics

All backend routes, including errors and unknown routes, return JSON rather than HTML.

For development with automatic restarts:

```bash
npm run dev
```

## Run the Frontend

```bash
cd frontend
npm run dev
```

Vite runs at `http://localhost:5173`. To connect it to a local or deployed backend, create `frontend/.env.local`:

```text
VITE_API_BASE_URL=http://localhost:3000
```

If `VITE_API_BASE_URL` is empty, invalid, unavailable, or returns non-JSON content, the frontend loads its local sample data instead of making a relative backend request.

Build the static frontend with:

```bash
npm run build
```

## Tests

```bash
cd backend
npm test
```

The backend tests cover FAA advisory parsing as supplemental data and operational hub impact behavior.

## Data Sources

- FlightAware AeroAPI-ready provider abstraction: `backend/services/flightDataProvider.js`
- FAA live airport status API, used as supplemental advisory context: <https://nasstatus.faa.gov/api/airport-status-information>
- Local airport metadata: `data/airports.json`
- Local static route network: `data/routes.json`
- Sample fallback operational status: `data/fallback_status.json`
- GitHub Pages frontend fallback assets: `frontend/public/data/`

FlightAware remains optional. The main user experience is the Route Delay Risk Analyzer and does not require paid flight tracking. If enabled, FlightAware integration uses:

- Airport operational metrics: `GET https://aeroapi.flightaware.com/aeroapi/airports/{ICAO}/flights`
- Flight number lookup: `GET https://aeroapi.flightaware.com/aeroapi/flights/{ident}`

A FlightAware AeroAPI key is required. Set it on the backend as:

```text
FLIGHTAWARE_API_KEY=your_flightaware_aeroapi_key
```

The backend sends this key in the `x-apikey` request header. If `FLIGHTAWARE_API_KEY` is missing, invalid, or FlightAware calls fail, the backend keeps using airport-level live/estimated operational mode and does not claim FlightAware data. It also does not infer fake flight-number routes.

Provider verification endpoints:

```text
GET /api/health
GET /api/provider-test
```

`providerMode` and `dataProvider` are set to `flightaware` only when FlightAware AeroAPI data is actually active. Otherwise they remain `estimated-operational-metrics`.

FAA data describes airport operational advisories, not every individual flight. Route connections model potential downstream exposure and do not prove that a connected airport or flight is delayed.

## Hub Impact Score

The estimated score is calculated for major hubs:

```text
hub_impact_score =
  departure_delay_minutes * 0.4 +
  arrival_delay_minutes * 0.2 +
  cancellation_rate * 200 +
  connected_airports * 0.8 +
  ground_stop_bonus
```

Classification:

- `0-25` = Low
- `25-50` = Moderate
- `50-75` = High
- `75+` = Critical

`connected_airports` is the hub's degree in the static route network. FAA ground stops can add a ground stop bonus, but raw FAA advisory text is not treated as a primary airport-closure signal.

## Deployment

### Render Backend

GitHub Pages cannot run the backend. Deploy `backend/` separately on Render, Railway, or another Node.js hosting service. For Render, create a Web Service rooted at `backend/`:

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Render supplies the `PORT` environment variable automatically.

The repository also includes `render.yaml` for a Render Blueprint named `livedelayanalysis-backend`. The backend allows browser requests from:

```text
https://yuhexin25.github.io
https://yuhexin25-oss.github.io
```

Additional frontend origins can be added with the comma-separated `CORS_ALLOWED_ORIGINS` environment variable.

To create the service from the Blueprint:

1. Open the Render Dashboard.
2. Select `New → Blueprint`.
3. Connect the `yuhexin25-oss/livedelayanalysis` repository.
4. Keep the Blueprint path as `render.yaml` and deploy the Blueprint.

After Render deploys the service, verify that these URLs return JSON:

```text
https://livedelayanalysis-backend.onrender.com/api/health
https://livedelayanalysis-backend.onrender.com/api/status
https://livedelayanalysis-backend.onrender.com/api/dashboard
https://livedelayanalysis-backend.onrender.com/api/provider-test
```

To add the FlightAware AeroAPI key in Render:

1. Open the Render Dashboard.
2. Select the `livedelayanalysis-backend` Web Service.
3. Open `Environment`.
4. Click `Add Environment Variable`.
5. Set `Key` to `FLIGHTAWARE_API_KEY`.
6. Set `Value` to your FlightAware AeroAPI key.
7. Save changes.
8. Trigger a manual deploy or wait for Render to redeploy.
9. Open `/api/provider-test` and confirm `dataProvider` is `flightaware`.

### GitHub Pages Frontend

The repository includes `.github/workflows/deploy.yml`, which builds the app inside `frontend/` and deploys only `frontend/dist/` to GitHub Pages. The Vite base path is fixed to `/livedelayanalysis/` so JavaScript, CSS, and other generated asset URLs work at the project Pages URL.

The deployed frontend remains usable without a backend. In that case it loads:

```text
/livedelayanalysis/data/fallback-status.json
/livedelayanalysis/data/airports.json
/livedelayanalysis/data/routes.json
```

and displays `Sample Data Mode` plus `Using sample fallback data — backend not connected`.

In the GitHub repository, change:

```text
Settings → Pages → Build and deployment → Source → GitHub Actions
```

To connect the deployed frontend to the Render backend, add a repository Actions variable:

```text
Settings → Secrets and variables → Actions → Variables → New repository variable
Name: VITE_API_BASE_URL
Value: https://livedelayanalysis-backend.onrender.com
```

The GitHub Pages workflow also sets this backend URL directly while building the frontend. When `/api/status` reports `sourceMode: "live"`, the dashboard badge displays `Live FAA Backend Connected`.
