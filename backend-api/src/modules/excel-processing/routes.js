const express = require('express');
const router = express.Router();
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { authenticateToken } = require('../../middleware/authMiddleware');
const { requireRole } = require('../../middleware/rbac');
const ExcelJS = require('exceljs');

/**
 * V9 — EXCEL PROCESSING MODULE (Real .xlsx Generation)
 *
 * All endpoints now generate actual Excel .xlsx binary files using ExcelJS.
 * All routes are authenticated and RBAC-enforced.
 * Supervisor scope filtering applied for non-admin users.
 */

// Helper to apply common styling to header rows
function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A5F' },
    };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  });
  row.height = 28;
}

// Helper to style data rows with alternating colors
function styleDataRow(row, rowIndex) {
  const bgColor = rowIndex % 2 === 0 ? 'FFFAFAFA' : 'FFFFFFFF';
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: bgColor },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
    cell.border = {
      top: { style: 'hair' },
      left: { style: 'hair' },
      bottom: { style: 'hair' },
      right: { style: 'hair' },
    };
  });
  row.height = 22;
}

// GET /api/excel/attendance - Download attendance data as a real .xlsx file
// Requires: supervisor or admin role
router.get('/attendance', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const { start_date, end_date, department } = req.query;

    let queryText = `
      SELECT 
        e.employee_id,
        e.first_name,
        e.last_name,
        e.department,
        a.check_in_time,
        a.check_out_time,
        CASE WHEN a.check_out_time IS NULL THEN 'Active' ELSE 'Completed' END AS status,
        a.geo_fence_status,
        ROUND(a.distance_from_office::numeric, 0) AS distance_meters,
        DATE(a.check_in_time) as date
      FROM attendance_records a
      JOIN employees e ON a.employee_id = e.id
      WHERE a.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 0;

    // Supervisor scope: only their assigned employees
    if (req.user.role === 'supervisor') {
      paramCount++;
      queryText += `
        AND a.employee_id IN (
          SELECT employee_id FROM supervisor_assignments
          WHERE supervisor_id = $${paramCount} AND is_active = TRUE
        )`;
      params.push(req.user.id);
    }

    if (start_date) {
      paramCount++;
      queryText += ` AND DATE(a.check_in_time) >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      queryText += ` AND DATE(a.check_in_time) <= $${paramCount}`;
      params.push(end_date);
    }

    if (department) {
      paramCount++;
      queryText += ` AND e.department = $${paramCount}`;
      params.push(department);
    }

    queryText += ' ORDER BY e.employee_id, a.check_in_time DESC';

    const result = await query(queryText, params);

    // If client wants JSON (for programmatic use)
    if (req.headers.accept === 'application/json') {
      return res.json({ success: true, data: result.rows, count: result.rows.length });
    }

    // Build Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Enterprise Attendance System';
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Attendance Report', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });

    // Set column widths
    sheet.columns = [
      { header: 'Employee ID',      key: 'employee_id',         width: 16 },
      { header: 'First Name',       key: 'first_name',          width: 18 },
      { header: 'Last Name',        key: 'last_name',           width: 18 },
      { header: 'Department',       key: 'department',          width: 20 },
      { header: 'Date',             key: 'date',                width: 14 },
      { header: 'Check-in Time',    key: 'check_in_time',       width: 22 },
      { header: 'Check-out Time',   key: 'check_out_time',      width: 22 },
      { header: 'Status',           key: 'status',              width: 14 },
      { header: 'Geo-fence',        key: 'geo_fence_status',    width: 14 },
      { header: 'Distance (m)',     key: 'distance_meters',     width: 16 },
    ];

    // Style header row
    styleHeaderRow(sheet.getRow(1));

    // Add data rows
    result.rows.forEach((row, idx) => {
      const dataRow = sheet.addRow({
        employee_id: row.employee_id,
        first_name: row.first_name,
        last_name: row.last_name,
        department: row.department,
        date: row.date ? String(row.date).split('T')[0] : '',
        check_in_time: row.check_in_time ? new Date(row.check_in_time).toLocaleString() : '',
        check_out_time: row.check_out_time ? new Date(row.check_out_time).toLocaleString() : 'Still checked in',
        status: row.status,
        geo_fence_status: row.geo_fence_status ? 'Within fence' : 'Outside fence',
        distance_meters: row.distance_meters !== null ? Number(row.distance_meters) : 'N/A',
      });
      styleDataRow(dataRow, idx + 1);
    });

    // Add summary footer
    const summaryRow = sheet.addRow({
      employee_id: `Total Records: ${result.rows.length}`,
    });
    summaryRow.font = { bold: true, italic: true, color: { argb: 'FF555555' } };

    // Stream response
    const filename = `attendance-report-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    await workbook.xlsx.write(res);
    res.end();

    logger.info('Attendance Excel export generated', {
      userId: req.user.id,
      rowCount: result.rows.length,
      filters: { start_date, end_date, department },
    });
  } catch (error) {
    logger.error('Excel attendance export error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to generate attendance report' });
  }
});

// GET /api/excel/leave - Download leave data as a real .xlsx file
// Requires: supervisor or admin role
router.get('/leave', authenticateToken, requireRole('supervisor'), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let queryText = `
      SELECT 
        e.employee_id,
        e.first_name,
        e.last_name,
        e.department,
        l.leave_type,
        l.start_date,
        l.end_date,
        l.total_days,
        l.status,
        l.reason,
        l.rejection_reason,
        l.created_at
      FROM leave_requests l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 0;

    // Supervisor scope
    if (req.user.role === 'supervisor') {
      paramCount++;
      queryText += `
        AND l.employee_id IN (
          SELECT employee_id FROM supervisor_assignments
          WHERE supervisor_id = $${paramCount} AND is_active = TRUE
        )`;
      params.push(req.user.id);
    }

    if (start_date) {
      paramCount++;
      queryText += ` AND l.start_date >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      queryText += ` AND l.end_date <= $${paramCount}`;
      params.push(end_date);
    }

    queryText += ' ORDER BY l.created_at DESC';

    const result = await query(queryText, params);

    // If client wants JSON
    if (req.headers.accept === 'application/json') {
      return res.json({ success: true, data: result.rows, count: result.rows.length });
    }

    // Build Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Enterprise Attendance System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Leave Report', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });

    sheet.columns = [
      { header: 'Employee ID',     key: 'employee_id',       width: 16 },
      { header: 'First Name',      key: 'first_name',        width: 18 },
      { header: 'Last Name',       key: 'last_name',         width: 18 },
      { header: 'Department',      key: 'department',        width: 20 },
      { header: 'Leave Type',      key: 'leave_type',        width: 16 },
      { header: 'Start Date',      key: 'start_date',        width: 14 },
      { header: 'End Date',        key: 'end_date',          width: 14 },
      { header: 'Total Days',      key: 'total_days',        width: 12 },
      { header: 'Status',          key: 'status',            width: 14 },
      { header: 'Reason',          key: 'reason',            width: 40 },
      { header: 'Rejection Reason', key: 'rejection_reason', width: 40 },
      { header: 'Submitted At',    key: 'created_at',        width: 22 },
    ];

    styleHeaderRow(sheet.getRow(1));

    result.rows.forEach((row, idx) => {
      const dataRow = sheet.addRow({
        employee_id: row.employee_id,
        first_name: row.first_name,
        last_name: row.last_name,
        department: row.department,
        leave_type: row.leave_type,
        start_date: String(row.start_date).split('T')[0],
        end_date: String(row.end_date).split('T')[0],
        total_days: row.total_days,
        status: row.status,
        reason: row.reason,
        rejection_reason: row.rejection_reason || '',
        created_at: new Date(row.created_at).toLocaleString(),
      });
      styleDataRow(dataRow, idx + 1);
    });

    const summaryRow = sheet.addRow({ employee_id: `Total Records: ${result.rows.length}` });
    summaryRow.font = { bold: true, italic: true, color: { argb: 'FF555555' } };

    const filename = `leave-report-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    await workbook.xlsx.write(res);
    res.end();

    logger.info('Leave Excel export generated', {
      userId: req.user.id,
      rowCount: result.rows.length,
    });
  } catch (error) {
    logger.error('Excel leave export error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to generate leave report' });
  }
});

