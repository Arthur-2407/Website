const express = require('express');
const { query } = require('../../config/database');
const { authorizeSupervisor } = require('../../middleware/authMiddleware');
const { logSecurityEvent } = require('../security-monitoring/securityLogger');
const { logger } = require('../../config/logger');

const router = express.Router();

function formatInterval(interval) {
  if (!interval) return null;
  if (typeof interval === 'string') return interval;
  const hours = interval.hours || 0;
  const minutes = interval.minutes || 0;
  const seconds = interval.seconds || 0;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Haversine distance in METERS between two lat/lng points.
 * Mirrors the PostgreSQL calculate_distance() function.
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Resolves geo-fence result for a given employee and coordinates.
 * Checks employee_locations first; falls back to global check_geo_fence().
 * Returns { within_fence, distance, office_name }
 */
async function resolveGeoFence(employeeId, latitude, longitude) {
  // 1. Check for per-employee location assignment
  const empLocResult = await query(
    `SELECT name, latitude, longitude, radius_meters
     FROM employee_locations
     WHERE employee_id = $1 AND is_active = TRUE
     LIMIT 1`,
    [employeeId]
  );

  if (empLocResult.rows.length > 0) {
    const loc = empLocResult.rows[0];
    const distance = haversineDistanceMeters(latitude, longitude, loc.latitude, loc.longitude);
    const within_fence = distance <= loc.radius_meters;
    return { within_fence, distance, office_name: loc.name };
  }

  // 2. Fall back to global office check_geo_fence()
  const geoFenceResult = await query(
    `SELECT * FROM check_geo_fence($1, $2)`,
    [latitude, longitude]
  );

  if (geoFenceResult.rows.length === 0) {
    return null; // No office configured at all
  }

  return geoFenceResult.rows[0];
}

// Check-in endpoint
router.post('/check-in', async (req, res) => {
  try {
    const { location, imageData, idempotencyKey } = req.body;
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

    // Resolve geo-fence: per-employee location first, then global fallback
    const geoFenceData = await resolveGeoFence(employeeId, location.latitude, location.longitude);

    if (!geoFenceData) {
      return res.status(400).json({
        error: 'No active office location configured',
        code: 'NO_OFFICE_CONFIG'
      });
    }

    const { within_fence, distance, office_name } = geoFenceData;

    // Atomic INSERT ... ON CONFLICT DO NOTHING using the unique partial index
    // (uix_attendance_one_open_per_employee_per_day).
    // This prevents double-check-in even with concurrent requests — the DB
    // enforces uniqueness atomically, so the SELECT+INSERT race condition is eliminated.
    const result = await query(
      `INSERT INTO attendance_records
         (employee_id, check_in_time, location, geo_fence_status, distance_from_office, check_in_image_url, idempotency_key)
       VALUES ($1, NOW(), POINT($2, $3), $4, $5, $6, $7)
       ON CONFLICT DO NOTHING
       RETURNING id, check_in_time`,
      [
        employeeId,
        location.latitude,
        location.longitude,
        within_fence,
        distance,
        imageData || null,
        idempotencyKey || null,
      ]
    );

    if (result.rows.length === 0) {
      // ON CONFLICT — already checked in
      return res.status(409).json({
        error: 'Already checked in today',
        code: 'ALREADY_CHECKED_IN'
      });
    }

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

    // Query active temporary timing for the checking-out employee on the check-in date
    const checkInDate = new Date(checkinRecord.check_in_time);
    const year = checkInDate.getFullYear();
    const month = String(checkInDate.getMonth() + 1).padStart(2, '0');
    const day = String(checkInDate.getDate()).padStart(2, '0');
    const checkInDateStr = `${year}-${month}-${day}`;

    const tempShiftResult = await query(
      `SELECT work_start_time, work_end_time 
       FROM work_timings
       WHERE employee_id = $1 
         AND is_temporary = TRUE 
         AND is_active = TRUE
         AND $2::date >= start_date 
         AND $2::date <= end_date
       LIMIT 1`,
      [employeeId, checkInDateStr]
    );

    let shift = null;
    if (tempShiftResult.rows.length > 0) {
      shift = tempShiftResult.rows[0];
    } else {
      // Query active permanent timing
      const permShiftResult = await query(
        `SELECT work_start_time, work_end_time 
         FROM work_timings
         WHERE employee_id = $1 
           AND is_temporary = FALSE 
           AND is_active = TRUE
         LIMIT 1`,
        [employeeId]
      );
      if (permShiftResult.rows.length > 0) {
        shift = permShiftResult.rows[0];
      }
    }

    const workStartTime = shift ? shift.work_start_time : '09:00:00';
    const workEndTime = shift ? shift.work_end_time : '18:00:00';

    // Helper function to calculate overlapping milliseconds between shift and actual check-in/out
    function calculateOverlapMs(checkIn, checkOut, startStr, endStr) {
      const parseTime = (timeStr) => {
        const [h, m, s] = timeStr.split(':').map(Number);
        return { hours: h, minutes: m || 0, seconds: s || 0 };
      };

      const startT = parseTime(startStr);
      const endT = parseTime(endStr);

      const getShiftInterval = (baseDate, startT, endT) => {
        const start = new Date(baseDate);
        start.setHours(startT.hours, startT.minutes, startT.seconds, 0);

        const end = new Date(baseDate);
        if (endT.hours < startT.hours || (endT.hours === startT.hours && endT.minutes < startT.minutes)) {
          // Crosses midnight
          end.setDate(end.getDate() + 1);
        }
        end.setHours(endT.hours, endT.minutes, endT.seconds, 0);
        return { start, end };
      };

      const getOverlapMs = (interval1, interval2) => {
        const start = Math.max(interval1.start.getTime(), interval2.start.getTime());
        const end = Math.min(interval1.end.getTime(), interval2.end.getTime());
        return Math.max(0, end - start);
      };

      let maxOverlapMs = 0;

      // Check shift starting on previous day, same day, and next day to handle cross-midnight shifts robustly
      for (let offset = -1; offset <= 1; offset++) {
        const baseDate = new Date(checkIn);
        baseDate.setDate(baseDate.getDate() + offset);
        const shiftInterval = getShiftInterval(baseDate, startT, endT);
        const overlapMs = getOverlapMs(shiftInterval, { start: checkIn, end: checkOut });
        if (overlapMs > maxOverlapMs) {
          maxOverlapMs = overlapMs;
        }
      }

      return maxOverlapMs;
    }

    const workHoursMs = calculateOverlapMs(checkinRecord.check_in_time, checkOutTime, workStartTime, workEndTime);
    
    // Calculate work hours from millisecond difference (safe for any duration)
    const totalSeconds = Math.max(0, Math.floor(workHoursMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const workHours = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // Resolve geo-fence for check-out location (per-employee or global fallback)
    let checkOutWithinFence = null;
    let checkOutDistance = null;
    if (location && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
      try {
        const checkOutGeo = await resolveGeoFence(employeeId, location.latitude, location.longitude);
        if (checkOutGeo) {
          checkOutWithinFence = checkOutGeo.within_fence;
          checkOutDistance = checkOutGeo.distance;
        }
      } catch (geoErr) {
        logger.warn('Check-out geo-fence resolution failed', { error: geoErr.message });
      }
    }

    // Update record with check-out data including geo-fence result
    const result = await query(
      `UPDATE attendance_records 
       SET check_out_time = NOW(), 
           work_hours = $1,
           check_out_image_url = $2,
           location = CASE WHEN $3::boolean IS NOT NULL THEN POINT($4::double precision, $5::double precision) ELSE location END,
           checkout_geo_fence_status = $7,
           checkout_distance_from_office = $8
       WHERE id = $6
       RETURNING *`,
      [
        workHours,
        imageData || null,
        location ? true : null,
        location ? location.latitude : null,
        location ? location.longitude : null,
        checkinRecord.id,
        checkOutWithinFence,
        checkOutDistance
      ]
    );

    const record = result.rows[0];
    if (record) {
      record.work_hours = workHours;
    }

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
    if (currentRecord && currentRecord.work_hours) {
      currentRecord.work_hours = formatInterval(currentRecord.work_hours);
    }
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

// Get current employee's work timings
router.get('/my-timing', async (req, res) => {
  try {
    const employeeId = req.user.id;
    // Check temporary timings first
    const tempShiftResult = await query(
      `SELECT work_start_time, work_end_time 
       FROM work_timings
       WHERE employee_id = $1 
         AND is_temporary = TRUE 
         AND is_active = TRUE
         AND NOW()::date >= start_date 
         AND NOW()::date <= end_date
       LIMIT 1`,
      [employeeId]
    );

    let shift = null;
    if (tempShiftResult.rows.length > 0) {
      shift = tempShiftResult.rows[0];
    } else {
      // Query active permanent timing
      const permShiftResult = await query(
        `SELECT work_start_time, work_end_time 
         FROM work_timings
         WHERE employee_id = $1 
           AND is_temporary = FALSE 
           AND is_active = TRUE
         LIMIT 1`,
         [employeeId]
      );
      if (permShiftResult.rows.length > 0) {
        shift = permShiftResult.rows[0];
      }
    }

    const workStartTime = shift ? shift.work_start_time : '09:00:00';
    const workEndTime = shift ? shift.work_end_time : '18:00:00';

    res.json({
      success: true,
      work_start_time: workStartTime,
      work_end_time: workEndTime,
      has_assigned_timing: shift !== null
    });
  } catch (error) {
    logger.error('Failed to get employee work timings', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch work timings' });
  }
});

// Get attendance history
router.get('/history', async (req, res) => {
  try {
    const { startDate, endDate, employeeId: targetEmployeeId, scope } = req.query;
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
      SELECT ar.*, e.employee_id, e.first_name, e.last_name, e.department, e.role
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
      const end = new Date(endDate);
      if (typeof endDate === 'string' && !endDate.includes('T')) {
        end.setUTCHours(23, 59, 59, 999);
      }
      params.push(end);
    }

    // ROLE-BASED SCOPE
    if (scope === 'self') {
      paramCount++;
      queryText += ` AND ar.employee_id = $${paramCount}`;
      params.push(requestingEmployeeId);
    } else if (scope === 'team') {
      paramCount++;
      queryText += ` AND ar.employee_id IN (
        SELECT id FROM employees WHERE supervisor_id = $${paramCount} AND is_active = TRUE AND role = $${paramCount + 1}
        UNION
        SELECT sa.employee_id FROM supervisor_assignments sa
        JOIN employees emp ON sa.employee_id = emp.id
        WHERE sa.supervisor_id = $${paramCount} AND sa.is_active = TRUE AND emp.role = $${paramCount + 1}
      )`;
      params.push(requestingEmployeeId);
      params.push(req.user.role === 'admin' ? 'supervisor' : 'employee');
      paramCount++;
    } else {
      if (isAdmin) {
        if (scope === 'all') {
          // Admins see all records (no additional filter)
        } else {
          paramCount++;
          queryText += ` AND ar.employee_id = $${paramCount}`;
          params.push(requestingEmployeeId);
        }
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

    // Format interval work_hours to HH:MM:SS string
    result.rows.forEach(r => {
      if (r.work_hours) {
        r.work_hours = formatInterval(r.work_hours);
      }
    });

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
      const end = new Date(endDate);
      if (typeof endDate === 'string' && !endDate.includes('T')) {
        end.setUTCHours(23, 59, 59, 999);
      }
      countParams.push(end);
    }

    // Same scope validation
    if (scope === 'self') {
      countParamCount++;
      countQuery += ` AND ar.employee_id = $${countParamCount}`;
      countParams.push(requestingEmployeeId);
    } else if (scope === 'team') {
      countParamCount++;
      countQuery += ` AND ar.employee_id IN (
        SELECT id FROM employees WHERE supervisor_id = $${countParamCount} AND is_active = TRUE AND role = $${countParamCount + 1}
        UNION
        SELECT sa.employee_id FROM supervisor_assignments sa
        JOIN employees emp ON sa.employee_id = emp.id
        WHERE sa.supervisor_id = $${countParamCount} AND sa.is_active = TRUE AND emp.role = $${countParamCount + 1}
      )`;
      countParams.push(requestingEmployeeId);
      countParams.push(req.user.role === 'admin' ? 'supervisor' : 'employee');
      countParamCount++;
    } else {
      if (isAdmin) {
        if (scope === 'all') {
          // Admins see all
        } else {
          countParamCount++;
          countQuery += ` AND ar.employee_id = $${countParamCount}`;
          countParams.push(requestingEmployeeId);
        }
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
