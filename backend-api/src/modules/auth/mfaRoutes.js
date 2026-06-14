/**
 * V5 — MFA API ROUTES
 *
 * Endpoints:
 *   POST /api/auth/mfa/enroll   — Start MFA enrollment (returns secret + provisioning URI)
 *   POST /api/auth/mfa/verify   — Verify a TOTP code during enrollment
 *   POST /api/auth/mfa/validate — Validate TOTP code during login
 *   POST /api/auth/mfa/disable  — Disable MFA
 *   GET  /api/auth/mfa/status   — Check if MFA is enabled for current user
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { generateSecret, verifyTOTP, generateBackupCodes, buildProvisioningURI } = require('./mfa');
const { authenticateToken } = require('../../middleware/authMiddleware');
const { createLimiter } = require('../../middleware/rateLimiter');
const { logger } = require('../../config/logger');
const { query } = require('../../config/database');

const router = express.Router();

// Rate limiter for MFA validation (max 5 attempts per minute per user)
const mfaValidationLimiter = createLimiter({
  windowMs: 60_000,      // 60 seconds
  max: 5,                // 5 attempts
  name: 'mfa-validation'
});

// All MFA routes require authentication
router.use(authenticateToken);

// ── Enroll ─────────────────────────────────────────────────────────────────
router.post('/enroll', async (req, res) => {
  try {
    const userId = req.user.id;
    const email = req.user.email;

    // Check if already enrolled
    const existing = await query(
      'SELECT mfa_secret FROM employees WHERE id = $1', [userId]
    );
    if (existing.rows[0]?.mfa_secret) {
      return res.status(409).json({
        error: 'MFA already enrolled',
        code: 'MFA_ALREADY_ENROLLED',
      });
    }

    const secret = generateSecret();
    const provisioningURI = buildProvisioningURI(secret, email);
    const backupCodes = generateBackupCodes();

    // Hash backup codes before storing in DB
    const hashedBackupCodes = backupCodes.map(code => bcrypt.hashSync(code, 10));

    // Store pending secret (not confirmed yet)
    await query(
      'UPDATE employees SET mfa_pending_secret = $1, mfa_backup_codes = $2 WHERE id = $3',
      [secret, JSON.stringify(hashedBackupCodes), userId]
    );

    logger.info('[MFA] Enrollment started', { userId });

    res.json({
      secret,
      provisioningURI,
      backupCodes,
      message: 'Scan the QR code with your authenticator app, then verify with a code.',
    });
  } catch (error) {
    logger.error('[MFA] Enrollment error', { error: error.message });
    res.status(500).json({ error: 'MFA enrollment failed', code: 'MFA_ENROLL_ERROR' });
  }
});

// ── Verify (confirm enrollment) ────────────────────────────────────────────
router.post('/verify', async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({ error: 'Invalid code format', code: 'INVALID_CODE' });
    }

    // Get pending secret
    const result = await query(
      'SELECT mfa_pending_secret FROM employees WHERE id = $1', [userId]
    );
    const pendingSecret = result.rows[0]?.mfa_pending_secret;

    if (!pendingSecret) {
      return res.status(400).json({ error: 'No pending MFA enrollment', code: 'NO_PENDING_MFA' });
    }

    if (!verifyTOTP(pendingSecret, code)) {
      return res.status(401).json({ error: 'Invalid TOTP code', code: 'INVALID_TOTP' });
    }

    // Confirm enrollment
    await query(
      `UPDATE employees 
       SET mfa_secret = mfa_pending_secret, 
           mfa_enabled = true, 
           mfa_pending_secret = NULL 
       WHERE id = $1`,
      [userId]
    );

    logger.info('[MFA] Enrollment confirmed', { userId });

    res.json({ success: true, message: 'MFA enabled successfully' });
  } catch (error) {
    logger.error('[MFA] Verify error', { error: error.message });
    res.status(500).json({ error: 'MFA verification failed', code: 'MFA_VERIFY_ERROR' });
  }
});

// ── Validate (during login) ───────────────────────────────────────────────
// Rate limited: max 5 attempts per minute
router.post('/validate', mfaValidationLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Missing code', code: 'MISSING_CODE' });
    }

    const result = await query(
      'SELECT mfa_secret, mfa_backup_codes FROM employees WHERE id = $1', [userId]
    );
    const { mfa_secret, mfa_backup_codes } = result.rows[0] || {};

    if (!mfa_secret) {
      return res.status(400).json({ error: 'MFA not enabled', code: 'MFA_NOT_ENABLED' });
    }

    // Try TOTP code first
    if (verifyTOTP(mfa_secret, code)) {
      return res.json({ success: true, method: 'totp' });
    }

    // Try backup codes
    const backups = JSON.parse(mfa_backup_codes || '[]');
    let matchedIdx = -1;
    for (let i = 0; i < backups.length; i++) {
      if (bcrypt.compareSync(code.toUpperCase(), backups[i])) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx !== -1) {
      backups.splice(matchedIdx, 1);
      await query(
        'UPDATE employees SET mfa_backup_codes = $1 WHERE id = $2',
        [JSON.stringify(backups), userId]
      );
      logger.warn('[MFA] Backup code used', { userId, remaining: backups.length });
      return res.json({ success: true, method: 'backup', remainingBackupCodes: backups.length });
    }

    return res.status(401).json({ error: 'Invalid code', code: 'INVALID_MFA_CODE' });
  } catch (error) {
    logger.error('[MFA] Validate error', { error: error.message });
    res.status(500).json({ error: 'MFA validation failed', code: 'MFA_VALIDATE_ERROR' });
  }
});

// ── Disable ────────────────────────────────────────────────────────────────
router.post('/disable', async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;

    // Require valid TOTP code to disable
    const result = await query(
      'SELECT mfa_secret FROM employees WHERE id = $1', [userId]
    );
    const { mfa_secret } = result.rows[0] || {};

    if (!mfa_secret) {
      return res.status(400).json({ error: 'MFA not enabled', code: 'MFA_NOT_ENABLED' });
    }

    if (!code || !verifyTOTP(mfa_secret, code)) {
      return res.status(401).json({ error: 'Invalid TOTP code required to disable MFA', code: 'INVALID_TOTP' });
    }

    await query(
      `UPDATE employees 
       SET mfa_secret = NULL, 
           mfa_enabled = false, 
           mfa_pending_secret = NULL,
           mfa_backup_codes = NULL 
       WHERE id = $1`,
      [userId]
    );

    logger.info('[MFA] Disabled', { userId });
    res.json({ success: true, message: 'MFA disabled' });
  } catch (error) {
    logger.error('[MFA] Disable error', { error: error.message });
    res.status(500).json({ error: 'MFA disable failed', code: 'MFA_DISABLE_ERROR' });
  }
});

// ── Status ─────────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const result = await query(
      'SELECT mfa_enabled, mfa_pending_secret IS NOT NULL as pending FROM employees WHERE id = $1',
      [req.user.id]
    );
    const row = result.rows[0] || {};
    res.json({
      mfaEnabled: row.mfa_enabled || false,
      enrollmentPending: row.pending || false,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check MFA status' });
  }
});

module.exports = router;