// POST /api/excel/upload - Upload employee data via JSON (admin only)
// Requires: admin role
router.post('/upload', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { employees } = req.body;

    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid employee data' });
    }

    if (employees.length > 500) {
      return res.status(400).json({ success: false, message: 'Maximum 500 employees per upload' });
    }

    const results = { inserted: 0, skipped: 0, errors: [] };

    for (const emp of employees) {
      try {
        await query(
          `INSERT INTO employees
           (employee_id, first_name, last_name, department, position, email, role, hire_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE))
           ON CONFLICT (employee_id) DO UPDATE
           SET first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               department = EXCLUDED.department,
               position = EXCLUDED.position,
               email = EXCLUDED.email,
               role = EXCLUDED.role,
               updated_at = NOW()`,
          [
            emp.employee_id,
            emp.first_name,
            emp.last_name,
            emp.department,
            emp.position || 'Employee',
            emp.email,
            emp.role || 'employee',
            emp.hire_date || null,
          ]
        );
        results.inserted++;
      } catch (err) {
        results.skipped++;
        results.errors.push({ employee_id: emp.employee_id, error: err.message });
      }
    }

    logger.info('Excel upload processed', { userId: req.user.id, results });
    res.json({ success: true, results });
  } catch (error) {
    logger.error('Excel upload error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to process upload' });
  }
});

