/**
 * DEPENDENCY VERIFICATION:
 * - Inbound dependencies: server.js
 * - Outbound dependencies: ../../config/database.js, ../../config/logger.js, ../security-monitoring/securityLogger.js
 * - Runtime dependencies: PostgreSQL connection pool
 *
 * IMPORT VERIFICATION:
 * - require('../../config/database') is valid and exports query
 * - require('../../config/logger') is valid and exports logger
 * - require('../security-monitoring/securityLogger') is valid and exports logAuditEvent
 *
 * REFERENCE VERIFICATION:
 * - Exports: router
 */

const express = require('express');
const router = express.Router();
const { query } = require('../../config/database');
const { logAuditEvent } = require('../security-monitoring/securityLogger');
const { logger } = require('../../config/logger');

const LEAVE_TYPES = new Set(['vacation', 'sick', 'personal', 'maternity', 'paternity']);

function toDateOnly(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function totalLeaveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
}

function canManageLeave(user) {
  return user.role === 'admin' || user.role === 'supervisor';
}

async function createNotification(employeeId, title, message, payload = {}) {
  await query(
    `INSERT INTO notifications (employee_id, type, title, message, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [employeeId, 'leave', title, message, JSON.stringify(payload)]
  );
}

router.post('/request', async (req, res) => {
  try {
    const leaveType = req.body.leaveType || req.body.leave_type;
    const startDate = toDateOnly(req.body.startDate || req.body.start_date);
    const endDate = toDateOnly(req.body.endDate || req.body.end_date);
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    if (!LEAVE_TYPES.has(leaveType) || !startDate || !endDate || reason.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Valid leave type, start date, end date, and reason are required',
      });
    }

    const days = totalLeaveDays(startDate, endDate);
    if (days <= 0 || days > 365) {
      return res.status(400).json({
        success: false,
        message: 'Leave date range is invalid',
      });
    }

    const employeeResult = await query(
      'SELECT supervisor_id FROM employees WHERE id = $1',
      [req.user.id]
    );
    let supervisorId = employeeResult.rows[0]?.supervisor_id || null;

    // Supervisor Leave: Supervisor -> Admin (fallback if supervisor_id is null)
    if (!supervisorId && req.user.role === 'supervisor') {
      const adminResult = await query(
        "SELECT id FROM employees WHERE role = 'admin' AND is_active = TRUE LIMIT 1"
      );
      if (adminResult.rows.length > 0) {
        supervisorId = adminResult.rows[0].id;
      }
    }

    const isAdmin = req.user.role === 'admin';
    const initialStatus = isAdmin ? 'approved' : 'pending';
    const approverId = isAdmin ? req.user.id : null;
    const approvalTimestampSql = isAdmin ? 'NOW()' : 'NULL';

    const result = await query(
      `INSERT INTO leave_requests
         (employee_id, supervisor_id, leave_type, start_date, end_date, total_days, reason, status, approver_id, approval_timestamp, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${approvalTimestampSql}, ${approvalTimestampSql})
       RETURNING *`,
      [req.user.id, supervisorId, leaveType, startDate, endDate, days, reason, initialStatus, approverId]
    );

    // If it's a supervisor requesting, notify their supervisor (Admin)
    if (supervisorId && !isAdmin) {
      await createNotification(
        supervisorId,
        'New leave request',
        `${req.user.employeeId} submitted a ${leaveType} leave request.`,
        { leaveRequestId: result.rows[0].id }
      );
    }

    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'leave.request.create',
      resourceType: 'leave_request',
      resourceId: String(result.rows[0].id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      details: { leaveType, startDate, endDate, days },
    });

    // Record in leave_approval_history for full audit chain
    try {
      await query(
        `INSERT INTO leave_approval_history
           (leave_request_id, action, actor_employee_id, actor_role,
            previous_status, new_status, reason, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, NULL, $5, $6, $7::inet, $8)`,
        [
          result.rows[0].id,
          isAdmin ? 'approve' : 'submit',
          req.user.id,
          req.user.role,
          initialStatus,
          reason || (isAdmin ? 'Self-authorized admin leave' : ''),
          req.ip,
          req.headers['user-agent'] || null,
        ]
      );
    } catch (histErr) {
      logger.warn('Leave history submit record failed', { error: histErr.message });
    }

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('Leave request submit error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to submit leave request' });
  }
});

router.get('/my-requests', async (req, res) => {
  try {
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 100);
    const result = await query(
      `SELECT lr.*
       FROM leave_requests lr
       WHERE lr.employee_id = $1
       ORDER BY lr.created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );

    return res.json(result.rows);
  } catch (error) {
    logger.error('Leave requests fetch error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to fetch leave requests' });
  }
});

