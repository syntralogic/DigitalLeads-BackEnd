import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import session from 'express-session';
import RedisStore from 'connect-redis';
import rateLimit from 'express-rate-limit';
import { redis } from './config/redis';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/logger';
import { authenticate } from './middleware/auth';

// Import routes
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import networkRoutes from './routes/networks';
import offerRoutes from './routes/offers';
import clickRoutes from './routes/clicks';
import conversionRoutes from './routes/conversions';
import analyticsRoutes from './routes/analytics';
import fraudRoutes from './routes/fraud';
import deviceRoutes from './routes/devices';
import geoRoutes from './routes/geo';
import routingRoutes from './routes/routing';
import postbackRoutes from './routes/postback';
import domainRoutes from './routes/domains';
import notificationRoutes from './routes/notifications';
import aiRoutes from './routes/ai';
import settingsRoutes from './routes/settings';
import auditRoutes from './routes/audit';
import searchRoutes from './routes/search';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(compression());

// CORS
app.use(cors({
  origin: true, // Allows all origins in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Page-Size'],
}));

// Session with Redis
const redisStore = new RedisStore({
  client: redis,
  prefix: 'session:',
});

app.use(session({
  store: redisStore,
  secret: process.env.SESSION_SECRET || 'session-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: Number(process.env.SESSION_MAX_AGE) || 86400000, // 24 hours
    sameSite: 'lax',
  },
  name: 'digitalleads.sid',
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: (Number(process.env.RATE_LIMIT_WINDOW) || 1) * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 1000,
  message: {
    error: 'Too many requests',
    message: 'Please try again later.',
    retryAfter: Math.ceil((Number(process.env.RATE_LIMIT_WINDOW) || 1) * 60),
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (_req) => process.env.NODE_ENV === 'development',
});

app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version,
  });
});

// API routes
const apiPrefix = '/api';

// ============================================
// PUBLIC ROUTES - No authentication required
// ============================================
app.use(`${apiPrefix}/auth`, authRoutes);

// ✅ Click tracking is PUBLIC - NO AUTH needed
app.use(`${apiPrefix}/clicks`, clickRoutes);

// ✅ REMOVED: Offer preview is now handled in frontend
// The preview route is now at /offers/preview/:id in the frontend

// ============================================
// PROTECTED ROUTES - Require authentication
// ============================================
app.use(`${apiPrefix}/offers`, authenticate, offerRoutes);
app.use(`${apiPrefix}/dashboard`, authenticate, dashboardRoutes);
app.use(`${apiPrefix}/networks`, authenticate, networkRoutes);
app.use(`${apiPrefix}/conversions`, authenticate, conversionRoutes);
app.use(`${apiPrefix}/analytics`, authenticate, analyticsRoutes);
app.use(`${apiPrefix}/fraud`, authenticate, fraudRoutes);
app.use(`${apiPrefix}/devices`, authenticate, deviceRoutes);
app.use(`${apiPrefix}/geo`, authenticate, geoRoutes);
app.use(`${apiPrefix}/routing`, authenticate, routingRoutes);
app.use(`${apiPrefix}/postbacks`, authenticate, postbackRoutes);
app.use(`${apiPrefix}/postback`, authenticate, postbackRoutes);
app.use(`${apiPrefix}/domains`, authenticate, domainRoutes);
app.use(`${apiPrefix}/notifications`, authenticate, notificationRoutes);
app.use(`${apiPrefix}/ai`, authenticate, aiRoutes);
app.use(`${apiPrefix}/settings`, authenticate, settingsRoutes);
app.use(`${apiPrefix}/audit`, authenticate, auditRoutes);
app.use(`${apiPrefix}/search`, authenticate, searchRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handling
app.use(errorHandler);

export default app;