// GET /api/excel/employees - Download employee roster as .xlsx
// Requires: admin role
router.get('/employees', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { department, role: filterRole } = req.query;
    let queryText = `
      SELECT
        e.employee_id,
        e.first_name,
        e.last_name,
        e.email,
        e.role,
        e.department,
        e.position,
        e.phone_number,
        e.hire_date,
        e.is_active,
        e.face_enrolled,
        e.face_enrolled_at,
        e.created_at,
        sup.employee_id AS supervisor_employee_id,
        sup.first_name AS supervisor_first_name,
        sup.last_name AS supervisor_last_name
      FROM employees e
      LEFT JOIN employees sup ON e.supervisor_id = sup.id
      WHERE e.deleted_at IS NULL
    `;

    const params = [];
    let paramCount = 0;

    if (department) {
      paramCount++;
      queryText += ` AND e.department = $${paramCount}`;
      params.push(department);
    }

    if (filterRole) {
      paramCount++;
      queryText += ` AND e.role = $${paramCount}`;
      params.push(filterRole);
    }

    queryText += ' ORDER BY e.department, e.employee_id';

    const result = await query(queryText, params);

    if (req.headers.accept === 'application/json') {
      return res.json({ success: true, data: result.rows, count: result.rows.length });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Enterprise Attendance System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Employee Roster', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });

    sheet.columns = [
      { header: 'Employee ID',      key: 'employee_id',              width: 16 },
      { header: 'First Name',       key: 'first_name',               width: 18 },
      { header: 'Last Name',        key: 'last_name',                width: 18 },
      { header: 'Email',            key: 'email',                    width: 30 },
      { header: 'Role',             key: 'role',                     width: 14 },
      { header: 'Department',       key: 'department',               width: 22 },
      { header: 'Position',         key: 'position',                 width: 22 },
      { header: 'Phone',            key: 'phone_number',             width: 16 },
      { header: 'Hire Date',        key: 'hire_date',                width: 14 },
      { header: 'Active',           key: 'is_active',                width: 10 },
      { header: 'Face Enrolled',    key: 'face_enrolled',            width: 14 },
      { header: 'Face Enrolled At', key: 'face_enrolled_at',         width: 22 },
      { header: 'Supervisor ID',    key: 'supervisor_employee_id',   width: 16 },
      { header: 'Supervisor',       key: 'supervisor_name',          width: 26 },
      { header: 'Created At',       key: 'created_at',               width: 22 },
    ];

    styleHeaderRow(sheet.getRow(1));

    result.rows.forEach((row, idx) => {
      const dataRow = sheet.addRow({
        employee_id: row.employee_id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        role: row.role,
        department: row.department,
        position: row.position,
        phone_number: row.phone_number || '',
        hire_date: row.hire_date ? String(row.hire_date).split('T')[0] : '',
        is_active: row.is_active ? 'Yes' : 'No',
        face_enrolled: row.face_enrolled ? 'Yes' : 'No',
        face_enrolled_at: row.face_enrolled_at ? new Date(row.face_enrolled_at).toLocaleString() : 'Not enrolled',
        supervisor_employee_id: row.supervisor_employee_id || '',
        supervisor_name: row.supervisor_first_name
          ? `${row.supervisor_first_name} ${row.supervisor_last_name}`
          : 'No supervisor',
        created_at: new Date(row.created_at).toLocaleString(),
      });
      styleDataRow(dataRow, idx + 1);
    });

    const summaryRow = sheet.addRow({ employee_id: `Total: ${result.rows.length} employees` });
    summaryRow.font = { bold: true, italic: true, color: { argb: 'FF555555' } };

    const filename = `employees-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    await workbook.xlsx.write(res);
    res.end();

    logger.info('Employee Excel export generated', {
      userId: req.user.id,
      rowCount: result.rows.length,
    });
  } catch (error) {
    logger.error('Excel employees export error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to generate employee report' });
  }
});

// GET /api/excel/audit-logs - Download audit log as .xlsx (admin only)
router.get('/audit-logs', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { start_date, end_date, action_type } = req.query;

    let queryText = `
      SELECT
        al.id,
        al.action,
        al.resource_type,
        al.resource_id,
        al.ip_address,
        al.user_agent,
        al.created_at,
        al.details,
        e.employee_id AS actor_employee_id,
        e.first_name  AS actor_first_name,
        e.last_name   AS actor_last_name
      FROM audit_logs al
      LEFT JOIN employees e ON al.actor_employee_id = e.employee_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    if (start_date) {
      paramCount++;
      queryText += ` AND al.created_at >= $${paramCount}`;
      params.push(new Date(start_date));
    }

    if (end_date) {
      paramCount++;
      queryText += ` AND al.created_at <= $${paramCount}`;
      params.push(new Date(end_date));
    }

    if (action_type) {
      paramCount++;
      queryText += ` AND al.action ILIKE $${paramCount}`;
      params.push(`%${action_type}%`);
    }

    queryText += ' ORDER BY al.created_at DESC LIMIT 5000';

    const result = await query(queryText, params);

    if (req.headers.accept === 'application/json') {
      return res.json({ success: true, data: result.rows, count: result.rows.length });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Enterprise Attendance System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Audit Log', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });

    sheet.columns = [
      { header: 'ID',            key: 'id',                   width: 10 },
      { header: 'Actor ID',      key: 'actor_employee_id',    width: 14 },
      { header: 'Actor Name',    key: 'actor_name',           width: 26 },
      { header: 'Action',        key: 'action',               width: 30 },
      { header: 'Resource Type', key: 'resource_type',        width: 20 },
      { header: 'Resource ID',   key: 'resource_id',          width: 16 },
      { header: 'IP Address',    key: 'ip_address',           width: 18 },
      { header: 'Details',       key: 'details',              width: 50 },
      { header: 'Timestamp',     key: 'created_at',           width: 22 },
    ];

    styleHeaderRow(sheet.getRow(1));

    result.rows.forEach((row, idx) => {
      const dataRow = sheet.addRow({
        id: row.id,
        actor_employee_id: row.actor_employee_id || 'system',
        actor_name: row.actor_first_name ? `${row.actor_first_name} ${row.actor_last_name}` : 'System',
        action: row.action,
        resource_type: row.resource_type,
        resource_id: row.resource_id || '',
        ip_address: row.ip_address || '',
        details: typeof row.details === 'object' ? JSON.stringify(row.details) : String(row.details || ''),
        created_at: new Date(row.created_at).toLocaleString(),
      });
      styleDataRow(dataRow, idx + 1);
    });

    const filename = `audit-log-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    await workbook.xlsx.write(res);
    res.end();

    logger.info('Audit log Excel export generated', { userId: req.user.id, rowCount: result.rows.length });
  } catch (error) {
    logger.error('Excel audit log export error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to generate audit log export' });
  }
});

// GET /api/excel/security-events - Download security events as .xlsx (admin only)
router.get('/security-events', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { start_date, end_date, event_type, severity } = req.query;

    let queryText = `
      SELECT
        se.id,
        se.event_type,
        se.severity,
        se.ip_address,
        se.device_info,
        se.details,
        se.created_at,
        e.employee_id,
        e.first_name,
        e.last_name,
        e.role AS employee_role
      FROM security_events se
      LEFT JOIN employees e ON se.employee_id = e.employee_id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    if (start_date) {
      paramCount++;
      queryText += ` AND se.created_at >= $${paramCount}`;
      params.push(new Date(start_date));
    }

    if (end_date) {
      paramCount++;
      queryText += ` AND se.created_at <= $${paramCount}`;
      params.push(new Date(end_date));
    }

    if (event_type) {
      paramCount++;
      queryText += ` AND se.event_type = $${paramCount}`;
      params.push(event_type);
    }

    if (severity) {
      paramCount++;
      queryText += ` AND se.severity = $${paramCount}`;
      params.push(severity);
    }

    queryText += ' ORDER BY se.created_at DESC LIMIT 10000';

    const result = await query(queryText, params);

    if (req.headers.accept === 'application/json') {
      return res.json({ success: true, data: result.rows, count: result.rows.length });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Enterprise Attendance System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Security Events', {
      pageSetup: { paperSize: 9, orientation: 'landscape' },
    });

    sheet.columns = [
      { header: 'ID',           key: 'id',             width: 10 },
      { header: 'Event Type',   key: 'event_type',     width: 30 },
      { header: 'Severity',     key: 'severity',       width: 12 },
      { header: 'Employee ID',  key: 'employee_id',    width: 14 },
      { header: 'Employee',     key: 'employee_name',  width: 26 },
      { header: 'Role',         key: 'employee_role',  width: 14 },
      { header: 'IP Address',   key: 'ip_address',     width: 18 },
      { header: 'Device Info',  key: 'device_info',    width: 40 },
      { header: 'Details',      key: 'details',        width: 50 },
      { header: 'Timestamp',    key: 'created_at',     width: 22 },
    ];

    styleHeaderRow(sheet.getRow(1));

    result.rows.forEach((row, idx) => {
      const dataRow = sheet.addRow({
        id: row.id,
        event_type: row.event_type,
        severity: row.severity || 'info',
        employee_id: row.employee_id || '',
        employee_name: row.first_name ? `${row.first_name} ${row.last_name}` : 'Unknown',
        employee_role: row.employee_role || '',
        ip_address: row.ip_address || '',
        device_info: row.device_info || '',
        details: typeof row.details === 'object' ? JSON.stringify(row.details) : String(row.details || ''),
        created_at: new Date(row.created_at).toLocaleString(),
      });

      // Colour-code by severity
      const severityColor = {
        critical: 'FFFF0000',
        high:     'FFFF6600',
        medium:   'FFFFFF00',
        low:      'FF00FF00',
        info:     'FFFFFFFF',
      }[row.severity] || 'FFFFFFFF';

      dataRow.getCell('severity').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: severityColor } };
      styleDataRow(dataRow, idx + 1);
    });

    const filename = `security-events-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    await workbook.xlsx.write(res);
    res.end();

    logger.info('Security events Excel export generated', { userId: req.user.id, rowCount: result.rows.length });
  } catch (error) {
    logger.error('Excel security events export error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to generate security events export' });
  }
});

module.exports = router;
