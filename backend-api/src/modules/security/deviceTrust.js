/**
 * V9 — DEVICE TRUST SCORING ENGINE (Database-Persistent)
 *
 * Replaces in-memory Map storage with persistent database storage
 * using the device_fingerprints table (migration 006).
 *
 * Assigns a trust score to login attempts based on device familiarity.
 * Known devices (by user-agent + IP fingerprint) get higher trust scores.
 * Unknown devices trigger step-up authentication requirements.
 *
 * Trust levels:
 *   HIGH   (80-100) — Known device, known IP, recent activity
 *   MEDIUM (40-79)  — Partial match (known device OR known IP)
 *   LOW    (0-39)   — Completely unknown device and IP
 *
 * Usage:
 *   const { deviceTrust } = require('./modules/security/deviceTrust');
 *   const score = await deviceTrust.evaluate(userId, req);
 *   await deviceTrust.register(userId, req);
 */
const crypto = require('crypto');
const { logger } = require('../../config/logger');

// In-memory cache for fallback when DB is unavailable
const _memCache = new Map(); // userId → Set of fingerprints
const _memIps = new Map();   // userId → Set of IPs

class DeviceTrustEngine {
  constructor() {
    this._maxPerUser = 20;
    // Lazy-load database to avoid circular dependency issues at startup
    this._db = null;
  }

  _getDB() {
    if (!this._db) {
      try {
        this._db = require('../../config/database');
      } catch (err) {
        logger.warn('[DeviceTrust] Could not load database module', { error: err.message });
      }
    }
    return this._db;
  }

  /** Generate a device fingerprint from request headers. */
  _fingerprint(req) {
    const ua = req.headers?.['user-agent'] || '';
    const accept = req.headers?.['accept-language'] || '';
    return crypto.createHash('sha256')
      .update(`${ua}|${accept}`)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Evaluate device trust for a login attempt.
   * Queries device_fingerprints table. Falls back to in-memory if DB unavailable.
   * @returns {{ score: number, level: string, isNewDevice: boolean, isNewIp: boolean }}
   */
  async evaluate(userId, req) {
    const fp = this._fingerprint(req);
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    try {
      const db = this._getDB();
      if (db) {
        const result = await db.query(
          `SELECT fingerprint, ip_address, trust_score, trust_level
           FROM device_fingerprints
           WHERE employee_id = $1 AND revoked_at IS NULL
           ORDER BY last_seen_at DESC
           LIMIT $2`,
          [userId, this._maxPerUser]
        );

        const knownFingerprints = new Set(result.rows.map(r => r.fingerprint));
        const knownIps = new Set(result.rows.map(r => r.ip_address?.toString()));

        const isKnownDevice = knownFingerprints.has(fp);
        const isKnownIp = knownIps.has(ip);

        let score = 0;
        if (isKnownDevice) score += 50;
        if (isKnownIp) score += 30;
        if (isKnownDevice && isKnownIp) score += 20;

        const level = score >= 80 ? 'high' : score >= 40 ? 'medium' : 'low';

        return { score, level, isNewDevice: !isKnownDevice, isNewIp: !isKnownIp, fingerprint: fp };
      }
    } catch (err) {
      logger.warn('[DeviceTrust] DB evaluate failed, falling back to memory', { error: err.message });
    }

    // Memory fallback
    const knownDevices = _memCache.get(userId) || new Set();
    const knownIps = _memIps.get(userId) || new Set();
    const isKnownDevice = knownDevices.has(fp);
    const isKnownIp = knownIps.has(ip);

    let score = 0;
    if (isKnownDevice) score += 50;
    if (isKnownIp) score += 30;
    if (isKnownDevice && isKnownIp) score += 20;
    const level = score >= 80 ? 'high' : score >= 40 ? 'medium' : 'low';

    return { score, level, isNewDevice: !isKnownDevice, isNewIp: !isKnownIp, fingerprint: fp };
  }

  /**
   * Register a device after successful authentication.
   * Upserts into device_fingerprints table.
   * Falls back to in-memory if DB unavailable.
   */
  async register(userId, req) {
    const fp = this._fingerprint(req);
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const ua = req.headers?.['user-agent'] || null;

    try {
      const db = this._getDB();
      if (db) {
        await db.query(
          `INSERT INTO device_fingerprints
             (employee_id, fingerprint, ip_address, user_agent, trust_score, trust_level,
              first_seen_at, last_seen_at, login_count)
           VALUES ($1, $2, $3::inet, $4, 50, 'medium', NOW(), NOW(), 1)
           ON CONFLICT (employee_id, fingerprint)
           DO UPDATE SET
             last_seen_at = NOW(),
             ip_address   = EXCLUDED.ip_address,
             login_count  = device_fingerprints.login_count + 1,
             trust_score  = LEAST(100, device_fingerprints.trust_score + 5),
             trust_level  = CASE
               WHEN LEAST(100, device_fingerprints.trust_score + 5) >= 80 THEN 'high'
               WHEN LEAST(100, device_fingerprints.trust_score + 5) >= 40 THEN 'medium'
               ELSE 'low'
             END,
             updated_at   = NOW()`,
          [userId, fp, ip, ua]
        );

        logger.debug('[DeviceTrust] Device registered to DB', { userId, fingerprint: fp, ip });
        return;
      }
    } catch (err) {
      logger.warn('[DeviceTrust] DB register failed, falling back to memory', { error: err.message });
    }

    // Memory fallback
    if (!_memCache.has(userId)) _memCache.set(userId, new Set());
    if (!_memIps.has(userId)) _memIps.set(userId, new Set());

    const devices = _memCache.get(userId);
    const ips = _memIps.get(userId);
    devices.add(fp);
    ips.add(ip);

    if (devices.size > this._maxPerUser) {
      const oldest = devices.values().next().value;
      devices.delete(oldest);
    }
    if (ips.size > this._maxPerUser) {
      const oldest = ips.values().next().value;
      ips.delete(oldest);
    }

    logger.debug('[DeviceTrust] Device registered to memory fallback', { userId, fingerprint: fp, ip });
  }

  async getStats() {
    try {
      const db = this._getDB();
      if (db) {
        const result = await db.query(
          `SELECT COUNT(DISTINCT employee_id) as tracked_users,
                  COUNT(*) as total_devices
           FROM device_fingerprints
           WHERE revoked_at IS NULL`
        );
        return {
          source: 'database',
          trackedUsers: parseInt(result.rows[0]?.tracked_users || 0),
          totalDevices: parseInt(result.rows[0]?.total_devices || 0),
          memoryFallback: { trackedUsers: _memCache.size },
        };
      }
    } catch (err) {
      logger.warn('[DeviceTrust] Stats DB query failed', { error: err.message });
    }

    return {
      source: 'memory',
      trackedUsers: _memCache.size,
      totalDevices: [..._memCache.values()].reduce((sum, s) => sum + s.size, 0),
      totalIps: [..._memIps.values()].reduce((sum, s) => sum + s.size, 0),
    };
  }
}

const deviceTrust = new DeviceTrustEngine();

module.exports = { deviceTrust, DeviceTrustEngine };
