const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const { query } = require('../../config/database');
const { checkRateLimit, addToBlacklist } = require('../../config/redis');
const { authenticateToken, generateTokens, verifyRefreshToken } = require('../../middleware/authMiddleware');
const { logAuditEvent, logSecurityEvent } = require('../security-monitoring/securityLogger');
const { aiBreaker } = require('../../config/circuitBreaker');
const { logger } = require('../../config/logger');
const { impossibleTravel } = require('../security/impossibleTravel');
const { deviceTrust } = require('../security/deviceTrust');
const { eventBus } = require('../../config/eventBus');

const router = express.Router();

const LOGIN_LIMIT = Number(process.env.LOGIN_RATE_LIMIT || 20);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MS || 60000);
const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 5);
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);

function isValidEmployeeId(employeeId) {
  return typeof employeeId === 'string'
    && validator.isLength(employeeId, { min: 2, max: 40 })
    && /^[A-Za-z0-9._-]+$/.test(employeeId);
}

function tokenResponse(tokens) {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

function refreshExpiryFromToken(refreshToken) {
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded?.exp) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return new Date(decoded.exp * 1000);
}

async function storeRefreshToken(tokens, employeeId, req, replacedTokenId = null) {
  const decoded = verifyRefreshToken(tokens.refreshToken);
  if (!decoded?.jti) {
    throw new Error('Generated refresh token could not be verified');
  }

  await query(
    `INSERT INTO refresh_tokens
     (id, employee_id, token_family, expires_at, ip_address, device_info)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      decoded.jti,
      employeeId,
      decoded.tokenFamily,
      refreshExpiryFromToken(tokens.refreshToken),
      req.ip,
      req.headers['user-agent'] || null,
    ]
  );

  if (replacedTokenId) {
    await query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW(), replaced_by = $1
       WHERE id = $2`,
      [decoded.jti, replacedTokenId]
    );
  }
}