router.get('/team-requests', async (req, res) => {
  try {
    if (!canManageLeave(req.user)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);
    const params = [limit];
    let scope = '';

    if (req.user.role === 'supervisor') {
      params.push(req.user.id);
      scope = `AND lr.supervisor_id = $2`;
    }

    const result = await query(
      `SELECT lr.*,
              json_build_object(
                'employee_id', e.employee_id,
                'first_name', e.first_name,
                'last_name', e.last_name,
                'department', e.department
              ) AS employee
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       WHERE 1=1 ${scope}
       ORDER BY lr.created_at DESC
       LIMIT $1`,
      params
    );

    return res.json(result.rows);
  } catch (error) {
    logger.error('Team leave requests fetch error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to fetch team leave requests' });
  }
});

router.get('/request/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const result = await query(
      `SELECT lr.*,
              json_build_object(
                'employee_id', e.employee_id,
                'first_name', e.first_name,
                'last_name', e.last_name,
                'department', e.department
              ) AS employee
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       WHERE lr.id = $1
         AND (
           lr.employee_id = $2
           OR $3::text = 'admin'
           OR lr.supervisor_id = $2
         )`,
      [id, req.user.id, req.user.role]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    logger.error('Leave request fetch error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to fetch leave request' });
  }
});

router.put('/request/:id/cancel', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const result = await query(
      `UPDATE leave_requests
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND employee_id = $2 AND status = 'pending'
       RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pending leave request not found' });
    }

    // Log cancellation in leave_approval_history
    try {
      await query(
        `INSERT INTO leave_approval_history
           (leave_request_id, action, actor_employee_id, actor_role,
            previous_status, new_status, reason, ip_address, user_agent)
         VALUES ($1, 'cancel', $2, $3, 'pending', 'cancelled', 'Cancelled by employee', $4::inet, $5)`,
        [
          id, req.user.id, req.user.role,
          req.ip, req.headers['user-agent'] || null,
        ]
      );
    } catch (histErr) {
      logger.warn('Leave cancellation history record failed', { error: histErr.message });
    }

    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'leave.request.cancel',
      resourceType: 'leave_request',
      resourceId: String(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });

    return res.json(result.rows[0]);
  } catch (error) {
    logger.error('Leave cancel error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to cancel leave request' });
  }
});

router.put('/request/:id/approve', async (req, res) => {
  try {
    if (!canManageLeave(req.user)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const id = Number.parseInt(req.params.id, 10);
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    // Update leave request
    const result = await query(
      `UPDATE leave_requests lr
       SET status = 'approved',
           approver_id = $2,
           approval_timestamp = NOW(),
           rejection_reason = NULL,
           updated_at = NOW()
       WHERE lr.id = $1
         AND lr.status = 'pending'
         AND ($3::text = 'admin' OR lr.supervisor_id = $2)
       RETURNING *`,
      [id, req.user.id, req.user.role]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pending leave request not found' });
    }

    const leaveRecord = result.rows[0];

    // Log approval in leave_approval_history
    try {
      await query(
        `INSERT INTO leave_approval_history
           (leave_request_id, action, actor_employee_id, actor_role,
            previous_status, new_status, reason, ip_address, user_agent)
         VALUES ($1, 'approve', $2, $3, 'pending', 'approved', $4, $5::inet, $6)`,
        [
          id, req.user.id, req.user.role, reason || null,
          req.ip, req.headers['user-agent'] || null,
        ]
      );
    } catch (histErr) {
      logger.warn('Leave approval history record failed', { error: histErr.message });
    }

    await createNotification(
      leaveRecord.employee_id,
      'Leave approved',
      'Your leave request has been approved.',
      { leaveRequestId: id }
    );

    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'leave.request.approve',
      resourceType: 'leave_request',
      resourceId: String(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      details: {
        leaveType: leaveRecord.leave_type,
        employeeId: leaveRecord.employee_id,
        startDate: leaveRecord.start_date,
        endDate: leaveRecord.end_date,
        approvedByRole: req.user.role
      }
    });

    return res.json(leaveRecord);
  } catch (error) {
    logger.error('Leave approve error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to approve leave request' });
  }
});

router.put('/request/:id/reject', async (req, res) => {
  try {
    if (!canManageLeave(req.user)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }

    const id = Number.parseInt(req.params.id, 10);
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';

    if (reason.length < 3) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    // Update leave request
    const result = await query(
      `UPDATE leave_requests lr
       SET status = 'rejected',
           approver_id = $2,
           approval_timestamp = NOW(),
           rejection_reason = $3,
           updated_at = NOW()
       WHERE lr.id = $1
         AND lr.status = 'pending'
         AND ($4::text = 'admin' OR lr.supervisor_id = $2)
       RETURNING *`,
      [id, req.user.id, reason, req.user.role]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pending leave request not found' });
    }

    const leaveRecord = result.rows[0];

    // Log rejection in leave_approval_history
    try {
      await query(
        `INSERT INTO leave_approval_history
           (leave_request_id, action, actor_employee_id, actor_role,
            previous_status, new_status, reason, ip_address, user_agent)
         VALUES ($1, 'reject', $2, $3, 'pending', 'rejected', $4, $5::inet, $6)`,
        [
          id, req.user.id, req.user.role, reason,
          req.ip, req.headers['user-agent'] || null,
        ]
      );
    } catch (histErr) {
      logger.warn('Leave rejection history record failed', { error: histErr.message });
    }

    await createNotification(
      leaveRecord.employee_id,
      'Leave rejected',
      'Your leave request has been rejected.',
      { leaveRequestId: id, reason }
    );

    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'leave.request.reject',
      resourceType: 'leave_request',
      resourceId: String(id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      details: {
        leaveType: leaveRecord.leave_type,
        employeeId: leaveRecord.employee_id,
        startDate: leaveRecord.start_date,
        endDate: leaveRecord.end_date,
        rejectionReason: reason,
        rejectedByRole: req.user.role
      }
    });

    return res.json(leaveRecord);
  } catch (error) {
    logger.error('Leave reject error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to reject leave request' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         COUNT(*)::int AS total_requests,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
         COALESCE(SUM(total_days) FILTER (WHERE status = 'approved' AND leave_type = 'vacation'), 0)::int AS vacation_days_used,
         COALESCE(SUM(total_days) FILTER (WHERE status = 'approved' AND leave_type = 'sick'), 0)::int AS sick_days_used
       FROM leave_requests
       WHERE employee_id = $1`,
      [req.user.id]
    );

    const row = result.rows[0];
    return res.json({
      totalRequests: row.total_requests,
      approved: row.approved,
      pending: row.pending,
      rejected: row.rejected,
      vacationDaysUsed: row.vacation_days_used,
      sickDaysUsed: row.sick_days_used,
    });
  } catch (error) {
    logger.error('Leave stats error', { error: error.message, userId: req.user?.id });
    return res.status(500).json({ success: false, message: 'Failed to fetch leave stats' });
  }
});

module.exports = router;
