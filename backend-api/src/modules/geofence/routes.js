const express = require('express');
const router = express.Router();
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { authenticateToken } = require('../../middleware/authMiddleware');

// SECURITY FIX: No hardcoded default office location.
// All geofence validation MUST use database-configured locations.
// If no location is configured, the API returns an error requiring setup.

// Haversine formula to compute distance in meters
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// POST /api/geofence/validate - Validate if employee is within geo-fence
// Requires authentication
router.post('/validate', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });
    }

    // SECURITY FIX: Require database-configured office location.
    // No hardcoded fallback allowed.
    let officeConfig;
    try {
      const configResult = await query(
        `SELECT id, name, latitude, longitude, radius_meters
         FROM office_locations
         WHERE is_active = TRUE
         ORDER BY id
         LIMIT 1`
      );
      if (configResult.rows.length > 0) {
        officeConfig = configResult.rows[0];
      }
    } catch (dbErr) {
      logger.error('Geofence DB lookup failed', { error: dbErr.message });
    }

    // No location configured — require admin to set up office location first
    if (!officeConfig) {
      return res.status(402).json({
        success: false,
        code: 'LOCATION_NOT_CONFIGURED',
        message: 'No office location configured. Please configure an office location in the admin panel before checking in.',
        requiresSetup: true
      });
    }

    const distance = haversineDistance(
      parseFloat(latitude),
      parseFloat(longitude),
      parseFloat(officeConfig.latitude),
      parseFloat(officeConfig.longitude)
    );

    const within_fence = distance <= officeConfig.radius_meters;

    res.json({
      success: true,
      within_fence,
      distance_meters: Math.round(distance),
      radius_meters: officeConfig.radius_meters,
      office_name: officeConfig.name,
      message: within_fence ? 'You are within the office geo-fence' : 'You are outside the office geo-fence'
    });
  } catch (error) {
    logger.error('Geofence validation error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Geofence validation failed' });
  }
});

// GET /api/geofence/config - Get current geo-fence configuration
// Requires authentication
router.get('/config', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, address, latitude, longitude, radius_meters, is_active, created_at
       FROM office_locations
       WHERE is_active = TRUE
       ORDER BY id
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        configured: false,
        data: null,
        message: 'No office location configured. Please configure one in the admin panel.'
      });
    }

    res.json({ success: true, configured: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Geofence config fetch error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to fetch geofence config' });
  }
});

// PUT /api/geofence/config - Update geo-fence configuration (supervisor/admin only)
router.put('/config', authenticateToken, async (req, res) => {
  try {
    // V8: Enforce role-based access — only supervisors and admins can modify geofence config
    if (req.user.role !== 'supervisor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Insufficient permissions — supervisor or admin role required' });
    }

    const { latitude, longitude, radius_meters } = req.body;

    if (!latitude || !longitude || !radius_meters) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    await query(
      `INSERT INTO office_locations (id, name, latitude, longitude, radius_meters, is_active)
       VALUES (1, 'Main Office', $1, $2, $3, TRUE)
       ON CONFLICT (id) DO UPDATE
       SET latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           radius_meters = EXCLUDED.radius_meters,
           is_active = TRUE,
           updated_at = NOW()`,
      [latitude, longitude, radius_meters]
    );

    res.json({ success: true, message: 'Geo-fence configuration updated' });
  } catch (error) {
    logger.error('Geofence config update error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to update geofence config' });
  }
});

module.exports = router;
