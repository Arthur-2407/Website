const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Load environment variables
dotenv.config({ path: './config.env' });

// SECURITY: Hard guard — development server MUST NOT run in production
if (process.env.NODE_ENV === 'production') {
  console.error('CRITICAL SECURITY ERROR: dev-server.js must not be run in production!');
  console.error('Use `node src/server.js` instead.');
  process.exit(1);
}

// Mock database and Redis connections for development
const mockConnectDB = async () => {
  console.log('✅ Mock database connection (development mode)');
  return true;
};

const mockConnectRedis = async () => {
  console.log('✅ Mock Redis connection (development mode)');
  return true;
};

// Import mock routes for development
const {
  authRoutes,
  attendanceRoutes,
  leaveRoutes,
  workReportRoutes,
  excelRoutes,
  geofenceRoutes,
  securityRoutes,
  notificationRoutes
} = require('./mock-routes');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { authenticateToken } = require('./middleware/authMiddleware');
const { logRequest } = require('./middleware/loggingMiddleware');

// Import WebSocket handlers
const { setupWebSocket } = require('./modules/notification/websocket');

const app = express();
const httpServer = createServer(app);

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true
  }
});

// Global rate limiter
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again after a minute',
  standardHeaders: true,
  legacyHeaders: false,
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", process.env.FACE_AI_SERVICE_URL || 'http://localhost:8000']
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(logRequest);

// Public routes (no authentication required)
app.use('/api/auth', authLimiter, authRoutes);

// Protected routes (require authentication)
app.use('/api/attendance', authenticateToken, attendanceRoutes);
app.use('/api/leave', authenticateToken, leaveRoutes);
app.use('/api/work-report', authenticateToken, workReportRoutes);
app.use('/api/excel', authenticateToken, excelRoutes);
app.use('/api/geofence', authenticateToken, geofenceRoutes);
app.use('/api/security', authenticateToken, securityRoutes);

// WebSocket setup
setupWebSocket(io);

// Health check endpoint
const healthHandler = (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    mode: 'development',
    services: {
      database: 'mocked',
      redis: 'mocked',
      face_ai_service: 'not connected'
    }
  });
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Real-time Frontend Error Logger
app.post('/api/dev/frontend-error', (req, res) => {
  const errorDetails = req.body;
  const fs = require('fs');
  const path = require('path');
  
  const logDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const logFile = path.join(logDir, 'frontend-errors.log');
  const logEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...errorDetails
  }) + '\n';
  
  try {
    fs.appendFileSync(logFile, logEntry);
  } catch (err) {
    console.error('Failed to write to frontend-errors.log:', err.message);
  }
  
  console.log(`\n\x1b[41m\x1b[37m[FRONTEND CRASH INTERCEPTED]\x1b[0m`);
  console.log(`  Message: \x1b[31m${errorDetails.message || errorDetails.errorMessage || 'Unknown Error'}\x1b[0m`);
  console.log(`  Level:   \x1b[33m${errorDetails.level || 'error'}\x1b[0m`);
  console.log(`  Meta:    `, JSON.stringify(errorDetails, null, 2));
  console.log(`\x1b[41m\x1b[37m[END FRONTEND CRASH]\x1b[0m\n`);
  
  res.status(200).json({ success: true });
});

// Development info endpoint
app.get('/dev-info', (req, res) => {
  res.status(200).json({
    message: 'Development server running without database',
    endpoints: [
      'GET /health - Health check',
      'GET /dev-info - This info',
      'POST /api/auth/face-login - Mock face login',
      'GET /api/attendance/today - Today\'s attendance',
      'POST /api/attendance/check-in - Check in',
      'GET /api/leave - Leave requests',
      'GET /api/work-report - Work reports',
      'All other endpoints are available but return mock data'
    ]
  });
});

// Test endpoint to verify routes are mounted
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API routes are working!',
    timestamp: new Date().toISOString(),
    availableRoutes: [
      '/api/auth/*',
      '/api/attendance/*',
      '/api/leave/*',
      '/api/work-report/*',
      '/api/excel/*',
      '/api/geofence/*',
      '/api/security/*',
      '/api/notification/*'
    ]
  });
});

// Error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Initialize connections and start server
async function startServer() {
  try {
    // Mock connections
    await mockConnectDB();
    await mockConnectRedis();

    // Start server
    httpServer.listen(PORT, () => {
      console.log(`🚀 Development server running on port ${PORT}`);
      console.log(`📡 WebSocket server ready`);
      console.log(`🔒 Security middleware active`);
      console.log(`🌍 CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      console.log(`🧪 Development mode: Database and Redis are mocked`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`ℹ️  Dev info: http://localhost:${PORT}/dev-info`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

startServer();

module.exports = { app, io };
