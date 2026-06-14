const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Load environment variables
dotenv.config();

// OBSERVABILITY: Structured logger and circuit breaker (must load before everything else)
const { logger } = require('./config/logger');
const { getAllStatus } = require('./config/circuitBreaker');

// V3 ENTERPRISE ADDITIONS
const { degradedMode } = require('./config/degradedMode');
const { degradedModeMiddleware, systemStatusHandler } = require('./middleware/degradedModeMiddleware');
const { apiVersioning, getFeatureFlags } = require('./middleware/apiVersioning');
const { telemetry } = require('./modules/telemetry/collector');
const telemetryRoutes = require('./modules/telemetry/routes');
const { jobQueue } = require('./config/jobQueue');
const { registerWorkers } = require('./modules/workers/processors');
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');
const { validateConfig } = require('./config/configValidator');
const { eventBus } = require('./config/eventBus');

// V8 ENTERPRISE OBSERVABILITY
const { sentry, sentryErrorHandler: sentryErrorMiddleware } = require('./config/sentry');
const { alertEngine } = require('./config/alerting');
const { enhancedTracing } = require('./config/opentelemetry');

// Import routes
const authRoutes = require('./modules/auth/routes');
const attendanceRoutes = require('./modules/attendance/routes');
const leaveRoutes = require('./modules/leave/routes');
const workReportRoutes = require('./modules/work-report/routes');
const reportsRoutes = require('./modules/reports/routes');
const excelRoutes = require('./modules/excel-processing/routes');
const notificationRoutes = require('./modules/notification/routes');
const geofenceRoutes = require('./modules/geofence/routes');
const securityRoutes = require('./modules/security-monitoring/routes');
const mfaRoutes = require('./modules/auth/mfaRoutes');
const adminRoutes = require('./modules/admin/routes');
const locationRoutes = require('./modules/locations/routes');
const faceManagementRoutes = require('./modules/face-management/routes');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { authenticateToken } = require('./middleware/authMiddleware');
const { logRequest } = require('./middleware/loggingMiddleware');
const { correlationId } = require('./middleware/correlationId');
const { requireRole, getPermissionsForRole } = require('./middleware/rbac');
const { requestTimeout } = require('./middleware/requestTimeout');
const { securityHeaders } = require('./middleware/securityHeaders');
const { attachRedisAdapter } = require('./config/redisAdapter');
const { distributedLock } = require('./config/distributedLock');

// Import database and Redis
const { connectDB, isDatabaseHealthy, pool } = require('./config/database');
const { connectRedis, isRedisHealthy, disconnectRedis } = require('./config/redis');
const { runMigrations } = require('./migrations/runMigrations');

// Import WebSocket handlers
const { setupWebSocket } = require('./modules/notification/websocket');

// ────────────────────────────────────────────────────────────────
// RESILIENCE: asyncHandler — wraps async route handlers so any thrown
// error is forwarded to the Express error handler instead of hanging.
// ────────────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
const httpServer = createServer(app);

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
});

// STABILIZATION: Expose io instance to Express routes (e.g., attendance routes
// use req.app.get('io') to emit WebSocket events after check-in/check-out).
app.set('io', io);

// V6: Rate limiter created via factory (see middleware/rateLimiter.js)
// authLimiter and apiLimiter imported above

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.FACE_AI_SERVICE_URL || 'http://localhost:5000']
    }
  }
}));

// V7: Enterprise security headers (HSTS, X-Content-Type-Options, Permissions-Policy)
app.use(securityHeaders());

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// V6: Request correlation IDs for distributed tracing
app.use(correlationId);

// V6: Distributed tracing middleware (W3C Trace Context)
app.use(enhancedTracing.middleware());

// Request logging
app.use(logRequest);

// V6: Global API rate limit
app.use('/api', apiLimiter);

// V7: Request timeout (30s default, 120s for uploads)
app.use(requestTimeout(30000));
app.use('/api/excel', requestTimeout(120000));
app.use('/api/auth/mfa/enroll', requestTimeout(10000));

// V3: API versioning, degraded-mode state injection, and telemetry recording
app.use(apiVersioning());
app.use(degradedModeMiddleware);
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    telemetry.recordRequest(req.method, req.url, res.statusCode, Date.now() - start);
  });
  next();
});

// Public routes (no authentication required)
app.use('/api/auth', authLimiter, authRoutes);

// Protected routes (require authentication)
app.use('/api/attendance', authenticateToken, attendanceRoutes);
app.use('/api/leave', authenticateToken, leaveRoutes);
app.use('/api/reports', authenticateToken, reportsRoutes);
app.use('/api/work-report', authenticateToken, workReportRoutes);
app.use('/api/excel', authenticateToken, excelRoutes);
app.use('/api/geofence', authenticateToken, geofenceRoutes);
app.use('/api/notifications', authenticateToken, notificationRoutes);
app.use('/api/security', authenticateToken, securityRoutes);

