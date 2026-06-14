/**
 * ❌ DEPRECATED: Mock Routes File
 * 
 * This file has been DEPRECATED and should not be used.
 * All authentication and API endpoints must use real backend implementations.
 * 
 * Mock routes compromise security and are forbidden in production.
 * 
 * If this file is being required, it indicates a critical configuration error.
 * Immediately halt and review your setup.
 */

console.error('\n' + '='.repeat(80));
console.error('❌ CRITICAL SECURITY ERROR');
console.error('='.repeat(80));
console.error('The mock-routes.js file is deprecated and should not be used.');
console.error('Please use real API endpoints instead:');
console.error('  - /api/auth - Authentication endpoints');
console.error('  - /api/attendance - Attendance tracking');
console.error('  - /api/leave - Leave management');
console.error('  - /api/reports - Reporting system');
console.error('='.repeat(80) + '\n');

// Prevent any usage by returning empty routers
module.exports = {
  authRoutes: require('express').Router(),
  attendanceRoutes: require('express').Router(),
  leaveRoutes: require('express').Router(),
  workReportRoutes: require('express').Router(),
  excelRoutes: require('express').Router(),
  geofenceRoutes: require('express').Router(),
  securityRoutes: require('express').Router(),
  notificationRoutes: require('express').Router()
};

