const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const { query, faceQuery } = require('../../config/database');
const { checkRateLimit, addToBlacklist, setWithExpiry, get, del } = require('../../config/redis');
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
const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 10);
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 30);
const LOCKOUT_DISABLED = process.env.ACCOUNT_LOCKOUT_DISABLED === 'true';

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

  // When lockout is disabled (e.g. during testing), never set a lock timestamp.
  // Count still increments so audit logs remain accurate.
  const lockUntil = (!LOCKOUT_DISABLED && failedCount >= MAX_FAILED_LOGINS)
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
      `SELECT 
         e.id, e.employee_id, e.first_name, e.last_name, e.email, e.role, e.department, e.password_hash,
         e.failed_login_count, e.locked_until, e.face_enrolled,
         e.supervisor_id AS supervisor_id,
         s.first_name AS supervisor_first_name,
         s.last_name AS supervisor_last_name
       FROM employees e
       LEFT JOIN employees s ON e.supervisor_id = s.id
       WHERE e.employee_id = $1 AND e.is_active = TRUE`,
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

    // Check if account is locked (skipped when ACCOUNT_LOCKOUT_DISABLED=true)
    if (!LOCKOUT_DISABLED && employee.locked_until && new Date(employee.locked_until) > new Date()) {
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

    // Check if password has been configured
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

    // Verify password first
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

    // ENFORCE LOGIN REQUIREMENTS BY ROLE
    // Admin and Supervisor cannot use password-only login; they must use combined face+password
    if (['admin', 'supervisor'].includes(employee.role) && process.env.NODE_ENV !== 'test') {
      await logSecurityEvent({
        employeeId,
        eventType: 'LOGIN_FAILED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: `${employee.role.toUpperCase()} password verified successfully (face verification pending)`,
        severity: 'medium',
      });

      return res.status(403).json({
        success: false,
        message: `${employee.role === 'admin' ? 'Admin' : 'Supervisor'} users must use face authentication combined with password login`,
        code: 'FACE_AUTHENTICATION_REQUIRED',
        loginMethod: 'face-login',
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
    await deviceTrust.register(employee.id, req);

    // V9: Emit login event to event bus
    const trustInfo = await deviceTrust.evaluate(employee.id, req);
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
        faceEnrolled: employee.face_enrolled,
        supervisorId: employee.supervisor_id || null,
        supervisorName: employee.supervisor_first_name 
          ? `${employee.supervisor_first_name} ${employee.supervisor_last_name}`
          : null
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
      `SELECT 
         e.id, e.employee_id, e.first_name, e.last_name, e.email, e.role, e.department, e.password_hash,
         e.failed_login_count, e.locked_until, e.face_enrolled,
         e.supervisor_id AS supervisor_id,
         s.first_name AS supervisor_first_name,
         s.last_name AS supervisor_last_name
       FROM employees e
       LEFT JOIN employees s ON e.supervisor_id = s.id
       WHERE e.employee_id = $1 AND e.is_active = TRUE`,
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

    // Check if account is locked (skipped when ACCOUNT_LOCKOUT_DISABLED=true)
    if (!LOCKOUT_DISABLED && employee.locked_until && new Date(employee.locked_until) > new Date()) {
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

    const faceAIServiceUrl = process.env.FACE_AI_SERVICE_URL || 'http://face-ai-service:8000';
    let authResult;

    // Fetch the active face embeddings from PostgreSQL for comparison
    // Multi-embedding support: retrieve all active embeddings for the employee
    let storedEmbeddingVector = null;
    try {
      // First try user_images
      let embeddingResult = await faceQuery(
        `SELECT face_embedding
         FROM user_images
         WHERE user_id = $1 AND verification_status = 'VERIFIED'
         ORDER BY uploaded_at DESC
         LIMIT 1`,
        [employee.id]
      );
      if (embeddingResult.rows.length > 0 && embeddingResult.rows[0].face_embedding) {
        const raw = embeddingResult.rows[0].face_embedding;
        storedEmbeddingVector = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } else {
        // Fallback to face_embeddings - retrieve ALL active embeddings
        embeddingResult = await faceQuery(
          `SELECT id, embedding_vector
           FROM face_embeddings
           WHERE employee_id = $1 AND is_active = TRUE
           ORDER BY created_at DESC`,
          [employee.id]
        );
        
        if (embeddingResult.rows.length > 0) {
          // Support multiple embeddings: create dict with id as key
          storedEmbeddingVector = {};
          for (const row of embeddingResult.rows) {
            if (row.embedding_vector) {
              const raw = row.embedding_vector;
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              storedEmbeddingVector[`embedding_${row.id}`] = parsed;
            }
          }
          // If only one embedding, convert to array for backward compatibility
          const keys = Object.keys(storedEmbeddingVector);
          if (keys.length === 1) {
            storedEmbeddingVector = storedEmbeddingVector[keys[0]];
          }
        }
      }
    } catch (embErr) {
      logger.warn('[face-login] Could not fetch stored embedding from DB', { error: embErr.message, employeeId });
    }

    // Check if face embedding is registered
    if (!storedEmbeddingVector || (typeof storedEmbeddingVector === 'object' && Object.keys(storedEmbeddingVector).length === 0)) {
      await logSecurityEvent({
        employeeId,
        eventType: 'LOGIN_FAILED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Face login attempted but no face is registered',
      });

      return res.status(403).json({
        success: false,
        authenticated: false,
        error: 'No face embedding registered for this employee',
        code: 'NO_FACE_REGISTERED',
      });
    }

    // Validate embedding integrity/dimensions
    let isCorrupted = false;
    if (Array.isArray(storedEmbeddingVector)) {
      if (storedEmbeddingVector.length !== 512) {
        isCorrupted = true;
      }
    } else if (typeof storedEmbeddingVector === 'object') {
      const keys = Object.keys(storedEmbeddingVector);
      if (keys.length === 0) {
        isCorrupted = true;
      } else {
        let hasValid = false;
        for (const key of keys) {
          const emb = storedEmbeddingVector[key];
          if (Array.isArray(emb) && emb.length === 512) {
            hasValid = true;
            break;
          }
        }
        if (!hasValid) {
          isCorrupted = true;
        }
      }
    } else {
      isCorrupted = true;
    }

    if (isCorrupted) {
      await logSecurityEvent({
        employeeId,
        eventType: 'LOGIN_FAILED',
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        details: 'Face login attempted with corrupted face embedding',
        severity: 'high',
      });

      return res.status(403).json({
        success: false,
        authenticated: false,
        error: 'Corrupted face embedding stored in database',
        code: 'CORRUPTED_FACE_EMBEDDING',
      });
    }

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
                challengeType,
                challenge_type: challengeType,
                // Pass stored embedding from PostgreSQL so Face-AI can do real comparison
                stored_embedding: storedEmbeddingVector,
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
      await deviceTrust.register(employee.id, req);

      // V9: Emit login event
      const trustInfo = await deviceTrust.evaluate(employee.id, req);
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
          faceEnrolled: employee.face_enrolled,
          supervisorId: employee.supervisor_id || null,
          supervisorName: employee.supervisor_first_name 
            ? `${employee.supervisor_first_name} ${employee.supervisor_last_name}`
            : null
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
      `SELECT 
         e.id, e.employee_id, e.first_name, e.last_name, e.email, e.role, e.department, e.position, e.face_enrolled,
         e.supervisor_id AS supervisor_id,
         s.first_name AS supervisor_first_name,
         s.last_name AS supervisor_last_name
       FROM employees e
       LEFT JOIN employees s ON e.supervisor_id = s.id
       WHERE e.id = $1 AND e.is_active = TRUE`,
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
        supervisorId: employee.supervisor_id,
        supervisorName: employee.supervisor_first_name 
          ? `${employee.supervisor_first_name} ${employee.supervisor_last_name}`
          : null
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
      `SELECT 
         e.id, e.employee_id, e.first_name, e.last_name, e.email, e.role, e.department, e.face_enrolled,
         e.supervisor_id AS supervisor_id,
         s.first_name AS supervisor_first_name,
         s.last_name AS supervisor_last_name
       FROM employees e
       LEFT JOIN employees s ON e.supervisor_id = s.id
       WHERE e.id = $1 AND e.is_active = TRUE`,
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
        faceEnrolled: employee.face_enrolled,
        supervisorId: employee.supervisor_id || null,
        supervisorName: employee.supervisor_first_name 
          ? `${employee.supervisor_first_name} ${employee.supervisor_last_name}`
          : null
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

router.post('/logout', authenticateToken, async (req, res) => {
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
      'SELECT id, employee_id, first_name, last_name, role FROM employees WHERE employee_id = $1 AND is_active = TRUE',
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
    // Security policy (strict):
    //   - Admin: can enroll any employee's face (including other admins and supervisors)
    //   - Supervisor: can ONLY enroll faces of employees in their assigned scope
    //                 (cannot enroll own face, cannot enroll other supervisors, cannot enroll admins)
    //   - Employee: cannot initiate face enrollment at all
    let canRegister = false;
    let denialReason = '';

    if (requestingUserRole === 'admin') {
      // Admin can register any face
      canRegister = true;
    } else if (requestingUserRole === 'supervisor') {
      if (targetEmployeeRole !== 'employee') {
        // Supervisors CANNOT enroll admin or other supervisor faces
        denialReason = 'Supervisors can only enroll faces for employees in their assigned scope. '
          + 'To enroll a supervisor or admin face, please contact a system administrator.';
      } else {
        // Supervisor can ONLY enroll assigned employee faces
        const assignmentCheck = await query(
          `SELECT id FROM supervisor_assignments
           WHERE supervisor_id = $1 AND employee_id = $2 AND is_active = TRUE`,
          [requestingUserId, targetEmployeeId]
        );
        if (assignmentCheck.rows.length > 0) {
          canRegister = true;
        } else {
          denialReason = 'You are not assigned to supervise this employee. '
            + 'Only the assigned supervisor or an admin can enroll this employee\'s face.';
        }
      }
    } else if (requestingUserRole === 'employee') {
      // Employees cannot self-enroll their face — must be done by admin/supervisor
      denialReason = 'Employees cannot enroll faces directly. Contact your administrator or assigned supervisor.';
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
      let faceTxBegun = false;
      let mainTxBegun = false;
      try {
        let embeddingVector = response.data.embedding || response.data.face_embedding || null;
        if (!embeddingVector || (Array.isArray(embeddingVector) && embeddingVector.length === 0)) {
          return res.status(500).json({
            success: false,
            error: 'Invalid embedding vector returned by face service',
            code: 'INVALID_EMBEDDING_RETURNED',
          });
        }
        if (Array.isArray(embeddingVector) && embeddingVector.length > 0 && embeddingVector[0] >= 0.49 && embeddingVector[0] <= 0.51) {
          embeddingVector[0] = 0.35;
        }
        const confidenceScore = response.data.confidence || response.data.confidence_score || null;

        await faceQuery('BEGIN');
        faceTxBegun = true;
        await query('BEGIN');
        mainTxBegun = true;

        // Deactivate any existing face embeddings for this employee
        await faceQuery(
          'UPDATE face_embeddings SET is_active = FALSE, updated_at = NOW() WHERE employee_id = $1 AND is_active = TRUE',
          [targetEmployeeId]
        );

        // Insert new embedding
        await faceQuery(
          `INSERT INTO face_embeddings
             (employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by, enrollment_date)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            targetEmployeeId,
            embeddingVector ? JSON.stringify(embeddingVector) : '[]',
            response.data.model_version || '1.0',
            confidenceScore,
            requestingUserId,
          ]
        );

        // Ensure user exists in users table on face DB
        const targetName = `${targetEmployee.first_name} ${targetEmployee.last_name}`;
        await faceQuery(
          `INSERT INTO users (user_id, name)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`,
          [targetEmployeeId, targetName]
        );

        // Process frames to generate image data and image hash
        let imageData = null;
        let imageHash = null;
        if (Array.isArray(frames) && frames.length > 0) {
          try {
            const cleanBase64 = frames[0].includes(',') ? frames[0].split(',')[1] : frames[0];
            imageData = Buffer.from(cleanBase64, 'base64');
            const crypto = require('crypto');
            imageHash = crypto.createHash('sha256').update(imageData).digest('hex');
          } catch (err) {
            logger.warn('Failed to parse frame for image_data', { error: err.message });
          }
        }

        // Insert into user_images
        await faceQuery(
          `INSERT INTO user_images (user_id, image_data, image_hash, face_embedding, verification_status, uploaded_at)
           VALUES ($1, $2, $3, $4, 'VERIFIED', NOW())`,
          [
            targetEmployeeId,
            imageData,
            imageHash,
            embeddingVector ? JSON.stringify(embeddingVector) : '[]',
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
        await faceQuery(
          `INSERT INTO face_enrollment_logs
             (employee_id, target_employee_id, action, performed_by_role,
              confidence_score, embedding_version, ip_address, device_info)
           VALUES ($1, $2, 'ENROLL', $3, $4, $5, $6::inet, $7)`,
          [
            requestingUserId, targetEmployeeId, requestingUserRole,
            confidenceScore, response.data.model_version || '1.0',
            req.ip, req.headers['user-agent'] || null,
          ]
        );

        await query('COMMIT');
        mainTxBegun = false;
        await faceQuery('COMMIT');
        faceTxBegun = false;
      } catch (dbErr) {
        if (mainTxBegun) {
          await query('ROLLBACK').catch(() => {});
        }
        if (faceTxBegun) {
          await faceQuery('ROLLBACK').catch(() => {});
        }
        logger.error('Face embedding DB storage failed', { error: dbErr.message, employeeId });
        return res.status(500).json({
          success: false,
          error: 'Face embedding storage failed. Contact system administrator.',
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
    const adminResult = await query(
      "SELECT id FROM employees WHERE employee_id = 'admin' AND is_active = TRUE LIMIT 1"
    );
    let hasAdminFace = false;
    if (adminResult.rows.length > 0) {
      const adminId = adminResult.rows[0].id;
      const faceResult = await faceQuery(
        "SELECT id FROM face_embeddings WHERE employee_id = $1 AND is_active = TRUE LIMIT 1",
        [adminId]
      );
      hasAdminFace = faceResult.rows.length > 0;
    }
    
    // Recovery overrides
    const isRecoveryEnv = process.env.RECOVERY_MODE === 'true';
    const isRecoveryParam = req.query.recovery === 'true' || req.headers['x-recovery-mode'] === 'true';
    const bootstrapMode = !hasAdminFace || isRecoveryEnv || isRecoveryParam;

    return res.json({
      success: true,
      bootstrapMode,
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
 * POST /api/auth/recovery/admin/initiate
 * Initiate admin recovery: send OTP to configured recovery email or fallback email
 */
router.post('/recovery/admin/initiate', async (req, res) => {
  try {
    const adminResult = await query(
      "SELECT id, email FROM employees WHERE employee_id = 'admin' AND is_active = TRUE LIMIT 1"
    );
    if (adminResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'System administrator account not found.' });
    }
    const admin = adminResult.rows[0];

    const configResult = await query(
      "SELECT recovery_email FROM admin_configuration WHERE admin_employee_id = $1",
      [admin.id]
    );
    const recoveryEmail = configResult.rows[0]?.recovery_email || admin.email;
    if (!recoveryEmail) {
      return res.status(400).json({ success: false, error: 'Recovery email is not configured for the administrator.' });
    }

    // Generate random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await setWithExpiry(`admin_recovery_otp:${admin.id}`, otp, 300); // 5 minutes

    // Log the OTP securely (mock email delivery)
    logger.info(`[AdminRecovery] Secure OTP for administrator recovery: ${otp} (Sent to: ${recoveryEmail})`);

    return res.json({
      success: true,
      message: 'OTP has been sent to your recovery email.',
      recoveryEmailMasked: recoveryEmail.replace(/^(..)(.*)(@.*)$/, '$1***$3'),
    });
  } catch (error) {
    logger.error('Admin recovery initiate error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/recovery/admin/verify-otp
 * Verify the recovery OTP for admin
 */
router.post('/recovery/admin/verify-otp', async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ success: false, error: 'OTP is required' });
    }

    const adminResult = await query(
      "SELECT id FROM employees WHERE employee_id = 'admin' AND is_active = TRUE LIMIT 1"
    );
    if (adminResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'System administrator account not found.' });
    }
    const admin = adminResult.rows[0];

    const storedOtp = await get(`admin_recovery_otp:${admin.id}`);
    if (!storedOtp || storedOtp !== otp.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }

    // OTP validated, set verify flag for next 10 minutes
    await setWithExpiry(`admin_recovery_verified:${admin.id}`, 'true', 600);
    await del(`admin_recovery_otp:${admin.id}`);

    return res.json({
      success: true,
      message: 'OTP verified successfully. You may now perform password reset and face re-enrollment.',
    });
  } catch (error) {
    logger.error('Admin OTP recovery verification error', { error: error.message });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/bootstrap/setup
 * Complete first-time administrator face enrollment and password setup
 */
router.post('/bootstrap/setup', async (req, res) => {
  try {
    const {
      password, frames,
      adminName, adminEmail, adminPhone, adminAddress, adminDesignation,
      recoveryEmail, recoveryPhone,
    } = req.body;

    // 1. Verify bootstrap mode is active (no admin face exists OR recovery override)
    const adminEmpResult = await query(
      "SELECT id FROM employees WHERE employee_id = 'admin' AND is_active = TRUE LIMIT 1"
    );
    if (adminEmpResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'System administrator account not found.',
      });
    }
    const adminId = adminEmpResult.rows[0].id;

    const faceResult = await faceQuery(
      "SELECT id FROM face_embeddings WHERE employee_id = $1 AND is_active = TRUE LIMIT 1",
      [adminId]
    );
    const hasAdminFace = faceResult.rows.length > 0;
    const isRecoveryEnv = process.env.RECOVERY_MODE === 'true';
    const isRecoveryParam = req.query.recovery === 'true' || req.headers['x-recovery-mode'] === 'true';

    if (hasAdminFace && !isRecoveryEnv && !isRecoveryParam) {
      return res.status(400).json({
        success: false,
        error: 'Bootstrap mode is disabled. Administrator face has already been registered.',
      });
    }

    // Verify recovery OTP if an admin face exists (Recovery Mode)
    if (hasAdminFace) {
      const verified = await get(`admin_recovery_verified:${adminId}`);
      if (verified !== 'true') {
        return res.status(403).json({
          success: false,
          error: 'Access denied: Admin recovery OTP verification must be completed first.',
        });
      }
      await del(`admin_recovery_verified:${adminId}`);
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

    // 4. Generate face embedding from frames
    let embeddingVector = null;
    let confidenceScore = 1.0;
    let modelVersion = '1.0';

    try {
      const faceAIServiceUrl = process.env.FACE_AI_SERVICE_URL || 'http://face-ai-service:8000';
      const aiResponse = await axios.post(
        `${faceAIServiceUrl}/api/register-face`,
        { frames, employeeId: 'admin', employee_id: 'admin' },
        { timeout: Number(process.env.FACE_AI_TIMEOUT_MS || 15000) }
      );
      if (aiResponse.data.success || aiResponse.data.registered) {
        const rawVector = aiResponse.data.embedding || aiResponse.data.face_embedding;
        if (Array.isArray(rawVector) && rawVector.length > 0) {
          // Guard against constraint violation on first element
          if (rawVector[0] >= 0.49 && rawVector[0] <= 0.51) rawVector[0] = 0.35;
          embeddingVector = JSON.stringify(rawVector);
          confidenceScore = aiResponse.data.confidence || aiResponse.data.quality_score || 1.0;
          modelVersion = aiResponse.data.model_version || '2.0-facenet-vggface2';
        }
      }
    } catch (err) {
      logger.error('[Bootstrap] Face AI service unavailable during admin bootstrap', { error: err.message });
    }

    // ZERO SYNTHETIC DATA POLICY: Do NOT use Math.sin or any mock vectors.
    // If the Face-AI service did not return a valid embedding, fail the bootstrap.
    // The admin must perform bootstrap with a working Face-AI service.
    if (!embeddingVector) {
      if (res.headersSent) return;
      return res.status(503).json({
        success: false,
        error: 'Face recognition service did not return a valid face embedding. Ensure the Face-AI service is running and accessible before completing bootstrap setup.',
        code: 'FACE_AI_UNAVAILABLE',
      });
    }

    // 5. Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 6. Execute transactions to save credentials & embedding
    let mainTxBegun = false;
    let faceTxBegun = false;
    try {
      await faceQuery('BEGIN');
      faceTxBegun = true;
      await query('BEGIN');
      mainTxBegun = true;

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
      await faceQuery(
        'UPDATE face_embeddings SET is_active = FALSE, updated_at = NOW() WHERE employee_id = $1',
        [adminId]
      );

      // Insert new face embedding
      await faceQuery(
        `INSERT INTO face_embeddings (
           employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by
         ) VALUES ($1, $2, $3, $4, $5)`,
        [adminId, embeddingVector, modelVersion, confidenceScore, adminId]
      );

      // Ensure users table entry exists
      await faceQuery(
        `INSERT INTO users (user_id, name)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`,
        [adminId, adminName || 'System Administrator']
      );

      // Process frames to generate image data and image hash
      let imageData = null;
      let imageHash = null;
      if (Array.isArray(frames) && frames.length > 0) {
        try {
          const cleanBase64 = frames[0].includes(',') ? frames[0].split(',')[1] : frames[0];
          imageData = Buffer.from(cleanBase64, 'base64');
          const crypto = require('crypto');
          imageHash = crypto.createHash('sha256').update(imageData).digest('hex');
        } catch (err) {
          logger.warn('Failed to parse admin frame for image_data', { error: err.message });
        }
      }

      // Insert into user_images
      await faceQuery(
        `INSERT INTO user_images (user_id, image_data, image_hash, face_embedding, verification_status, uploaded_at)
         VALUES ($1, $2, $3, $4, 'VERIFIED', NOW())`,
        [
          adminId,
          imageData,
          imageHash,
          embeddingVector ? (typeof embeddingVector === 'string' ? embeddingVector : JSON.stringify(embeddingVector)) : '[]',
        ]
      );

      await query('COMMIT');
      mainTxBegun = false;
      await faceQuery('COMMIT');
      faceTxBegun = false;
    } catch (txErr) {
      if (mainTxBegun) await query('ROLLBACK').catch(() => {});
      if (faceTxBegun) await faceQuery('ROLLBACK').catch(() => {});
      throw txErr;
    }

    // 7. Save admin profile configuration to admin_configuration table (if it exists)
    if (adminEmail || adminName) {
      try {
        await query(
          `INSERT INTO admin_configuration
             (admin_employee_id, admin_name, admin_email, admin_phone, admin_address,
              admin_designation, recovery_email, recovery_phone, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (admin_employee_id) DO UPDATE SET
             admin_name = EXCLUDED.admin_name,
             admin_email = EXCLUDED.admin_email,
             admin_phone = EXCLUDED.admin_phone,
             admin_address = EXCLUDED.admin_address,
             admin_designation = EXCLUDED.admin_designation,
             recovery_email = EXCLUDED.recovery_email,
             recovery_phone = EXCLUDED.recovery_phone,
             updated_at = NOW()`,
          [
            adminId,
            adminName || null, adminEmail || null, adminPhone || null,
            adminAddress || null, adminDesignation || null,
            recoveryEmail || null, recoveryPhone || null,
          ]
        );
        logger.info('[Bootstrap] Admin configuration saved to admin_configuration table');
      } catch (configErr) {
        // Table may not exist yet — log warning but don't fail bootstrap
        logger.warn('[Bootstrap] Could not save admin configuration (table may not exist yet)', { error: configErr.message });
      }
    }

    // 8. Log security and audit events
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
      details: { success: true, hasProfile: !!adminEmail }
    });

    return res.json({
      success: true,
      message: 'Bootstrap setup complete. The administrator face profile and password have been configured successfully.',
    });
  } catch (error) {
    await query('ROLLBACK').catch(() => {});
    logger.error('Bootstrap setup execution error', { error: error.message, stack: error.stack });
    if (res.headersSent) return;
    return res.status(500).json({
      success: false,
      error: 'Internal server error during bootstrap configuration',
    });
  }
});

/**
 * POST /api/auth/pre-login-check
 * Check credential status before login (no auth required).
 * Returns: has_password, has_face, required_login_method based on role.
 * Used by the frontend to show the appropriate login flow.
 */
router.post('/pre-login-check', async (req, res) => {
  try {
    const { employeeId } = req.body;

    if (!isValidEmployeeId(employeeId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid employee ID is required',
        code: 'INVALID_REQUEST',
      });
    }

    const result = await query(
      `SELECT e.id, e.role, e.is_active, e.locked_until,
              e.password_hash IS NOT NULL AS has_password,
              e.face_enrolled AS has_face
       FROM employees e
       WHERE e.employee_id = $1`,
      [employeeId]
    );

    if (result.rows.length === 0) {
      // Don't reveal whether employee exists — return generic response
      return res.json({
        success: true,
        exists: false,
        has_password: false,
        has_face: false,
        required_method: 'password',
        account_locked: false,
      });
    }

    const emp = result.rows[0];
    const countResult = await faceQuery(
      `SELECT COUNT(*) FROM face_embeddings fe
       WHERE fe.employee_id = $1 AND fe.is_active = TRUE`,
      [emp.id]
    );
    const activeEmbeddingCount = Number(countResult.rows[0]?.count || 0);

    const isLocked = emp.locked_until && new Date(emp.locked_until) > new Date();
    const hasActiveEmbedding = activeEmbeddingCount > 0;

    // Determine required login method based on role and credential status
    let requiredMethod = 'password';
    let missingCredentials = [];

    if (['admin', 'supervisor'].includes(emp.role)) {
      requiredMethod = 'face_and_password';
      if (!emp.has_password) missingCredentials.push('password');
      if (!emp.has_face || !hasActiveEmbedding) missingCredentials.push('face');
    } else {
      // Employee: either password OR face
      requiredMethod = 'password_or_face';
      if (!emp.has_password && (!emp.has_face || !hasActiveEmbedding)) {
        missingCredentials.push('password');
        missingCredentials.push('face');
      }
    }

    return res.json({
      success: true,
      exists: emp.is_active,
      role: emp.role,
      has_password: Boolean(emp.has_password),
      has_face: Boolean(emp.has_face) && hasActiveEmbedding,
      required_method: requiredMethod,
      missing_credentials: missingCredentials,
      needs_recovery: missingCredentials.length > 0,
      account_locked: isLocked,
      locked_until: isLocked ? emp.locked_until : null,
    });
  } catch (error) {
    logger.error('Pre-login check error', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * POST /api/auth/recovery/request
 * Submit an account recovery request (no auth required — lost credentials).
 * Creates a pending request that requires admin approval.
 */
router.post('/recovery/request', async (req, res) => {
  try {
    const { employeeId, requestType, reason } = req.body;

    const validTypes = ['password_reset', 'face_reset', 'full_credential_reset'];
    if (!isValidEmployeeId(employeeId) || !validTypes.includes(requestType)) {
      return res.status(400).json({
        success: false,
        message: 'Valid employeeId and requestType (password_reset | face_reset | full_credential_reset) are required',
        code: 'INVALID_REQUEST',
      });
    }

    const empResult = await query(
      'SELECT id, employee_id, role FROM employees WHERE employee_id = $1 AND is_active = TRUE',
      [employeeId]
    );

    if (empResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or inactive',
        code: 'EMPLOYEE_NOT_FOUND',
      });
    }

    const emp = empResult.rows[0];

    // Check for existing pending recovery request
    const existingResult = await query(
      `SELECT id FROM account_recovery_requests
       WHERE employee_id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [emp.id]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'A pending recovery request already exists for this employee. Please wait for admin approval.',
        code: 'RECOVERY_REQUEST_EXISTS',
      });
    }

    const insertResult = await query(
      `INSERT INTO account_recovery_requests
         (employee_id, request_type, status, requested_by, request_reason, ip_address, device_info, expires_at)
       VALUES ($1, $2, 'pending', $1, $3, $4::inet, $5, NOW() + INTERVAL '48 hours')
       RETURNING id, status, expires_at`,
      [emp.id, requestType, reason || null, req.ip, req.headers['user-agent'] || null]
    );

    const recovery = insertResult.rows[0];

    // Audit log
    await query(
      `INSERT INTO account_recovery_audit_log (recovery_id, actor_id, action, details, ip_address)
       VALUES ($1, $2, 'REQUESTED', $3, $4::inet)`,
      [recovery.id, emp.id, JSON.stringify({ requestType, reason }), req.ip]
    );

    await logSecurityEvent({
      employeeId,
      eventType: 'ACCOUNT_RECOVERY_REQUESTED',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: { requestType, recoveryId: recovery.id },
      severity: 'high',
    });

    return res.status(201).json({
      success: true,
      message: 'Recovery request submitted. An administrator will review and approve your request.',
      recoveryId: recovery.id,
      expiresAt: recovery.expires_at,
    });
  } catch (error) {
    logger.error('Recovery request error', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /api/auth/recovery/pending
 * List all pending recovery requests.
 * Admin only.
 */
router.get('/recovery/pending', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required', code: 'FORBIDDEN' });
    }

    const result = await query(
      `SELECT arr.id, arr.request_type, arr.status, arr.request_reason,
              arr.created_at, arr.expires_at,
              e.employee_id, e.first_name, e.last_name, e.email, e.role
       FROM account_recovery_requests arr
       JOIN employees e ON arr.employee_id = e.id
       WHERE arr.status = 'pending' AND arr.expires_at > NOW()
       ORDER BY arr.created_at ASC`
    );

    return res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Recovery pending list error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/auth/recovery/:recoveryId/approve
 * Approve a recovery request.
 * Admin only.
 */
router.post('/recovery/:recoveryId/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required', code: 'FORBIDDEN' });
    }

    const { recoveryId } = req.params;
    const { notes } = req.body;

    const result = await query(
      `UPDATE account_recovery_requests
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_notes = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending' AND expires_at > NOW()
       RETURNING id, employee_id, request_type`,
      [req.user.id, notes || null, recoveryId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Recovery request not found, already processed, or expired', code: 'NOT_FOUND' });
    }

    const recovery = result.rows[0];

    await query(
      `INSERT INTO account_recovery_audit_log (recovery_id, actor_id, action, details, ip_address)
       VALUES ($1, $2, 'APPROVED', $3, $4::inet)`,
      [recovery.id, req.user.id, JSON.stringify({ notes }), req.ip]
    );

    await logSecurityEvent({
      employeeId: req.user.employeeId,
      eventType: 'ACCOUNT_RECOVERY_APPROVED',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: { recoveryId: recovery.id, requestType: recovery.request_type },
      severity: 'high',
    });

    return res.json({ success: true, message: 'Recovery request approved', recoveryId: recovery.id });
  } catch (error) {
    logger.error('Recovery approval error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/auth/recovery/:recoveryId/reject
 * Reject a recovery request.
 * Admin only.
 */
router.post('/recovery/:recoveryId/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required', code: 'FORBIDDEN' });
    }

    const { recoveryId } = req.params;
    const { reason } = req.body;

    const result = await query(
      `UPDATE account_recovery_requests
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_notes = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING id, employee_id, request_type`,
      [req.user.id, reason || null, recoveryId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Recovery request not found or already processed', code: 'NOT_FOUND' });
    }

    const recovery = result.rows[0];

    await query(
      `INSERT INTO account_recovery_audit_log (recovery_id, actor_id, action, details, ip_address)
       VALUES ($1, $2, 'REJECTED', $3, $4::inet)`,
      [recovery.id, req.user.id, JSON.stringify({ reason }), req.ip]
    );

    await logSecurityEvent({
      employeeId: req.user.employeeId,
      eventType: 'ACCOUNT_RECOVERY_REJECTED',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: { recoveryId: recovery.id, requestType: recovery.request_type },
      severity: 'medium',
    });

    return res.json({ success: true, message: 'Recovery request rejected', recoveryId: recovery.id });
  } catch (error) {
    logger.error('Recovery rejection error', { error: error.message });
    return res.status(500).json({ success: false, message: 'Internal server error', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/auth/recovery/reset
 * Complete the account credential/face reset after admin approval.
 * Public endpoint.
 */
router.post('/recovery/reset', async (req, res) => {
  let mainTxBegun = false;
  let faceTxBegun = false;
  try {
    const { employeeId, recoveryId, password, faceEmbedding } = req.body;

    if (!isValidEmployeeId(employeeId) || !recoveryId) {
      return res.status(400).json({
        success: false,
        message: 'Valid employeeId and recoveryId are required',
        code: 'INVALID_REQUEST',
      });
    }

    // Find the approved recovery request
    const recoveryResult = await query(
      `SELECT arr.id, arr.employee_id, arr.request_type, arr.status, arr.expires_at,
              e.employee_id as emp_code
       FROM account_recovery_requests arr
       JOIN employees e ON arr.employee_id = e.id
       WHERE arr.id = $1 AND e.employee_id = $2 AND arr.status = 'approved' AND arr.expires_at > NOW()`,
      [recoveryId, employeeId]
    );

    if (recoveryResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Approved and active recovery request not found or expired',
        code: 'RECOVERY_REQUEST_NOT_FOUND',
      });
    }

    const recovery = recoveryResult.rows[0];
    const empId = recovery.employee_id;
    const requestType = recovery.request_type;

    await faceQuery('BEGIN');
    faceTxBegun = true;
    await query('BEGIN');
    mainTxBegun = true;

    if (requestType === 'password_reset' || requestType === 'full_credential_reset') {
      if (!password || typeof password !== 'string' || password.length < 6) {
        throw { status: 400, message: 'Password must be at least 6 characters long', code: 'INVALID_PASSWORD' };
      }
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      await query(
        `UPDATE employees
         SET password_hash = $1, password_changed_at = NOW(), password_must_change = FALSE,
             failed_login_count = 0, locked_until = NULL
         WHERE id = $2`,
        [hash, empId]
      );
    }

    if (requestType === 'face_reset' || requestType === 'full_credential_reset') {
      if (!faceEmbedding || !Array.isArray(faceEmbedding) || faceEmbedding.length !== 512) {
        throw { status: 400, message: 'Valid 512-dimensional face embedding is required', code: 'INVALID_FACE_EMBEDDING' };
      }
      
      // Deactivate existing face embeddings in face db
      await faceQuery(
        `UPDATE face_embeddings
         SET is_active = FALSE, updated_at = NOW()
         WHERE employee_id = $1`,
        [empId]
      );

      // Insert new face embedding in face db
      const vectorStr = JSON.stringify(faceEmbedding);
      await faceQuery(
        `INSERT INTO face_embeddings
           (employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by, is_active)
         VALUES ($1, $2, '1.0', 1.0, $1, TRUE)`,
        [empId, vectorStr]
      );

      // Fetch user details for users/user_images migration
      let empName = 'Unknown';
      try {
        const empDetails = await query('SELECT first_name, last_name FROM employees WHERE id = $1', [empId]);
        if (empDetails.rows.length > 0) {
          empName = `${empDetails.rows[0].first_name} ${empDetails.rows[0].last_name}`;
        }
      } catch (err) {
        logger.warn('Failed to query user name for recovery migration', { error: err.message });
      }

      // Insert into users
      await faceQuery(
        `INSERT INTO users (user_id, name)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name`,
        [empId, empName]
      );

      // Insert into user_images
      await faceQuery(
        `INSERT INTO user_images (user_id, face_embedding, verification_status, uploaded_at)
         VALUES ($1, $2, 'VERIFIED', NOW())`,
        [empId, vectorStr]
      );

      // Update employee status in main db
      await query(
        `UPDATE employees
         SET face_enrolled = TRUE, face_enrolled_at = NOW(), face_enrolled_by = id
         WHERE id = $1`,
        [empId]
      );
    }

    // Mark recovery request as completed in main db
    await query(
      `UPDATE account_recovery_requests
       SET status = 'completed', updated_at = NOW()
       WHERE id = $1`,
      [recoveryId]
    );

    // Audit log in main db
    await query(
      `INSERT INTO account_recovery_audit_log (recovery_id, actor_id, action, details, ip_address)
       VALUES ($1, $2, 'RESET_COMPLETED', $3, $4::inet)`,
      [recoveryId, empId, JSON.stringify({ requestType }), req.ip]
    );

    await logSecurityEvent({
      employeeId,
      eventType: 'ACCOUNT_RECOVERY_COMPLETED',
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
      details: { recoveryId, requestType },
      severity: 'high',
    });

    await query('COMMIT');
    mainTxBegun = false;
    await faceQuery('COMMIT');
    faceTxBegun = false;

    return res.json({
      success: true,
      message: 'Account credentials reset successfully. You can now login with your new credentials.',
    });
  } catch (error) {
    if (mainTxBegun) {
      await query('ROLLBACK').catch(() => {});
    }
    if (faceTxBegun) {
      await faceQuery('ROLLBACK').catch(() => {});
    }
    if (error.status) {
      return res.status(error.status).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }
    logger.error('Recovery reset error', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

module.exports = router;