// ADMIN MANAGEMENT ROUTES
app.use('/api/admin', authenticateToken, adminRoutes);

// LOCATION MANAGEMENT ROUTES
app.use('/api/locations', authenticateToken, locationRoutes);

// V5: MFA routes (auth required)
app.use('/api/auth/mfa', authenticateToken, mfaRoutes);

// FACE MANAGEMENT & APPROVAL ROUTES
app.use('/api', faceManagementRoutes);

// V3: Telemetry and system status endpoints
app.use('/api/telemetry', authenticateToken, telemetryRoutes);
app.get('/api/system/status', systemStatusHandler);
app.get('/api/system/features', authenticateToken, (req, res) => {
  res.json({ features: getFeatureFlags() });
});

// V5: Job queue stats endpoint
app.get('/api/system/queue', authenticateToken, requireRole('supervisor'), (req, res) => {
  res.json({ queue: jobQueue.getStats() });
});

// V6: User permissions endpoint (for frontend UI gating)
app.get('/api/system/permissions', authenticateToken, (req, res) => {
  res.json({ permissions: getPermissionsForRole(req.user.role) });
});

// V6: Tracing stats endpoint
app.get('/api/system/traces', authenticateToken, requireRole('supervisor'), (req, res) => {
  res.json({ tracing: enhancedTracing.getStats() });
});

// V8: Frontend error telemetry forwarding endpoint
// The frontend logger (utils/logger.ts) sends errors/warnings here for centralized monitoring.
function frontendErrorHandler(req, res) {
  const entry = req.body;
  if (entry && entry.level && entry.message) {
    logger.warn('[Frontend Error]', {
      level: entry.level,
      message: entry.message,
      timestamp: entry.timestamp,
      service: entry.service || 'frontend',
      ...Object.fromEntries(
        Object.entries(entry).filter(([k]) => !['level', 'message', 'timestamp', 'service'].includes(k))
      ),
    });
  }
  res.status(204).end();
}

app.post('/api/dev/frontend-error', frontendErrorHandler);
app.post('/api/api/dev/frontend-error', frontendErrorHandler);

// V8: Prometheus metrics endpoint (unauthenticated for scraper access)
// Full metrics from the Prometheus registry + collector
const { getPrometheusCollector } = require('./modules/prometheus/metrics-collector');
app.get('/metrics', (req, res) => {
  try {
    const collector = getPrometheusCollector();
    const metricsText = collector.getMetricsText();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(metricsText);
  } catch (error) {
    logger.error('Prometheus metrics endpoint error', { error: error.message });
    res.status(500).send('# Error generating metrics\n');
  }
});

