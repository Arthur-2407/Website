const express = require('express');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

const router = express.Router();

const PERIOD_DAYS = {
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function getDateRange({ startDate, endDate, period }) {
  const end = endDate ? new Date(endDate) : new Date();
  const days = PERIOD_DAYS[period] || PERIOD_DAYS.month;
  const start = startDate
    ? new Date(startDate)
    : new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    startDate: toDateString(start),
    endDate: toDateString(end),
  };
}

function asInt(value) {
  return Number.parseInt(value, 10) || 0;
}

function asNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hoursString(value) {
  return asNumber(value).toFixed(2);
}

function scopedParams(role, startDate, endDate, employeeId) {
  return role === 'employee' ? [startDate, endDate, employeeId] : [startDate, endDate];
}

function employeeScope(role, column = 'employee_id') {
  return role === 'employee' ? `AND ${column} = $3` : '';
}

// GET /api/reports - aggregated reports data for dashboard charts and cards.
router.get('/', async (req, res) => {
  const employeeId = req.user?.id;
  const role = req.user?.role;
  const { startDate, endDate } = getDateRange(req.query);
  const params = scopedParams(role, startDate, endDate, employeeId);

  try {
    // Fetch configurable work start time from office locations (or use default)
    let workStartTime = '09:00:00';
    try {
      const workTimingResult = await query(
        `SELECT work_start_time FROM office_locations 
         WHERE is_active = TRUE ORDER BY id LIMIT 1`
      );
      if (workTimingResult.rows[0]?.work_start_time) {
        workStartTime = workTimingResult.rows[0].work_start_time;
      }
    } catch (e) {
      // Use default if query fails
      console.warn('Could not fetch work_start_time from office_locations', e.message);
    }

    const attendanceStats = await query(
      `SELECT
         COUNT(*) AS total_checkins,
         COUNT(DISTINCT employee_id) AS employees_checked_in,
         AVG(EXTRACT(EPOCH FROM work_hours) / 3600) AS avg_hours_per_day,
         COUNT(*) FILTER (WHERE geo_fence_status IS TRUE) AS geo_compliant,
         COUNT(*) AS total_records
       FROM attendance_records
       WHERE check_in_time::DATE BETWEEN $1::DATE AND $2::DATE
       ${employeeScope(role)}`,
      params
    );

    const leaveStats = await query(
      `SELECT
         COUNT(*) AS total_requests,
         COUNT(*) FILTER (WHERE status = 'approved') AS approved,
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
         COALESCE(SUM(total_days) FILTER (WHERE status = 'approved'), 0) AS total_approved_days,
         COALESCE(SUM(total_days) FILTER (WHERE status = 'approved' AND leave_type = 'vacation'), 0) AS vacation_days_used,
         COALESCE(SUM(total_days) FILTER (WHERE status = 'approved' AND leave_type = 'sick'), 0) AS sick_days_used
       FROM leave_requests
       WHERE start_date >= $1::DATE AND end_date <= $2::DATE
       ${employeeScope(role)}`,
      params
    );

    const reportStats = await query(
      `SELECT
         COUNT(*) AS total_reports,
         COUNT(*) FILTER (WHERE status = 'submitted') AS submitted,
         COUNT(*) FILTER (WHERE status = 'reviewed') AS reviewed,
         COUNT(*) FILTER (WHERE status = 'approved') AS approved
       FROM work_reports
       WHERE report_date >= $1::DATE AND report_date <= $2::DATE
       ${employeeScope(role)}`,
      params
    );

    // Use configurable work start time instead of hardcoded 09:00:00
    const lateArrivals = await query(
      `SELECT COUNT(*) AS late_count
       FROM attendance_records ar
       WHERE ar.check_in_time::DATE BETWEEN $1::DATE AND $2::DATE
         AND ar.check_in_time::TIME > $3::TIME
       ${employeeScope(role, 'ar.employee_id')}`,
      [...params, workStartTime]
    );

    // Use configurable work start time in weekly data query
    const weeklyData = await query(
      `SELECT
         date_trunc('week', ar.check_in_time)::DATE AS week_start,
         to_char(date_trunc('week', ar.check_in_time)::DATE, 'Mon DD') AS week,
         ROUND(COALESCE(SUM(EXTRACT(EPOCH FROM ar.work_hours) / 3600), 0)::NUMERIC, 2) AS hours,
         COUNT(*) FILTER (WHERE ar.check_in_time::TIME > $3::TIME) AS late_arrivals
       FROM attendance_records ar
       WHERE ar.check_in_time::DATE BETWEEN $1::DATE AND $2::DATE
       ${employeeScope(role, 'ar.employee_id')}
       GROUP BY week_start
       ORDER BY week_start`,
      [...params, workStartTime]
    );

    let departmentRows = [];
    if (role === 'admin' || role === 'supervisor') {
      const departmentStats = await query(
        `SELECT
           COALESCE(e.department, 'Unassigned') AS department,
           COUNT(DISTINCT e.id) AS employees,
           COUNT(ar.id) AS total_checkins,
           ROUND(
             COUNT(DISTINCT ar.employee_id)::NUMERIC
             / NULLIF(COUNT(DISTINCT e.id), 0) * 100,
             2
           ) AS attendance_rate
         FROM employees e
         LEFT JOIN attendance_records ar
           ON e.id = ar.employee_id
          AND ar.check_in_time::DATE BETWEEN $1::DATE AND $2::DATE
         WHERE e.is_active = TRUE
         GROUP BY COALESCE(e.department, 'Unassigned')
         ORDER BY department`,
        [startDate, endDate]
      );
      departmentRows = departmentStats.rows;
    }

    const attendance = attendanceStats.rows[0] || {};
    const leaves = leaveStats.rows[0] || {};
    const workReports = reportStats.rows[0] || {};
    const totalRecords = asInt(attendance.total_records);
    const geoCompliant = asInt(attendance.geo_compliant);
    const geoCompliance = totalRecords > 0 ? Math.round((geoCompliant / totalRecords) * 100) : 0;

    const stats = {
      totalCheckins: asInt(attendance.total_checkins),
      averageHours: hoursString(attendance.avg_hours_per_day),
      geoFenceCompliance: String(geoCompliance),
      lateArrivals: asInt(lateArrivals.rows[0]?.late_count),
    };

    const leave = {
      totalRequests: asInt(leaves.total_requests),
      approved: asInt(leaves.approved),
      pending: asInt(leaves.pending),
      rejected: asInt(leaves.rejected),
      vacationDaysUsed: asInt(leaves.vacation_days_used),
      sickDaysUsed: asInt(leaves.sick_days_used),
      totalApprovedDays: asInt(leaves.total_approved_days),
    };

    const departments = departmentRows.map((dept) => {
      const attendanceRate = asNumber(dept.attendance_rate);
      return {
        department: dept.department,
        name: dept.department,
        employees: asInt(dept.employees),
        checkins: asInt(dept.total_checkins),
        attendanceRate,
        compliance: attendanceRate,
      };
    });

    res.json({
      success: true,
      period: { startDate, endDate },
      stats,
      summary: {
        totalCheckins: stats.totalCheckins,
        avgHoursPerDay: stats.averageHours,
        geoCompliance,
        lateArrivals: stats.lateArrivals,
        totalEmployees: asInt(attendance.employees_checked_in),
      },
      attendance: {
        total: stats.totalCheckins,
        avgHours: stats.averageHours,
        geoCompliant,
      },
      leave,
      reports: {
        total: asInt(workReports.total_reports),
        submitted: asInt(workReports.submitted),
        reviewed: asInt(workReports.reviewed),
        approved: asInt(workReports.approved),
      },
      weekly: weeklyData.rows.map((row) => ({
        week: row.week,
        hours: asNumber(row.hours),
        lateArrivals: asInt(row.late_arrivals),
      })),
      departments,
    });
  } catch (error) {
    logger.error('Reports endpoint error', {
      error: error.message,
      employeeId,
      role,
      startDate,
      endDate,
    });

    res.status(500).json({
      success: false,
      message: 'Failed to fetch reports data',
    });
  }
});

module.exports = router;
