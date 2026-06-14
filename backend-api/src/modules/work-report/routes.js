const express = require('express');
const router = express.Router();
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { authenticateToken } = require('../../middleware/authMiddleware');

// All work-report routes require authentication
router.use(authenticateToken);

// GET /api/work-report - Get work reports for the authenticated user
router.get('/', async (req, res) => {
  try {
    const employeeId = req.user.id;
    const { date, limit = 20, offset = 0 } = req.query;

    let queryText = `
      SELECT wr.*, e.employee_id as emp_code, e.first_name, e.last_name
      FROM work_reports wr
      JOIN employees e ON wr.employee_id = e.id
      WHERE wr.employee_id = $1
    `;
    const params = [employeeId];
    let paramCount = 1;

    if (date) {
      paramCount++;
      queryText += ` AND wr.report_date = $${paramCount}`;
      params.push(date);
    }

    queryText += ` ORDER BY wr.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error('Work report fetch error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to fetch work reports' });
  }
});

// POST /api/work-report - Submit a work report with image
router.post('/', async (req, res) => {
  try {
    const employeeId = req.user.id;
    const { title, description, image_base64, image_urls, location } = req.body;

    if (!description || String(description).trim().length < 5) {
      return res.status(400).json({ success: false, message: 'Description must be at least 5 characters' });
    }

    const images = Array.isArray(image_urls)
      ? image_urls
      : image_base64
        ? [image_base64]
        : [];

    const result = await query(
      `INSERT INTO work_reports
       (employee_id, report_date, title, description, image_urls, location, created_at)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        employeeId,
        title || `Work report - ${new Date().toISOString().slice(0, 10)}`,
        description,
        images,
        location || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Work report submit error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to submit work report' });
  }
});

// GET /api/work-report/:id - Get specific work report
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT wr.*, e.employee_id as emp_code, e.first_name, e.last_name
       FROM work_reports wr
       JOIN employees e ON wr.employee_id = e.id
       WHERE wr.id = $1 AND wr.employee_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Work report not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    logger.error('Work report fetch error', { error: error.message, userId: req.user?.id });
    res.status(500).json({ success: false, message: 'Failed to fetch work report' });
  }
});

module.exports = router;