// V8: Authenticated Prometheus JSON metrics endpoint
app.get('/api/telemetry/prometheus', authenticateToken, requireRole('supervisor'), (req, res) => {
  try {
    const collector = getPrometheusCollector();
    res.json({
      success: true,
      format: req.query.format === 'text' ? 'prometheus' : 'json',
      metrics: req.query.format === 'text' ? collector.getMetricsText() : collector.getMetricsJSON(),
    });
  } catch (error) {
    logger.error('Prometheus JSON metrics error', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to collect metrics' });
  }
});

// WebSocket setup
setupWebSocket(io);

// V5: Register background job queue workers
registerWorkers(io);

// Dynamic AI service health probe
async function checkAiServiceHealthy() {
  const aiUrl = process.env.FACE_AI_SERVICE_URL || 'http://localhost:8000';
  try {
    const http = require('http');
    return await new Promise((resolve) => {
      const req = http.get(`${aiUrl}/health`, { timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}

// Real health check — probes DB, Redis, and includes circuit breaker states
app.get('/health', asyncHandler(async (req, res) => {
  const [dbOk, redisOk, aiOk] = await Promise.all([
    isDatabaseHealthy(),
    isRedisHealthy(),
    checkAiServiceHealthy(),
  ]);

  // V3: Update degraded-mode manager based on health probes
  if (!dbOk) degradedMode.setDegraded('database', 'Health probe failed');
  else degradedMode.setHealthy('database');
  if (!redisOk) degradedMode.setDegraded('redis', 'Health probe failed');
  else degradedMode.setHealthy('redis');
  if (!aiOk) degradedMode.setDegraded('ai-service', 'Health probe failed');
  else degradedMode.setHealthy('ai-service');

  const degradedStatus = degradedMode.getStatus();
  const status     = degradedStatus.overall;
  const httpStatus = dbOk ? 200 : 503;

  res.status(httpStatus).json({
    status,
    timestamp: new Date().toISOString(),
    version: require('../package.json').version || '1.0.0',
    services: {
      database: dbOk    ? 'connected' : 'unavailable',
      redis:    redisOk ? 'connected' : 'unavailable (degraded mode)',
      'ai-service': aiOk  ? 'connected' : 'unavailable (degraded mode)',
    },
    circuitBreakers: getAllStatus(),
    degradedMode: degradedStatus,
    queue: jobQueue.getStats(),
    locks: distributedLock.getStats(),
    tracing: { total: enhancedTracing.getStats().total, errors: enhancedTracing.getStats().errors },
    eventBus: eventBus.getStats(),
    uptime: process.uptime(),
  });
}));

// V8: Sentry error handler (must be before custom errorHandler)
app.use(sentryErrorMiddleware());

// Error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Initialize connections and start server
async function startServer() {
  try {
    // V8: Validate configuration before anything else
    validateConfig();

    // DB is required — fail fast if unavailable
    await connectDB();
    logger.info('Database connected successfully');

    if (process.env.RUN_MIGRATIONS !== 'false') {
      await runMigrations();
    }

    // Redis is non-fatal — server runs in degraded mode if Redis is down
    const redisOk = await connectRedis();
    if (!redisOk) {
      logger.warn('Server starting without Redis — rate limiting uses in-memory fallback, token blacklisting inactive.');
    }

    // Start server
    httpServer.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        cors: process.env.FRONTEND_URL || 'http://localhost:3000',
        observability: {
          logging:            'ENABLED',
          circuitBreakers:    'ACTIVE',
          rateLimitFallback:  'ACTIVE',
          degradedMode:       'ACTIVE',
          telemetry:          'ACTIVE',
          apiVersioning:      'ACTIVE',
          featureFlags:       'ACTIVE',
          tracing:            'ACTIVE',
          opentelemetry:      enhancedTracing.isOTelActive() ? 'ACTIVE' : 'BUILT-IN',
          sentry:             sentry.isActive() ? 'ACTIVE' : 'DISABLED',
          alerting:           'ACTIVE',
          correlationId:      'ACTIVE',
          rbac:               'ACTIVE',
          requestTimeout:     'ACTIVE',
          securityHeaders:    'ACTIVE',
        }
      });

      // STABILIZATION: Start the job queue — was never called before,
      // meaning background jobs (notifications, analytics, etc.) never processed.
      jobQueue.start();
      logger.info('[Startup] Job queue started.');

      // V8: Start alert engine for health monitoring
      alertEngine.start();
      logger.info('[Startup] Alert engine started.');
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// V5: Startup warmup — probe AI service readiness
async function warmupServices() {
  const aiUrl = process.env.FACE_AI_SERVICE_URL || 'http://localhost:8000';
  for (let i = 1; i <= 3; i++) {
    try {
      const http = require('http');
      const success = await new Promise((resolve) => {
        const req = http.get(`${aiUrl}/health`, { timeout: 3000 }, (res) => {
          if (res.statusCode === 200) {
            logger.info('[Warmup] AI service is ready');
            degradedMode.setHealthy('ai-service');
            resolve(true);
          } else {
            resolve(false);
          }
        });
        req.on('error', () => {
          resolve(false);
        });
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });

      if (success) {
        break;
      }

      if (i === 3) {
        degradedMode.setDegraded('ai-service', 'Warmup health probe failed after 3 attempts');
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (err) {
      if (i === 3) degradedMode.setDegraded('ai-service', `Warmup error: ${err.message}`);
      else await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ────────────────────────────────────────────────────────────────
// OBSERVABILITY: Global unhandled error safety nets — structured logging
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception — server will NOT crash', {
    error: error.message, stack: error.stack
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

// ────────────────────────────────────────────────────────────────
// Graceful shutdown — close DB and Redis connections cleanly
// ────────────────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  // V8: Stop AlertEngine
  try {
    alertEngine.stop();
    logger.info('[Shutdown] Alert engine stopped.');
  } catch (e) { logger.warn('[Shutdown] Alert engine stop error', { error: e.message }); }

  // V5: Drain job queue first
  try {
    await jobQueue.drain(5000);
    logger.info('[Shutdown] Job queue drained.');
  } catch (e) { logger.warn('[Shutdown] Job queue drain error', { error: e.message }); }

  // V8: Flush Sentry events
  try {
    await sentry.flush(2000);
    logger.info('[Shutdown] Sentry flushed.');
  } catch (e) { logger.warn('[Shutdown] Sentry flush error', { error: e.message }); }

  httpServer.close(async () => {
    try {
      await pool.end();
      logger.info('[Shutdown] DB pool closed.');
    } catch (e) { /* ignore */ }
    try {
      await disconnectRedis();
      logger.info('[Shutdown] Redis client closed.');
    } catch (e) { /* ignore */ }
    logger.info('Server closed.');
    process.exit(0);
  });
  // Force exit after 15s if clean shutdown stalls
  setTimeout(() => {
    logger.error('[Shutdown] Forced exit after timeout.');
    process.exit(1);
  }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer().then(() => warmupServices());

module.exports = { app, io, asyncHandler };