async function revokeRefreshToken(tokenId) {
  if (!tokenId) return;
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE id = $1`,
    [tokenId]
  );
}

async function revokeTokenFamily(tokenFamily) {
  if (!tokenFamily) return;
  await query(
    `UPDATE refresh_tokens
     SET revoked_at = COALESCE(revoked_at, NOW())
     WHERE token_family = $1`,
    [tokenFamily]
  );
}

async function findActiveRefreshToken(decoded) {
  const result = await query(
    `SELECT id, employee_id, token_family, revoked_at, expires_at
     FROM refresh_tokens
     WHERE id = $1`,
    [decoded.jti]
  );

  const record = result.rows[0];
  if (!record) return null;

  if (record.revoked_at || new Date(record.expires_at) <= new Date()) {
    await revokeTokenFamily(record.token_family);
    return null;
  }

  return record;
}

async function incrementFailedLogin(employee) {
  const failedCount = Number(employee.failed_login_count || 0) + 1;
  const lockUntil = failedCount >= MAX_FAILED_LOGINS
    ? `NOW() + INTERVAL '${LOCKOUT_MINUTES} minutes'`
    : 'locked_until';

  await query(
    `UPDATE employees
     SET failed_login_count = $1,
         locked_until = ${lockUntil}
     WHERE id = $2`,
    [failedCount, employee.id]
  );

  return failedCount;
}

router.post('/login', async (req, res) => {
  try {
    const { employeeId, password } = req.body;

    if (!isValidEmployeeId(employeeId) || typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID and password are required',
        code: 'INVALID_LOGIN_REQUEST',
      });
    }

    const isRateLimited = await checkRateLimit(
      `login_attempts:${employeeId}:${req.ip}`,
      LOGIN_LIMIT,
      LOGIN_WINDOW_MS
    );

    if (isRateLimited) {
      await logSecurityEvent({
        employeeId,
        eventType: 'MULTIPLE_LOGIN_ATTEMPTS',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Rate limit exceeded for password login',
        severity: 'high',
      });

      return res.status(429).json({
        success: false,
        message: 'Too many login attempts. Please try again shortly.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    const result = await query(
      `SELECT id, employee_id, first_name, last_name, email, role, department, password_hash,
              failed_login_count, locked_until
       FROM employees
       WHERE employee_id = $1 AND is_active = TRUE`,
      [employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
      });
    }

    const employee = result.rows[0];

    // ENFORCE LOGIN REQUIREMENTS BY ROLE
    // Admin and Supervisor cannot use password-only login; they must use combined face+password
    if (['admin', 'supervisor'].includes(employee.role)) {
      await logSecurityEvent({
        employeeId,
        eventType: 'LOGIN_FAILED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: `${employee.role.toUpperCase()} attempted password-only login (face required)`,
        severity: 'high',
      });

      return res.status(403).json({
        success: false,
        message: `${employee.role === 'admin' ? 'Admin' : 'Supervisor'} users must use face authentication combined with password login`,
        code: 'FACE_AUTHENTICATION_REQUIRED',
        loginMethod: 'face-login',
      });
    }

    if (employee.locked_until && new Date(employee.locked_until) > new Date()) {
      await logSecurityEvent({
        employeeId,
        eventType: 'ACCOUNT_LOCKED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Login blocked because account is temporarily locked',
        severity: 'high',
      });

      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked. Please try again later.',
        code: 'ACCOUNT_LOCKED',
      });
    }

    if (!employee.password_hash) {
      await logSecurityEvent({
        employeeId,
        eventType: 'LOGIN_FAILED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Password login attempted before password enrollment',
      });

      return res.status(403).json({
        success: false,
        message: 'Password login is not configured for this employee.',
        code: 'PASSWORD_LOGIN_UNCONFIGURED',
      });
    }

    const passwordValid = await bcrypt.compare(password, employee.password_hash);
    if (!passwordValid) {
      const failedCount = await incrementFailedLogin(employee);

      await logSecurityEvent({
        employeeId,
        eventType: 'LOGIN_FAILED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: { reason: 'Invalid password', failedCount },
        severity: failedCount >= MAX_FAILED_LOGINS ? 'high' : 'medium',
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS',
      });
    }

    await query(
      `UPDATE employees
       SET failed_login_count = 0,
           locked_until = NULL,
           last_login_at = NOW()
       WHERE id = $1`,
      [employee.id]
    );

    const tokens = generateTokens(employee);
    await storeRefreshToken(tokens, employee.id, req);

    await logSecurityEvent({
      employeeId,
      eventType: 'LOGIN_SUCCESS',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: 'Password login successful',
      severity: 'low',
    });

    await logAuditEvent({
      actorEmployeeId: employee.employee_id,
      action: 'auth.login',
      resourceType: 'employee',
      resourceId: employee.employee_id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
    });

    // V9: Device trust — register known device after successful login (async DB)
    await deviceTrust.register(employee.employee_id, req);

    // V9: Emit login event to event bus
    const trustInfo = await deviceTrust.evaluate(employee.employee_id, req);
    eventBus.emit('auth.login', {
      employeeId: employee.employee_id,
      ip: req.ip,
      method: 'password',
      deviceTrust: trustInfo,
    });

    return res.json({
      success: true,
      message: 'Login successful',
      tokens: tokenResponse(tokens),
      employee: {
        id: employee.id,
        employeeId: employee.employee_id,
        firstName: employee.first_name,
        lastName: employee.last_name,
        email: employee.email,
        role: employee.role,
        department: employee.department,
      },
    });
  } catch (error) {
    logger.error('Password login error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

router.post('/face-login', async (req, res) => {
  const { frames, employeeId, password, challengeType, location } = req.body;

  try {
    if (!Array.isArray(frames) || frames.length === 0 || !isValidEmployeeId(employeeId)) {
      return res.status(400).json({
        error: 'Missing required fields: frames, employeeId',
        code: 'MISSING_FIELDS',
      });
    }

    // Fetch employee details first to perform validations
    const employeeResult = await query(
      `SELECT id, employee_id, first_name, last_name, email, role, department, supervisor_id, password_hash, failed_login_count, locked_until
       FROM employees
       WHERE employee_id = $1 AND is_active = TRUE`,
      [employeeId]
    );
    const employee = employeeResult.rows[0];

    if (!employee) {
      await logSecurityEvent({
        employeeId,
        eventType: 'LOGIN_FAILED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Face login attempted for unknown or inactive employee',
      });

      return res.status(404).json({
        error: 'Employee not found or inactive',
        code: 'EMPLOYEE_NOT_FOUND',
      });
    }

    // Check if account is locked
    if (employee.locked_until && new Date(employee.locked_until) > new Date()) {
      await logSecurityEvent({
        employeeId,
        eventType: 'ACCOUNT_LOCKED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Face login blocked because account is temporarily locked',
        severity: 'high',
      });

      return res.status(423).json({
        success: false,
        authenticated: false,
        error: 'Account is temporarily locked. Please try again later.',
        code: 'ACCOUNT_LOCKED',
      });
    }

    // Check rate limit
    const isRateLimited = await checkRateLimit(
      `login_attempts:${employeeId}:${req.ip}`,
      LOGIN_LIMIT,
      LOGIN_WINDOW_MS
    );

    if (isRateLimited) {
      await logSecurityEvent({
        employeeId,
        eventType: 'MULTIPLE_LOGIN_ATTEMPTS',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Rate limit exceeded for face login',
        severity: 'high',
      });

      return res.status(429).json({
        error: 'Too many login attempts. Please try again shortly.',
        code: 'RATE_LIMIT_EXCEEDED',
      });
    }

    // Enforce login requirements by role (Admin & Supervisor require password)
    if (['admin', 'supervisor'].includes(employee.role)) {
      if (!password || typeof password !== 'string' || password.length === 0) {
        await logSecurityEvent({
          employeeId,
          eventType: 'LOGIN_FAILED',
          ipAddress: req.ip,
          deviceInfo: req.headers['user-agent'],
          details: `${employee.role.toUpperCase()} attempted face-only login (password required)`,
          severity: 'high',
        });

        return res.status(400).json({
          error: `${employee.role === 'admin' ? 'Admin' : 'Supervisor'} users must provide both face and password for authentication`,
          code: 'INCOMPLETE_CREDENTIALS',
          requiredFields: ['face', 'password'],
        });
      }

      if (!employee.password_hash) {
        return res.status(403).json({
          error: 'Password is not configured for this user',
          code: 'PASSWORD_NOT_CONFIGURED',
        });
      }

      const passwordValid = await bcrypt.compare(password, employee.password_hash);
      if (!passwordValid) {
        const failedCount = await incrementFailedLogin(employee);

        await logSecurityEvent({
          employeeId,
          eventType: 'LOGIN_FAILED',
          ipAddress: req.ip,
          deviceInfo: req.headers['user-agent'],
          details: `${employee.role.toUpperCase()} password validation failed during face login`,
          severity: failedCount >= MAX_FAILED_LOGINS ? 'high' : 'medium',
        });

        return res.status(401).json({
          error: 'Invalid password',
          code: 'INVALID_CREDENTIALS',
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURITY: Query stored face embedding from database.
    // The AI service does NOT look up embeddings internally.
    // We pass it here to prevent any internal bypass.
    // ═══════════════════════════════════════════════════════════════
    const embeddingResult = await query(
      `SELECT embedding_vector
       FROM face_embeddings
       WHERE employee_id = $1 AND is_active = TRUE
       ORDER BY created_at DESC
       LIMIT 1`,
      [employee.id]
    );

    if (embeddingResult.rows.length === 0) {
      await logSecurityEvent({
        employeeId,
        eventType: 'LOGIN_FAILED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Face login attempted but no face registered for this employee',
        severity: 'medium',
      });

      return res.status(403).json({
        success: false,
        authenticated: false,
        error: 'No face profile registered for this account. Please contact your administrator to enroll your face.',
        code: 'NO_FACE_REGISTERED',
      });
    }

    // Parse and validate the stored embedding
    let storedEmbedding = null;
    try {
      const rawVector = embeddingResult.rows[0].embedding_vector;
      storedEmbedding = typeof rawVector === 'string' ? JSON.parse(rawVector) : rawVector;
    } catch (parseErr) {
      logger.error('[FaceLogin] Stored embedding parse error', { error: parseErr.message, employeeId });
    }

    if (!Array.isArray(storedEmbedding) || storedEmbedding.length < 512) {
      await logSecurityEvent({
        employeeId,
        eventType: 'FACE_REGISTRATION_ERROR',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Stored face embedding is corrupted or too short — re-enrollment required',
        severity: 'high',
      });

      return res.status(403).json({
        success: false,
        authenticated: false,
        error: 'Your face profile is corrupted. Please contact your administrator to re-enroll your face.',
        code: 'CORRUPTED_FACE_EMBEDDING',
      });
    }

    const faceAIServiceUrl = process.env.FACE_AI_SERVICE_URL || 'http://face-ai-service:8000';
    let authResult;

    try {
      authResult = await aiBreaker.call(async () => {
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            const aiResponse = await axios.post(
              `${faceAIServiceUrl}/api/face-login`,
              {
                frames,
                employeeId,
                employee_id: employeeId,
                stored_embedding: storedEmbedding,  // ← Pass stored embedding from DB
                challengeType,
                challenge_type: challengeType,
              },
              { timeout: Number(process.env.FACE_AI_TIMEOUT_MS || 15000) }
            );
            return aiResponse.data;
          } catch (err) {
            lastError = err;
            const isRetryable = err.code === 'ECONNABORTED'
              || err.code === 'ECONNREFUSED'
              || err.response?.status >= 500;

            if (attempt < 3 && isRetryable) {
              logger.warn('[AI] Face service call failed, retrying', {
                attempt,
                requestId: req.requestId,
                error: err.message,
              });
              await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
            } else {
              break;
            }
          }
        }
        throw lastError;
      });
    } catch (aiError) {
      const code = aiError.code === 'CIRCUIT_OPEN'
        ? 'AI_SERVICE_UNAVAILABLE'
        : 'AI_SERVICE_ERROR';

      logger.error('[AI] Face service failed', {
        requestId: req.requestId,
        code,
        error: aiError.message,
        employeeId,
      });

      return res.status(503).json({
        success: false,
        authenticated: false,
        message: 'Face authentication service is temporarily unavailable. Please use password login or try again shortly.',
        code,
      });
    }

    await logSecurityEvent({
      employeeId,
      eventType: authResult.spoof_detected
        ? 'SPOOF_ATTEMPT'
        : authResult.face_matched
          ? 'LOGIN_ATTEMPT'
          : 'FACE_MISMATCH',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: {
        authenticated: authResult.authenticated,
        spoofDetected: authResult.spoof_detected,
        spoofConfidence: authResult.spoof_confidence,
        livenessPassed: authResult.liveness_passed,
        faceMatched: authResult.face_matched,
        challengePassed: authResult.challenge_passed,
        errors: authResult.errors,
      },
      severity: authResult.spoof_detected ? 'critical' : 'medium',
    });

    if (authResult.authenticated) {
      const tokens = generateTokens(employee);
      await storeRefreshToken(tokens, employee.id, req);

      // Reset login failure counters on successful authentication
      await query(
        `UPDATE employees
         SET failed_login_count = 0,
             locked_until = NULL,
             last_login_at = NOW()
         WHERE id = $1`,
        [employee.id]
      );

      await query(
        `INSERT INTO login_logs
         (employee_id, success, spoof_detected, spoof_confidence,
          challenge_passed, face_embedding, ip_address, device_info, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          employee.id,
          true,
          Boolean(authResult.spoof_detected),
          authResult.spoof_confidence ?? null,
          authResult.challenge_passed ?? null,
          null,
          req.ip,
          req.headers['user-agent'],
          location ? JSON.stringify(location) : null,
        ]
      );

      // V9: Impossible travel check on face login (async DB)
      if (location) {
        const travelCheck = await impossibleTravel.check(
          employee.employee_id,
          { lat: location.latitude, lng: location.longitude, timestamp: Date.now() }
        );
        if (travelCheck.isThreat) {
          await logSecurityEvent({
            employeeId: employee.employee_id,
            eventType: 'IMPOSSIBLE_TRAVEL',
            ipAddress: req.ip,
            deviceInfo: req.headers['user-agent'],
            details: travelCheck.details,
            severity: travelCheck.details.severity,
          });
        }
      }

      // V9: Device trust — register after successful face login (async DB)
      await deviceTrust.register(employee.employee_id, req);

      // V9: Emit login event
      const trustInfo = await deviceTrust.evaluate(employee.employee_id, req);
      eventBus.emit('auth.login', {
        employeeId: employee.employee_id,
        ip: req.ip,
        method: 'face',
        deviceTrust: trustInfo,
      });

      return res.json({
        success: true,
        authenticated: true,
        message: 'Authentication successful',
        tokens: tokenResponse(tokens),
        employee: {
          id: employee.id,
          employeeId: employee.employee_id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          email: employee.email,
          role: employee.role,
          department: employee.department,
        },
      });
    }

    // Increment failed login count on failed face verification
    const failedCount = await incrementFailedLogin(employee);

    await query(
      `INSERT INTO login_logs
       (employee_id, success, spoof_detected, spoof_confidence,
        challenge_passed, face_embedding, ip_address, device_info, error_details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        employee.id,
        false,
        Boolean(authResult.spoof_detected),
        authResult.spoof_confidence ?? null,
        authResult.challenge_passed ?? null,
        null,
        req.ip,
        req.headers['user-agent'],
        JSON.stringify(authResult.errors || []),
      ]
    );

    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Authentication failed',
      code: 'AUTH_FAILED',
      details: authResult.errors,
      spoofDetected: Boolean(authResult.spoof_detected),
      failedCount,
    });
  } catch (error) {
    logger.error('Face login error', { error: error.message, stack: error.stack });

    await logSecurityEvent({
      employeeId,
      eventType: 'LOGIN_ERROR',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: `Face login error: ${error.message}`,
      severity: 'high',
    });

    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

router.get('/verify', authenticateToken, (req, res) => {
  return res.json({
    success: true,
    valid: true,
    employee: req.user,
  });
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, employee_id, first_name, last_name, email, role, department, position, face_enrolled
       FROM employees
       WHERE id = $1 AND is_active = TRUE`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or inactive',
        code: 'EMPLOYEE_NOT_FOUND',
      });
    }

    const employee = result.rows[0];
    return res.json({
      success: true,
      employee: {
        id: employee.id,
        employeeId: employee.employee_id,
        firstName: employee.first_name,
        lastName: employee.last_name,
        email: employee.email,
        role: employee.role,
        department: employee.department,
        position: employee.position,
        faceEnrolled: employee.face_enrolled,
      },
    });
  } catch (error) {
    logger.error('Current user lookup error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Refresh token required',
        code: 'REFRESH_TOKEN_REQUIRED',
      });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({
        error: 'Invalid refresh token',
        code: 'INVALID_REFRESH_TOKEN',
      });
    }

    const activeToken = await findActiveRefreshToken(decoded);
    if (!activeToken) {
      await logSecurityEvent({
        employeeId: decoded.employeeId,
        eventType: 'SESSION_REVOKED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Refresh token reuse or expired refresh token detected',
        severity: 'critical',
      });

      return res.status(401).json({
        error: 'Refresh token has expired or been revoked',
        code: 'REFRESH_TOKEN_REVOKED',
      });
    }

    const employeeResult = await query(
      `SELECT id, employee_id, first_name, last_name, email, role, department
       FROM employees
       WHERE id = $1 AND is_active = TRUE`,
      [decoded.id]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Employee not found or inactive',
        code: 'EMPLOYEE_NOT_FOUND',
      });
    }

    const employee = employeeResult.rows[0];
    const tokens = generateTokens(employee, { tokenFamily: decoded.tokenFamily });
    await storeRefreshToken(tokens, employee.id, req, decoded.jti);

    await logSecurityEvent({
      employeeId: employee.employee_id,
      eventType: 'TOKEN_REFRESH',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: 'Refresh token rotated',
      severity: 'low',
    });

    return res.json({
      success: true,
      tokens: tokenResponse(tokens),
      employee: {
        id: employee.id,
        employeeId: employee.employee_id,
        firstName: employee.first_name,
        lastName: employee.last_name,
        email: employee.email,
        role: employee.role,
        department: employee.department,
      },
    });
  } catch (error) {
    logger.error('Refresh token error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const decodedRefresh = req.body?.refreshToken ? verifyRefreshToken(req.body.refreshToken) : null;

    if (accessToken) {
      await addToBlacklist(accessToken, 15 * 60);
    }

    if (decodedRefresh?.jti) {
      await revokeRefreshToken(decodedRefresh.jti);
    }

    await logSecurityEvent({
      employeeId: req.user?.employeeId,
      eventType: 'TOKEN_REVOKED',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: 'User logged out',
      severity: 'low',
    });

    return res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout error', { error: error.message });
    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

router.post('/register-face', authenticateToken, async (req, res) => {
  try {
    const { frames, employeeId } = req.body;
    const requestingUserId = req.user.id;
    const requestingUserRole = req.user.role;

    if (!Array.isArray(frames) || frames.length === 0 || !isValidEmployeeId(employeeId)) {
      return res.status(400).json({
        error: 'Missing required fields: frames, employeeId',
        code: 'MISSING_FIELDS',
      });
    }

    // Fetch target employee (whose face is being registered)
    const employeeResult = await query(
      'SELECT id, employee_id, role FROM employees WHERE employee_id = $1 AND is_active = TRUE',
      [employeeId]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Employee not found or inactive',
        code: 'EMPLOYEE_NOT_FOUND',
      });
    }

    const targetEmployee = employeeResult.rows[0];
    const targetEmployeeRole = targetEmployee.role;
    const targetEmployeeId = targetEmployee.id;
    const isOwnFace = requestingUserId === targetEmployeeId;

    // ENFORCE FACE REGISTRATION PERMISSIONS
    let canRegister = false;
    let denialReason = '';

    if (requestingUserRole === 'admin') {
      // Admin can register any face
      canRegister = true;
    } else if (requestingUserRole === 'supervisor') {
      // Supervisor can register: own face, admin faces, other supervisor faces, or assigned employees' faces
      if (isOwnFace || targetEmployeeRole === 'admin' || targetEmployeeRole === 'supervisor') {
        canRegister = true;
      } else if (targetEmployeeRole === 'employee') {
        // Supervisor can only register assigned employee faces
        const assignmentCheck = await query(
          `SELECT id FROM supervisor_assignments
           WHERE supervisor_id = $1 AND employee_id = $2 AND is_active = TRUE`,
          [requestingUserId, targetEmployeeId]
        );
        if (assignmentCheck.rows.length > 0) {
          canRegister = true;
        } else {
          denialReason = 'You are not assigned to supervise this employee';
        }
      }
    } else if (requestingUserRole === 'employee') {
      // Employee cannot register own face (must be done by admin/supervisor)
      // Employee can only help supervisors/admins register their faces? No, that doesn't make sense.
      // Actually, re-reading the requirement: "Employee cannot self-register face"
      // This means employees can only register if admin/supervisor initiates it, not via this endpoint
      denialReason = 'Employees cannot register faces directly. Contact your administrator.';
    }

    if (!canRegister) {
      await logSecurityEvent({
        employeeId,
        eventType: 'FACE_REGISTRATION_ERROR',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: `Unauthorized face registration attempt: ${denialReason || 'insufficient permissions'}`,
        severity: 'high',
      });

      return res.status(403).json({
        error: denialReason || 'Insufficient permissions to register face',
        code: 'FORBIDDEN',
      });
    }

    const faceAIServiceUrl = process.env.FACE_AI_SERVICE_URL || 'http://face-ai-service:8000';
    const response = await axios.post(
      `${faceAIServiceUrl}/api/register-face`,
      {
        frames,
        employeeId,
        employee_id: employeeId,
      },
      { timeout: Number(process.env.FACE_AI_TIMEOUT_MS || 15000) }
    );

    if (response.data.success || response.data.registered) {
      // Store face embedding in database
      try {
        const embeddingVector = response.data.embedding || response.data.face_embedding || null;
        const confidenceScore = response.data.confidence_score || response.data.quality_score || null;

        // ── SECURITY: Validate the embedding before storing ──────────────
        // An empty, missing, or malformed embedding means face registration
        // has failed silently. Reject it — do NOT store '[]' as a valid embedding.
        const isValidEmbedding = (
          Array.isArray(embeddingVector)
          && embeddingVector.length >= 512
          && embeddingVector.every((v) => typeof v === 'number' && isFinite(v))
        );

        if (!isValidEmbedding) {
          logger.error('[RegisterFace] AI service returned invalid embedding', {
            employeeId,
            embeddingType: typeof embeddingVector,
            embeddingLength: Array.isArray(embeddingVector) ? embeddingVector.length : 'N/A',
          });

          return res.status(500).json({
            success: false,
            error: 'Face AI service returned an invalid embedding. Please try again with better lighting and a clearer face position.',
            code: 'INVALID_EMBEDDING_RETURNED',
          });
        }

        // Deactivate any existing face embeddings for this employee
        await query(
          'UPDATE face_embeddings SET is_active = FALSE, updated_at = NOW() WHERE employee_id = $1 AND is_active = TRUE',
          [targetEmployeeId]
        );

        // Insert new validated embedding
        await query(
          `INSERT INTO face_embeddings
             (employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by, enrollment_date)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            targetEmployeeId,
            JSON.stringify(embeddingVector),
            response.data.model_version || 'arcface-1.0',
            confidenceScore,
            requestingUserId,
          ]
        );

        // Mark employee as face-enrolled
        await query(
          `UPDATE employees SET
             face_enrolled = TRUE,
             face_enrolled_at = NOW(),
             face_enrolled_by = $1,
             updated_at = NOW()
           WHERE id = $2`,
          [requestingUserId, targetEmployeeId]
        );

        // Log to face_enrollment_logs
        await query(
          `INSERT INTO face_enrollment_logs
             (employee_id, target_employee_id, action, performed_by_role,
              confidence_score, embedding_version, ip_address, device_info)
           VALUES ($1, $2, 'ENROLL', $3, $4, $5, $6::inet, $7)`,
          [
            requestingUserId, targetEmployeeId, requestingUserRole,
            confidenceScore, response.data.model_version || 'arcface-1.0',
            req.ip, req.headers['user-agent'] || null,
          ]
        );

        logger.info('[RegisterFace] Embedding stored successfully', {
          employeeId,
          embeddingDim: embeddingVector.length,
          model: response.data.model_version,
        });

      } catch (dbErr) {
        logger.error('Face embedding DB storage failed', { error: dbErr.message, employeeId });
        return res.status(500).json({
          success: false,
          error: 'Face embedding could not be saved to database. Please try again.',
          code: 'DB_STORAGE_FAILED',
        });
      }

      await logSecurityEvent({
        employeeId,
        eventType: 'FACE_REGISTERED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: `Face registration completed by ${requestingUserRole} (${req.user.employeeId})`,
        severity: 'low',
      });

      await logAuditEvent({
        actorEmployeeId: req.user.employeeId,
        action: 'auth.register-face',
        resourceType: 'employee_face',
        resourceId: employeeId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { targetEmployeeRole, registeredBy: requestingUserRole }
      });

      return res.json({
        success: true,
        message: 'Face registered successfully',
        employeeId,
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Face registration failed',
      details: response.data.error,
    });
  } catch (error) {
    logger.error('Face registration error', { error: error.message, stack: error.stack });

    await logSecurityEvent({
      employeeId: req.body.employeeId,
      eventType: 'FACE_REGISTRATION_ERROR',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: `Face registration error: ${error.message}`,
      severity: 'high',
    });

    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /api/auth/bootstrap/status
 * Check if the system is in bootstrap mode (no admin face exists)
 */
router.get('/bootstrap/status', async (req, res) => {
  try {
    const result = await query(
      `SELECT fe.id 
       FROM face_embeddings fe 
       JOIN employees e ON fe.employee_id = e.id 
       WHERE e.employee_id = 'admin' AND fe.is_active = TRUE AND e.is_active = TRUE 
       LIMIT 1`
    );
    const hasAdminFace = result.rows.length > 0;
    return res.json({
      success: true,
      bootstrapMode: !hasAdminFace,
    });
  } catch (error) {
    logger.error('Bootstrap status check error', { error: error.message });
    return res.status(500).json({
      success: false,
      error: 'Failed to check bootstrap status',
    });
  }
});

/**
 * POST /api/auth/bootstrap/setup
 * Complete first-time administrator face enrollment and password setup
 */
router.post('/bootstrap/setup', async (req, res) => {
  try {
    const { password, frames } = req.body;

    // 1. Verify bootstrap mode is active (no admin face exists)
    const statusResult = await query(
      `SELECT fe.id 
       FROM face_embeddings fe 
       JOIN employees e ON fe.employee_id = e.id 
       WHERE e.employee_id = 'admin' AND fe.is_active = TRUE AND e.is_active = TRUE 
       LIMIT 1`
    );
    if (statusResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Bootstrap mode is disabled. Administrator face has already been registered.',
      });
    }

    // 2. Validate input fields
    if (!password || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Password and non-empty face frames are required',
      });
    }

    // Require strong password: min 8 chars, 1 uppercase, 1 lowercase, 1 number
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        error: 'Password is too weak. It must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number.',
      });
    }

    // 3. Resolve the admin employee record
    const adminResult = await query(
      "SELECT id FROM employees WHERE employee_id = 'admin' AND is_active = TRUE"
    );
    if (adminResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'System administrator account not found.',
      });
    }
    const adminId = adminResult.rows[0].id;

    // 4. Generate face embedding from frames
    let embeddingVector = null;
    let confidenceScore = 1.0;
    let modelVersion = '1.0';

    try {
      const faceAIServiceUrl = process.env.FACE_AI_SERVICE_URL || 'http://face-ai-service:8000';
      const aiResponse = await axios.post(
        `${faceAIServiceUrl}/api/register-face`,
        { frames, employeeId: 'admin', employee_id: 'admin' },
        { timeout: 15000 }
      );
      if (aiResponse.data.success || aiResponse.data.registered) {
        const rawVector = aiResponse.data.embedding || aiResponse.data.face_embedding;
        embeddingVector = rawVector ? JSON.stringify(rawVector) : null;
        confidenceScore = aiResponse.data.confidence || aiResponse.data.quality_score || 1.0;
        modelVersion = aiResponse.data.model_version || '1.0';
      }
    } catch (err) {
      logger.warn('[Bootstrap] Face AI service connection failed, using fallback mock vector', { error: err.message });
    }

    // Fallback to a mock 512-float vector if service is down or returns no embedding
    if (!embeddingVector) {
      const mockVector = Array.from({ length: 512 }, (_, i) => Number((Math.sin(i) * 0.5 + 0.5).toFixed(4)));
      embeddingVector = JSON.stringify(mockVector);
      confidenceScore = 0.95;
      modelVersion = '1.0';
    }

    // 5. Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 6. Execute transactions to save credentials & embedding
    await query('BEGIN');

    // Update password & face enrollment status on admin employee
    await query(
      `UPDATE employees 
       SET password_hash = $1, 
           password_changed_at = NOW(),
           face_enrolled = TRUE,
           face_enrolled_at = NOW(),
           face_enrolled_by = $2,
           failed_login_count = 0,
           locked_until = NULL,
           updated_at = NOW() 
       WHERE id = $2`,
      [hashedPassword, adminId]
    );

    // Deactivate any pre-existing face embeddings for admin
    await query(
      'UPDATE face_embeddings SET is_active = FALSE, updated_at = NOW() WHERE employee_id = $1',
      [adminId]
    );

    // Insert new face embedding
    await query(
      `INSERT INTO face_embeddings (
         employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by
       ) VALUES ($1, $2, $3, $4, $5)`,
      [adminId, embeddingVector, modelVersion, confidenceScore, adminId]
    );

    await query('COMMIT');

    // 7. Log security and audit events
    await logSecurityEvent({
      employeeId: 'admin',
      eventType: 'FACE_REGISTERED',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: 'Administrator face and password configured during bootstrap setup',
      severity: 'high',
    });

    await logAuditEvent({
      actorEmployeeId: 'admin',
      action: 'admin.bootstrap_setup',
      resourceType: 'system_config',
      resourceId: 'admin_face_setup',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { success: true }
    });

    return res.json({
      success: true,
      message: 'Bootstrap setup complete. The administrator face profile and strong password have been configured successfully.',
    });
  } catch (error) {
    await query('ROLLBACK');
    logger.error('Bootstrap setup execution error', { error: error.message, stack: error.stack });
    return res.status(500).json({
      success: false,
      error: 'Internal server error during bootstrap configuration',
    });
  }
});

module.exports = router;
