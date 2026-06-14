/**
 * LOCATION MANAGEMENT ROUTES
 * 
 * Manage office locations and geofence configurations
 * Authorization: Admin endpoints for creation/update/delete
 */

const express = require('express');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { requireRole } = require('../../middleware/rbac');
const { authenticateToken } = require('../../middleware/authMiddleware');
const { logAuditEvent } = require('../security-monitoring/securityLogger');

const router = express.Router();

/**
 * GET /api/locations
 * List all active office locations
 * Requires authentication
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, latitude, longitude, radius_meters,
              work_start_time, work_end_time, lunch_start_time, lunch_end_time,
              is_active, created_at
       FROM office_locations
       WHERE is_active = TRUE
       ORDER BY name`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Location list error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

/**
 * GET /api/locations/:locationId
 * Get specific location details
 * Requires authentication
 */
router.get('/:locationId', authenticateToken, async (req, res) => {
  try {
    const { locationId } = req.params;

    const result = await query(
      `SELECT id, name, latitude, longitude, radius_meters,
              work_start_time, work_end_time, lunch_start_time, lunch_end_time,
              is_active
       FROM office_locations
       WHERE id = $1`,
      [locationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Location fetch error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

/**
 * POST /api/locations
 * Create new office location
 * Admin only
 */
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, latitude, longitude, radiusMeters, workStartTime, workEndTime, lunchStartTime, lunchEndTime } = req.body;

    // Validation
    if (!name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Name, latitude, and longitude are required' });
    }

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ error: 'Latitude and longitude must be numbers' });
    }

    const result = await query(
      `INSERT INTO office_locations 
       (name, latitude, longitude, radius_meters, work_start_time, work_end_time, lunch_start_time, lunch_end_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, latitude, longitude, radius_meters, work_start_time, work_end_time`,
      [
        name,
        latitude,
        longitude,
        radiusMeters || 100,
        workStartTime || '09:00:00',
        workEndTime || '18:00:00',
        lunchStartTime || '12:00:00',
        lunchEndTime || '13:00:00'
      ]
    );

    const newLocation = result.rows[0];

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'location.create',
      resourceType: 'office_location',
      resourceId: String(newLocation.id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { name, latitude, longitude }
    });

    res.status(201).json({
      success: true,
      data: newLocation
    });
  } catch (error) {
    logger.error('Location create error', { error: error.message });
    res.status(500).json({ error: 'Failed to create location' });
  }
});

/**
 * PUT /api/locations/:locationId
 * Update office location
 * Admin only
 */
router.put('/:locationId', requireRole('admin'), async (req, res) => {
  try {
    const { locationId } = req.params;
    const { name, latitude, longitude, radiusMeters, workStartTime, workEndTime, lunchStartTime, lunchEndTime, isActive } = req.body;

    const updates = [];
    const values = [locationId];
    let paramCount = 1;

    if (name !== undefined) {
      paramCount++;
      updates.push(`name = $${paramCount}`);
      values.push(name);
    }
    if (latitude !== undefined) {
      if (typeof latitude !== 'number') {
        return res.status(400).json({ error: 'Latitude must be a number' });
      }
      paramCount++;
      updates.push(`latitude = $${paramCount}`);
      values.push(latitude);
    }
    if (longitude !== undefined) {
      if (typeof longitude !== 'number') {
        return res.status(400).json({ error: 'Longitude must be a number' });
      }
      paramCount++;
      updates.push(`longitude = $${paramCount}`);
      values.push(longitude);
    }
    if (radiusMeters !== undefined) {
      paramCount++;
      updates.push(`radius_meters = $${paramCount}`);
      values.push(radiusMeters);
    }
    if (workStartTime !== undefined) {
      paramCount++;
      updates.push(`work_start_time = $${paramCount}`);
      values.push(workStartTime);
    }
    if (workEndTime !== undefined) {
      paramCount++;
      updates.push(`work_end_time = $${paramCount}`);
      values.push(workEndTime);
    }
    if (lunchStartTime !== undefined) {
      paramCount++;
      updates.push(`lunch_start_time = $${paramCount}`);
      values.push(lunchStartTime);
    }
    if (lunchEndTime !== undefined) {
      paramCount++;
      updates.push(`lunch_end_time = $${paramCount}`);
      values.push(lunchEndTime);
    }
    if (isActive !== undefined) {
      paramCount++;
      updates.push(`is_active = $${paramCount}`);
      values.push(isActive);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE office_locations SET ${updates.join(', ')} WHERE id = $1 RETURNING id, name, latitude, longitude`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'location.update',
      resourceType: 'office_location',
      resourceId: String(result.rows[0].id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { updatedFields: Object.keys(req.body).filter(k => req.body[k] !== undefined) }
    });

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Location update error', { error: error.message });
    res.status(500).json({ error: 'Failed to update location' });
  }
});

/**
 * DELETE /api/locations/:locationId
 * Soft-delete office location
 * Admin only
 */
router.delete('/:locationId', requireRole('admin'), async (req, res) => {
  try {
    const { locationId } = req.params;

    const result = await query(
      `UPDATE office_locations SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, name`,
      [locationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'location.delete',
      resourceType: 'office_location',
      resourceId: String(result.rows[0].id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { locationName: result.rows[0].name }
    });

    res.json({
      success: true,
      message: 'Location deleted successfully'
    });
  } catch (error) {
    logger.error('Location delete error', { error: error.message });
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

/**
 * GET /api/locations/:locationId/work-hours
 * Get work hours for a specific location
 */
router.get('/:locationId/work-hours', async (req, res) => {
  try {
    const { locationId } = req.params;

    const result = await query(
      `SELECT 
        work_start_time,
        work_end_time,
        lunch_start_time,
        lunch_end_time
       FROM office_locations
       WHERE id = $1 AND is_active = TRUE`,
      [locationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Work hours fetch error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch work hours' });
  }
});

module.exports = router;
