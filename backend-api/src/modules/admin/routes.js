/**
 * ADMIN USER MANAGEMENT ROUTES
 * 
 * Endpoints for managing employees, supervisors, departments, and access control
 * 
 * Authorization: Admin-only endpoints
 * Scope: System-wide
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { requireRole, requirePermission } = require('../../middleware/rbac');
const { logAuditEvent } = require('../security-monitoring/securityLogger');

const router = express.Router();

// ============================================================================
// EMPLOYEE MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/employees
 * List all employees with optional filtering and pagination
 * Admin only
 */
router.get('/employees', requireRole('admin'), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const offset = (page - 1) * limit;
    const department = req.query.department ? req.query.department.toString() : null;
    const role = req.query.role ? req.query.role.toString() : null;
    const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : null;

    let filterQuery = 'WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (department) {
      paramCount++;
      filterQuery += ` AND department = $${paramCount}`;
      params.push(department);
    }

    if (role && ['employee', 'supervisor', 'admin'].includes(role)) {
      paramCount++;
      filterQuery += ` AND role = $${paramCount}`;
      params.push(role);
    }

    if (isActive !== null) {
      paramCount++;
      filterQuery += ` AND is_active = $${paramCount}`;
      params.push(isActive);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM employees ${filterQuery}`,
      params
    );

    const result = await query(
      `SELECT 
        id, employee_id, first_name, last_name, email, phone_number,
        department, position, role, supervisor_id, hire_date, is_active,
        face_enrolled, mfa_enabled, created_at, updated_at
       FROM employees
       ${filterQuery}
       ORDER BY first_name, last_name
       LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
      }
    });
  } catch (error) {
    logger.error('Employee list error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

/**
 * POST /api/admin/employees
 * Create new employee
 * Admin only
 */
router.post('/employees', requireRole('admin'), async (req, res) => {
  try {
    const {
      employeeId, firstName, lastName, email, phoneNumber,
      department, position, role, supervisorId, hireDate, password
    } = req.body;

    // Validation
    if (!employeeId || !firstName || !lastName || !email || !department || !position || !hireDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['employee', 'supervisor', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if employee_id or email already exists
    const existsResult = await query(
      'SELECT id FROM employees WHERE employee_id = $1 OR email = $2',
      [employeeId, email]
    );

    if (existsResult.rows.length > 0) {
      return res.status(409).json({ error: 'Employee ID or email already exists' });
    }

    // Hash password
    const passwordHash = password 
      ? await bcrypt.hash(password, 10)
      : await bcrypt.hash(uuidv4().slice(0, 16), 10); // Generate random if not provided

    // Insert employee
    const result = await query(
      `INSERT INTO employees (
        employee_id, first_name, last_name, email, phone_number,
        department, position, role, supervisor_id, hire_date,
        password_hash, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, NOW(), NOW())
      RETURNING id, employee_id, first_name, last_name, email, role`,
      [
        employeeId, firstName, lastName, email, phoneNumber || null,
        department, position, role, supervisorId || null, hireDate,
        passwordHash
      ]
    );

    const newEmployee = result.rows[0];

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'employee.create',
      resourceType: 'employee',
      resourceId: String(newEmployee.id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { employeeId: newEmployee.employee_id, role }
    });

    res.status(201).json({
      success: true,
      data: newEmployee,
      message: 'Employee created successfully'
    });
  } catch (error) {
    logger.error('Employee create error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

/**
 * PUT /api/admin/employees/:employeeId
 * Update employee details
 * Admin only
 */
router.put('/employees/:employeeId', requireRole('admin'), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      firstName, lastName, email, phoneNumber,
      department, position, role, supervisorId, isActive
    } = req.body;

    // Fetch existing employee
    const empResult = await query(
      'SELECT id FROM employees WHERE id = $1 OR employee_id = $2',
      [isNaN(employeeId) ? null : parseInt(employeeId, 10), employeeId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const empId = empResult.rows[0].id;

    // Build update query
    const updates = [];
    const values = [empId];
    let paramCount = 1;

    if (firstName !== undefined) {
      paramCount++;
      updates.push(`first_name = $${paramCount}`);
      values.push(firstName);
    }
    if (lastName !== undefined) {
      paramCount++;
      updates.push(`last_name = $${paramCount}`);
      values.push(lastName);
    }
    if (email !== undefined) {
      if (!validator.isEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      paramCount++;
      updates.push(`email = $${paramCount}`);
      values.push(email);
    }
    if (phoneNumber !== undefined) {
      paramCount++;
      updates.push(`phone_number = $${paramCount}`);
      values.push(phoneNumber);
    }
    if (department !== undefined) {
      paramCount++;
      updates.push(`department = $${paramCount}`);
      values.push(department);
    }
    if (position !== undefined) {
      paramCount++;
      updates.push(`position = $${paramCount}`);
      values.push(position);
    }
    if (role !== undefined && ['employee', 'supervisor', 'admin'].includes(role)) {
      paramCount++;
      updates.push(`role = $${paramCount}`);
      values.push(role);
    }
    if (supervisorId !== undefined) {
      paramCount++;
      updates.push(`supervisor_id = $${paramCount}`);
      values.push(supervisorId || null);
    }
    if (isActive !== undefined) {
      paramCount++;
      updates.push(`is_active = $${paramCount}`);
      values.push(isActive);
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updateResult = await query(
      `UPDATE employees SET ${updates.join(', ')} WHERE id = $1 RETURNING id, employee_id, first_name, last_name, role`,
      values
    );

    const updatedEmployee = updateResult.rows[0];

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'employee.update',
      resourceType: 'employee',
      resourceId: String(empId),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { updatedFields: Object.keys(req.body).filter(k => req.body[k] !== undefined) }
    });

    res.json({
      success: true,
      data: updatedEmployee,
      message: 'Employee updated successfully'
    });
  } catch (error) {
    logger.error('Employee update error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

/**
 * DELETE /api/admin/employees/:employeeId
 * Soft-delete employee (set is_active = false)
 * Admin only
 */
router.delete('/employees/:employeeId', requireRole('admin'), async (req, res) => {
  try {
    const { employeeId } = req.params;

    const empResult = await query(
      'SELECT id, employee_id FROM employees WHERE id = $1 OR employee_id = $2',
      [isNaN(employeeId) ? null : parseInt(employeeId, 10), employeeId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const empId = empResult.rows[0].id;
    const empIdStr = empResult.rows[0].employee_id;

    // Soft delete
    await query(
      'UPDATE employees SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
      [empId]
    );

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'employee.deactivate',
      resourceType: 'employee',
      resourceId: String(empId),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { deactivatedEmployeeId: empIdStr }
    });

    res.json({
      success: true,
      message: 'Employee deactivated successfully'
    });
  } catch (error) {
    logger.error('Employee delete error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// ============================================================================
// SUPERVISOR ASSIGNMENT MANAGEMENT
// ============================================================================

/**
 * POST /api/admin/supervisors/:supervisorId/assign-employees
 * Assign employees to a supervisor
 * Admin only
 */
router.post('/supervisors/:supervisorId/assign-employees', requireRole('admin'), async (req, res) => {
  try {
    const { supervisorId } = req.params;
    const { employeeIds } = req.body;

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'employeeIds must be a non-empty array' });
    }

    // Verify supervisor exists and is actually a supervisor or admin
    const supResult = await query(
      'SELECT id, role FROM employees WHERE id = $1 OR employee_id = $2',
      [isNaN(supervisorId) ? null : parseInt(supervisorId, 10), supervisorId]
    );

    if (supResult.rows.length === 0) {
      return res.status(404).json({ error: 'Supervisor not found' });
    }

    const supId = supResult.rows[0].id;
    const supRole = supResult.rows[0].role;

    if (!['supervisor', 'admin'].includes(supRole)) {
      return res.status(400).json({ error: 'User is not a supervisor or admin' });
    }

    // Clear existing assignments and create new ones
    await query(
      'DELETE FROM supervisor_assignments WHERE supervisor_id = $1 AND is_active = TRUE',
      [supId]
    );

    let assignedCount = 0;
    for (const empId of employeeIds) {
      try {
        await query(
          `INSERT INTO supervisor_assignments (supervisor_id, employee_id, assigned_by, assigned_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (supervisor_id, employee_id) DO UPDATE
           SET is_active = TRUE, assigned_at = NOW()`,
          [supId, empId, req.user.id]
        );
        assignedCount++;
      } catch (e) {
        logger.warn(`Failed to assign employee ${empId}`, { error: e.message });
      }
    }

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'supervisor.assign-employees',
      resourceType: 'supervisor_assignment',
      resourceId: String(supId),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { employeeCount: assignedCount }
    });

    res.json({
      success: true,
      message: `Assigned ${assignedCount} employees to supervisor`,
      assignedCount
    });
  } catch (error) {
    logger.error('Supervisor assignment error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to assign employees' });
  }
});

/**
 * GET /api/admin/supervisors/:supervisorId/employees
 * Get employees assigned to a supervisor
 * Admin only
 */
router.get('/supervisors/:supervisorId/employees', requireRole('admin'), async (req, res) => {
  try {
    const { supervisorId } = req.params;

    const result = await query(
      `SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email,
              e.department, e.position, e.role, e.is_active
       FROM employees e
       INNER JOIN supervisor_assignments sa ON e.id = sa.employee_id
       WHERE sa.supervisor_id = $1 AND sa.is_active = TRUE
       ORDER BY e.first_name, e.last_name`,
      [supervisorId]
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Get supervised employees error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch assigned employees' });
  }
});

/**
 * DELETE /api/admin/supervisors/:supervisorId/employees/:employeeId
 * Remove employee from supervisor
 * Admin only
 */
router.delete('/supervisors/:supervisorId/employees/:employeeId', requireRole('admin'), async (req, res) => {
  try {
    const { supervisorId, employeeId } = req.params;

    await query(
      `UPDATE supervisor_assignments
       SET is_active = FALSE
       WHERE supervisor_id = $1 AND employee_id = $2`,
      [supervisorId, employeeId]
    );

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'supervisor.unassign-employee',
      resourceType: 'supervisor_assignment',
      resourceId: `${supervisorId}-${employeeId}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {}
    });

    res.json({
      success: true,
      message: 'Employee removed from supervisor'
    });
  } catch (error) {
    logger.error('Unassign employee error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to remove employee' });
  }
});

// ============================================================================
// DEPARTMENT MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/departments
 * List all departments
 * Admin only
 */
router.get('/departments', requireRole('admin'), async (req, res) => {
  try {
    const result = await query(
      `SELECT id, department_name, department_head_id, max_employees, is_active, created_at
       FROM department_config
       ORDER BY department_name`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Department list error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

/**
 * POST /api/admin/departments
 * Create department
 * Admin only
 */
router.post('/departments', requireRole('admin'), async (req, res) => {
  try {
    const { departmentName, departmentHeadId, maxEmployees } = req.body;

    if (!departmentName) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    const result = await query(
      `INSERT INTO department_config (department_name, department_head_id, max_employees)
       VALUES ($1, $2, $3)
       RETURNING id, department_name, department_head_id, max_employees`,
      [departmentName, departmentHeadId || null, maxEmployees || null]
    );

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'department.create',
      resourceType: 'department',
      resourceId: String(result.rows[0].id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { departmentName }
    });

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Department create error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to create department' });
  }
});

// ============================================================================
// WORK TIMINGS MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/work-timings
 * List all work timing configurations
 * Admin or Supervisor
 */
router.get('/work-timings', requireRole('supervisor'), async (req, res) => {
  try {
    const result = await query(
      `SELECT id, employee_id, department, work_start_time, work_end_time,
              lunch_start_time, lunch_end_time, is_active
       FROM work_timings
       WHERE is_active = TRUE
       ORDER BY department, employee_id`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Work timings list error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch work timings' });
  }
});

/**
 * POST /api/admin/work-timings
 * Create work timing configuration
 * Admin only
 */
router.post('/work-timings', requireRole('admin'), async (req, res) => {
  try {
    const { employeeId, department, workStartTime, workEndTime, lunchStartTime, lunchEndTime } = req.body;

    if (!workStartTime || !workEndTime) {
      return res.status(400).json({ error: 'Work start and end times are required' });
    }

    const result = await query(
      `INSERT INTO work_timings (employee_id, department, work_start_time, work_end_time, lunch_start_time, lunch_end_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, employee_id, department, work_start_time, work_end_time`,
      [employeeId || null, department || null, workStartTime, workEndTime, lunchStartTime || null, lunchEndTime || null]
    );

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'work-timing.create',
      resourceType: 'work_timing',
      resourceId: String(result.rows[0].id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { workStartTime, workEndTime }
    });

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Work timing create error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to create work timing' });
  }
});

// ============================================================================
// ORGANIZATIONAL HIERARCHY
// ============================================================================

/**
 * GET /api/admin/hierarchy
 * Get complete organizational hierarchy (Admin only)
 * Returns: Array of supervisors with their assigned employees
 * Admin only
 */
router.get('/hierarchy', requireRole('admin'), async (req, res) => {
  try {
    // Fetch all supervisors with their assigned employees
    const supervisorHierarchy = await query(
      `SELECT 
         s.id, s.employee_id, s.first_name, s.last_name, s.email, s.department,
         json_agg(
           json_build_object(
             'id', e.id, 'employee_id', e.employee_id, 'first_name', e.first_name,
             'last_name', e.last_name, 'email', e.email, 'position', e.position,
             'department', e.department, 'is_active', e.is_active
           ) ORDER BY e.first_name, e.last_name
         ) FILTER (WHERE e.id IS NOT NULL) AS assigned_employees,
         COUNT(DISTINCT e.id) FILTER (WHERE e.is_active = TRUE) AS active_employee_count
       FROM employees s
       LEFT JOIN employees e ON s.id = e.supervisor_id AND e.is_active = TRUE
       WHERE s.role IN ('supervisor', 'admin') AND s.is_active = TRUE
       GROUP BY s.id, s.employee_id, s.first_name, s.last_name, s.email, s.department
       ORDER BY s.first_name, s.last_name`
    );

    // Fetch unassigned employees (those without supervisors)
    const unassignedEmployees = await query(
      `SELECT id, employee_id, first_name, last_name, email, position, department, is_active
       FROM employees
       WHERE role = 'employee' AND supervisor_id IS NULL AND is_active = TRUE
       ORDER BY first_name, last_name`
    );

    res.json({
      success: true,
      data: {
        supervisors: supervisorHierarchy.rows,
        unassignedEmployees: unassignedEmployees.rows,
        totalSupervisors: supervisorHierarchy.rows.length,
        totalUnassignedEmployees: unassignedEmployees.rows.length,
        totalActiveEmployees: supervisorHierarchy.rows.reduce((sum, s) => sum + (s.active_employee_count || 0), 0)
      }
    });
  } catch (error) {
    logger.error('Hierarchy fetch error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch organizational hierarchy' });
  }
});

// ============================================================================
// SUPERVISOR TEAM MANAGEMENT (Supervisor-facing endpoints)
// ============================================================================

/**
 * GET /api/supervisor/team
 * Get supervisor's assigned employees (Supervisor only)
 * Returns: List of employees assigned to requesting supervisor
 * Supervisor+ only
 */
router.get('/supervisor/team', requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const result = await query(
      `SELECT e.id, e.employee_id, e.first_name, e.last_name, e.email,
              e.phone_number, e.department, e.position, e.hire_date, e.is_active,
              (SELECT COUNT(*) FROM attendance_records 
               WHERE employee_id = e.id AND check_in_time::DATE = CURRENT_DATE) AS checked_in_today,
              (SELECT status FROM leave_requests 
               WHERE employee_id = e.id AND status = 'pending' LIMIT 1) AS pending_leave_status
       FROM employees e
       WHERE e.supervisor_id = $1 AND e.is_active = TRUE
       ORDER BY e.first_name, e.last_name`,
      [supervisorId]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Supervisor team fetch error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

/**
 * GET /api/supervisor/team/:employeeId/attendance
 * Get attendance history for one of supervisor's employees
 * Supervisor+ only
 */
router.get('/supervisor/team/:employeeId/attendance', requireRole('supervisor'), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { employeeId } = req.params;
    const { startDate, endDate, limit = 30, offset = 0 } = req.query;

    // Verify employee belongs to supervisor
    const empCheck = await query(
      'SELECT id FROM employees WHERE id = $1 AND supervisor_id = $2',
      [employeeId, supervisorId]
    );

    if (empCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied. Employee not in your team.' });
    }

    let dateFilter = '';
    const params = [employeeId];
    let paramCount = 1;

    if (startDate && endDate) {
      paramCount += 2;
      dateFilter = `AND ar.check_in_time::DATE BETWEEN $2::DATE AND $3::DATE`;
      params.push(startDate, endDate);
    }

    paramCount++;
    const limitParam = paramCount;
    paramCount++;
    const offsetParam = paramCount;
    params.push(limit, offset);

    const result = await query(
      `SELECT id, check_in_time, check_out_time, work_hours, location,
              geo_fence_status, distance_from_office
       FROM attendance_records
       WHERE employee_id = $1 ${dateFilter}
       ORDER BY check_in_time DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      limit,
      offset
    });
  } catch (error) {
    logger.error('Supervisor employee attendance fetch error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

/**
 * POST /api/admin/employees/:employeeId/mfa/reset
 * Reset/disable MFA for a specific employee
 * Admin only
 */
router.post('/employees/:employeeId/mfa/reset', requireRole('admin'), async (req, res) => {
  try {
    const { employeeId } = req.params;

    const empResult = await query(
      'SELECT id, employee_id, first_name, last_name FROM employees WHERE id = $1 OR employee_id = $2',
      [isNaN(employeeId) ? null : parseInt(employeeId, 10), employeeId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const emp = empResult.rows[0];

    await query(
      `UPDATE employees 
       SET mfa_secret = NULL, 
           mfa_enabled = false, 
           mfa_pending_secret = NULL,
           mfa_backup_codes = NULL,
           updated_at = NOW() 
       WHERE id = $1`,
      [emp.id]
    );

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'employee.mfa.reset',
      resourceType: 'employee_mfa',
      resourceId: String(emp.id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { resetEmployeeId: emp.employee_id }
    });

    res.json({
      success: true,
      message: `MFA reset successfully for ${emp.first_name} ${emp.last_name}`
    });
  } catch (error) {
    logger.error('Employee MFA reset error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to reset employee MFA' });
  }
});

/**
 * POST /api/admin/supervisor/create-employee
 * Create employee under the supervisor's supervision
 * Supervisor/Admin only
 */
router.post('/supervisor/create-employee', requireRole('supervisor'), async (req, res) => {
  try {
    const {
      employeeId, firstName, lastName, email, phoneNumber,
      department, position, hireDate, password
    } = req.body;

    const supervisorId = req.user.id; // Requesting supervisor's employee primary ID

    // Validation
    if (!employeeId || !firstName || !lastName || !email || !department || !position || !hireDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if employee_id or email already exists
    const existsResult = await query(
      'SELECT id FROM employees WHERE employee_id = $1 OR email = $2',
      [employeeId, email]
    );

    if (existsResult.rows.length > 0) {
      return res.status(409).json({ error: 'Employee ID or email already exists' });
    }

    // Hash password
    const passwordHash = password 
      ? await bcrypt.hash(password, 10)
      : await bcrypt.hash(uuidv4().slice(0, 16), 10); // Generate random if not provided

    await query('BEGIN');

    // Insert employee (force supervisor_id to requesting supervisor's ID)
    const result = await query(
      `INSERT INTO employees (
        employee_id, first_name, last_name, email, phone_number,
        department, position, role, supervisor_id, hire_date,
        password_hash, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'employee', $8, $9, $10, TRUE, NOW(), NOW())
      RETURNING id, employee_id, first_name, last_name, email, role, supervisor_id`,
      [
        employeeId, firstName, lastName, email, phoneNumber || null,
        department, position, supervisorId, hireDate, passwordHash
      ]
    );

    const newEmployee = result.rows[0];

    // Create entry in supervisor_assignments
    await query(
      `INSERT INTO supervisor_assignments (supervisor_id, employee_id, department, assigned_by, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (supervisor_id, employee_id) DO UPDATE SET is_active = TRUE`,
      [supervisorId, newEmployee.id, department, supervisorId]
    );

    await query('COMMIT');

    // Log audit event
    await logAuditEvent({
      actorEmployeeId: req.user.employeeId,
      action: 'supervisor.employee.create',
      resourceType: 'employee',
      resourceId: String(newEmployee.id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { employeeId: newEmployee.employee_id, supervisorId: req.user.employeeId }
    });

    res.status(201).json({
      success: true,
      data: newEmployee,
      message: 'Employee created and assigned to supervisor successfully'
    });
  } catch (error) {
    await query('ROLLBACK').catch(() => {});
    logger.error('Supervisor employee create error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

module.exports = router;
