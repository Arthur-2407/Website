const express = require('express');
const { query } = require('../../config/database');
const { authorizeSupervisor } = require('../../middleware/authMiddleware');
const { logSecurityEvent } = require('../security-monitoring/securityLogger');
const { logger } = require('../../config/logger');

const router = express.Router();

// Check-in endpoint
router.post('/check-in', async (req, res) => {
  try {
    const { location, imageData } = req.body;
    const employeeId = req.user.id;

    if (
      !location
      || typeof location.latitude !== 'number'
      || typeof location.longitude !== 'number'
    ) {
      return res.status(400).json({
        error: 'Location data required',
        code: 'LOCATION_REQUIRED'
      });
    }

    // Check geo-fence status
    const geoFenceResult = await query(
      `SELECT * FROM check_geo_fence($1, $2)`,
      [location.latitude, location.longitude]
    );

    if (geoFenceResult.rows.length === 0) {
      return res.status(400).json({
        error: 'No active office location configured',
        code: 'NO_OFFICE_CONFIG'
      });
    }

    const { within_fence, distance, office_name } = geoFenceResult.rows[0];

    // Check if already checked in today (timezone-safe using PostgreSQL CURRENT_DATE)
    const existingCheckin = await query(
      `SELECT id FROM attendance_records 
       WHERE employee_id = $1 AND check_in_time >= CURRENT_DATE AND check_in_time < CURRENT_DATE + INTERVAL '1 day'`,
      [employeeId]
    );

    if (existingCheckin.rows.length > 0) {
      return res.status(400).json({
        error: 'Already checked in today',
        code: 'ALREADY_CHECKED_IN'
      });
    }

    // Record attendance
    const result = await query(
      `INSERT INTO attendance_records 
       (employee_id, check_in_time, location, geo_fence_status, distance_from_office, check_in_image_url)
       VALUES ($1, NOW(), POINT($2, $3), $4, $5, $6)
       RETURNING id, check_in_time`,
      [
        employeeId,
        location.latitude,
        location.longitude,
        within_fence,
        distance,
        imageData || null
      ]
    );

    // Log geo-fence violation if applicable
    if (!within_fence) {
      await logSecurityEvent({
        employeeId: req.user.employeeId,
        eventType: 'GEOFENCE_VIOLATION',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: JSON.stringify({
          distance: distance,
          office: office_name,
          location: location
        }),
        severity: 'medium'
      });
    }

    const record = result.rows[0];

    // STABILIZATION: Emit WebSocket events for realtime attendance sync
    const io = req.app.get('io');
    if (io) {
      io.notifyEmployee(req.user.employeeId, 'attendance_update', {
        type: 'check-in',
        status: 'checked-in',
        record,
        lastCheckIn: record.check_in_time,
        employeeId: req.user.employeeId,
      });
      io.notifySupervisors('attendance_update', {
        type: 'check-in',
        employeeId: req.user.employeeId,
        record,
      });
    }

    res.json({
      success: true,
      message: 'Check-in successful',
      record,
      geoFence: {
        withinFence: within_fence,
        distance: distance,
        officeName: office_name
      }
    });

  } catch (error) {
    logger.error('Check-in error', { error: error.message, stack: error.stack, userId: req.user?.id });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Check-out endpoint
router.post('/check-out', async (req, res) => {
  try {
    const { location, imageData } = req.body;
    const employeeId = req.user.id;

    // Get today's check-in record (timezone-safe using PostgreSQL CURRENT_DATE)
    const checkinResult = await query(
      `SELECT id, check_in_time FROM attendance_records 
       WHERE employee_id = $1 AND check_in_time >= CURRENT_DATE AND check_in_time < CURRENT_DATE + INTERVAL '1 day'
       AND check_out_time IS NULL`,
      [employeeId]
    );

    if (checkinResult.rows.length === 0) {
      return res.status(400).json({
        error: 'No active check-in found for today',
        code: 'NO_ACTIVE_CHECKIN'
      });
    }

    const checkinRecord = checkinResult.rows[0];
    const checkOutTime = new Date();
    
    // Calculate work hours from millisecond difference (safe for any duration)
    const workHoursMs = checkOutTime - checkinRecord.check_in_time;
    const totalSeconds = Math.max(0, Math.floor(workHoursMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const workHours = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // Update record with correct coordinate mapping (latitude=$4, longitude=$5)
    const result = await query(
      `UPDATE attendance_records 
       SET check_out_time = NOW(), 
           work_hours = $1,
           check_out_image_url = $2,
           location = CASE WHEN $3 IS NOT NULL THEN POINT($4, $5) ELSE location END
       WHERE id = $6
       RETURNING *`,
      [
        workHours,
        imageData || null,
        location ? true : null,
        location ? location.latitude : null,
        location ? location.longitude : null,
        checkinRecord.id
      ]
    );

    const record = result.rows[0];

    // STABILIZATION: Emit WebSocket events for realtime attendance sync
    const io = req.app.get('io');
    if (io) {
      io.notifyEmployee(req.user.employeeId, 'attendance_update', {
        type: 'check-out',
        status: 'checked-out',
        record,
        employeeId: req.user.employeeId,
      });
      io.notifySupervisors('attendance_update', {
        type: 'check-out',
        employeeId: req.user.employeeId,
        record,
      });
    }

    res.json({
      success: true,
      message: 'Check-out successful',
      record,
    });

  } catch (error) {
    logger.error('Check-out error', { error: error.message, stack: error.stack, userId: req.user?.id });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get today's attendance state
router.get('/today', async (req, res) => {
  try {
    const employeeId = req.user.id;

    const result = await query(
      `SELECT *
       FROM attendance_records
       WHERE employee_id = $1
         AND check_in_time >= CURRENT_DATE
         AND check_in_time < CURRENT_DATE + INTERVAL '1 day'
       ORDER BY check_in_time DESC
       LIMIT 1`,
      [employeeId]
    );

    const currentRecord = result.rows[0] || null;
    const status = currentRecord && !currentRecord.check_out_time
      ? 'checked-in'
      : 'checked-out';

    res.json({
      success: true,
      status,
      currentRecord,
      lastCheckIn: currentRecord?.check_in_time || null,
    });
  } catch (error) {
    logger.error('Today attendance fetch error', { error: error.message, userId: req.user?.id });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

// Get attendance history
router.get('/history', async (req, res) => {
  try {
    const { startDate, endDate, employeeId: targetEmployeeId } = req.query;
    const requestingEmployeeId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const isSupervisor = req.user.role === 'supervisor';
    const isEmployee = req.user.role === 'employee';

    // SCOPE VALIDATION: Supervisors can only see their assigned employees
    // If targetEmployeeId is specified, verify supervisor assignment
    if (targetEmployeeId && isSupervisor) {
      const empResult = await query(
        `SELECT id FROM supervisor_assignments 
         WHERE supervisor_id = $1 AND employee_id IN (
           SELECT id FROM employees WHERE employee_id = $2
         ) AND is_active = TRUE`,
        [req.user.id, targetEmployeeId]
      );

      if (empResult.rows.length === 0) {
        return res.status(403).json({
          error: 'You are not assigned to supervise this employee',
          code: 'FORBIDDEN'
        });
      }
    }

    let queryText = `
      SELECT ar.*, e.employee_id, e.first_name, e.last_name, e.department
      FROM attendance_records ar
      JOIN employees e ON ar.employee_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    // Date filter
    if (startDate) {
      paramCount++;
      queryText += ` AND ar.check_in_time >= $${paramCount}`;
      params.push(new Date(startDate));
    }

    if (endDate) {
      paramCount++;
      queryText += ` AND ar.check_in_time <= $${paramCount}`;
      params.push(new Date(endDate));
    }

    // ROLE-BASED SCOPE
    if (isAdmin) {
      // Admins see all records (no additional filter)
    } else if (isSupervisor) {
      if (targetEmployeeId) {
        // Already validated above - supervisor is assigned to this employee
        paramCount++;
        queryText += ` AND e.employee_id = $${paramCount}`;
        params.push(targetEmployeeId);
      } else {
        // Show only their assigned employees
        paramCount++;
        queryText += ` AND ar.employee_id IN (
          SELECT employee_id FROM supervisor_assignments
          WHERE supervisor_id = $${paramCount} AND is_active = TRUE
        )`;
        params.push(req.user.id);
      }
    } else if (isEmployee) {
      // Regular employees only see their own records
      paramCount++;
      queryText += ` AND ar.employee_id = $${paramCount}`;
      params.push(requestingEmployeeId);
    }

    queryText += ' ORDER BY ar.check_in_time DESC';

    // Pagination
    const limit = parseInt(req.query.limit, 10) || 50;
    const page = parseInt(req.query.page, 10) || 1;
    const offset = (page - 1) * limit;

    paramCount++;
    queryText += ` LIMIT $${paramCount}`;
    params.push(limit);

    paramCount++;
    queryText += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await query(queryText, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) FROM attendance_records ar
      JOIN employees e ON ar.employee_id = e.id
      WHERE 1=1
    `;
    let countParams = [];
    let countParamCount = 0;

    // Apply same filters
    if (startDate) {
      countParamCount++;
      countQuery += ` AND ar.check_in_time >= $${countParamCount}`;
      countParams.push(new Date(startDate));
    }

    if (endDate) {
      countParamCount++;
      countQuery += ` AND ar.check_in_time <= $${countParamCount}`;
      countParams.push(new Date(endDate));
    }

    // Same scope validation
    if (isAdmin) {
      // Admins see all
    } else if (isSupervisor) {
      if (targetEmployeeId) {
        countParamCount++;
        countQuery += ` AND e.employee_id = $${countParamCount}`;
        countParams.push(targetEmployeeId);
      } else {
        countParamCount++;
        countQuery += ` AND ar.employee_id IN (
          SELECT employee_id FROM supervisor_assignments
          WHERE supervisor_id = $${countParamCount} AND is_active = TRUE
        )`;
        countParams.push(req.user.id);
      }
    } else if (isEmployee) {
      countParamCount++;
      countQuery += ` AND ar.employee_id = $${countParamCount}`;
      countParams.push(requestingEmployeeId);
    }

    const countResult = await query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: result.rows,
      records: result.rows,
      totalCount: total,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('Attendance history error', { error: error.message, userId: req.user?.id });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

// Get attendance statistics
router.get('/stats', async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    const employeeId = req.user.id;

    let dateFilter = '';
    switch (period) {
      case 'week':
        dateFilter = "check_in_time >= NOW() - INTERVAL '7 days'";
        break;
      case 'month':
        dateFilter = "check_in_time >= NOW() - INTERVAL '30 days'";
        break;
      case 'year':
        dateFilter = "check_in_time >= NOW() - INTERVAL '365 days'";
        break;
      default:
        dateFilter = "check_in_time >= NOW() - INTERVAL '30 days'";
    }

    // Total check-ins
    const totalResult = await query(
      `SELECT COUNT(*) as total FROM attendance_records 
       WHERE employee_id = $1 AND ${dateFilter}`,
      [employeeId]
    );

    // Average work hours
    const avgHoursResult = await query(
      `SELECT AVG(EXTRACT(EPOCH FROM work_hours)) as avg_seconds 
       FROM attendance_records 
       WHERE employee_id = $1 AND work_hours IS NOT NULL AND ${dateFilter}`,
      [employeeId]
    );

    // Geo-fence compliance
    const geoFenceResult = await query(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN geo_fence_status = TRUE THEN 1 ELSE 0 END) as within_fence
       FROM attendance_records 
       WHERE employee_id = $1 AND ${dateFilter}`,
      [employeeId]
    );

    // Late arrivals (after 9:30 AM)
    const lateArrivalsResult = await query(
      `SELECT COUNT(*) as late_count
       FROM attendance_records 
       WHERE employee_id = $1 AND ${dateFilter}
         AND check_in_time::time >= TIME '09:30'`,
      [employeeId]
    );

    const stats = {
      totalCheckins: parseInt(totalResult.rows[0].total),
      averageHours: avgHoursResult.rows[0].avg_seconds 
        ? (avgHoursResult.rows[0].avg_seconds / 3600).toFixed(1) 
        : '0',
      geoFenceCompliance: geoFenceResult.rows[0].total > 0 
        ? ((geoFenceResult.rows[0].within_fence / geoFenceResult.rows[0].total) * 100).toFixed(1)
        : '0',
      lateArrivals: parseInt(lateArrivalsResult.rows[0].late_count)
    };

    // STABILIZATION: Return consistent schema — flat fields + nested stats
    // Frontend reads both paths depending on the component
    res.json({
      success: true,
      totalCheckins: stats.totalCheckins,
      averageHours: stats.averageHours,
      geoFenceCompliance: stats.geoFenceCompliance,
      lateArrivals: stats.lateArrivals,
      stats,
      period
    });

  } catch (error) {
    logger.error('Attendance stats error', { error: error.message, userId: req.user?.id });
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

module.exports = router;
