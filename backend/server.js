import express from 'express';
import cors from 'cors';
import statusRouter from './routes/status.js';
import {
  getFlightRiskAssessment,
  getLatestStatus,
  getProviderDiagnostics,
  startStatusRefresh,
} from './services/statusService.js';

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_ALLOWED_ORIGINS = [
  'https://yuhexin25.github.io',
  'https://yuhexin25-oss.github.io',
  'http://localhost:5173',
];
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
}));
app.use(express.json());
app.use('/api/status', statusRouter);

app.get('/api/dashboard', (req, res) => {
  res.json(getLatestStatus());
});

app.get('/api/flight-risk/:flightNumber', async (req, res, next) => {
  try {
    res.json(await getFlightRiskAssessment(req.params.flightNumber));
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', (req, res) => {
  const status = getLatestStatus();
  res.json({
    ok: true,
    service: 'hub-resilience-monitor-backend',
    sourceMode: status.sourceMode,
    sourceLabel: status.sourceLabel,
    providerMode: status.providerMode,
    dataProvider: status.dataProvider || status.providerMode,
    flightAwareApiKeyConfigured: status.flightAwareApiKeyConfigured,
    isFlightAwareActive: status.isFlightAwareActive,
    faaUpdatedAt: status.faaUpdatedAt,
    fetchedAt: status.fetchedAt,
  });
});

app.get('/api/provider-test', (req, res) => {
  res.json(getProviderDiagnostics());
});

app.get('/', (req, res) => {
  res.json({
    message: 'Hub Resilience Monitor backend is running.',
    healthEndpoint: '/api/health',
    statusEndpoint: '/api/status',
    providerTestEndpoint: '/api/provider-test',
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `No API route exists for ${req.method} ${req.originalUrl}`,
  });
});

app.use((error, req, res, next) => {
  console.error('[server]', error.message);
  res.status(error.message === 'Origin is not allowed by CORS' ? 403 : 500).json({
    error: error.message === 'Origin is not allowed by CORS' ? 'CORS Forbidden' : 'Internal Server Error',
    message: error.message,
  });
});

await startStatusRefresh();

app.listen(PORT, () => {
  console.log(`Hub Resilience Monitor backend listening on port ${PORT}`);
});
