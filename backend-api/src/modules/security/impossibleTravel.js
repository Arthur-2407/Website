/**
 * V9 — IMPOSSIBLE TRAVEL DETECTION ENGINE (Database-Persistent)
 *
 * Replaces in-memory Map storage with persistent database storage
 * using the impossible_travel_events and employee_login_locations tables
 * (added in migration 006).
 *
 * Detects geographically impossible login patterns by comparing
 * consecutive login locations against maximum human travel speed.
 *
 * If two logins from the same user occur from locations that would
 * require faster-than-possible travel, a security event is raised.
 *
 * Usage:
 *   const { impossibleTravel } = require('./modules/security/impossibleTravel');
 *   const threat = await impossibleTravel.check(userId, { lat, lng, timestamp });
 */
const { logger } = require('../../config/logger');

const MAX_SPEED_KMH = 900; // Max plausible speed (commercial jet)

// In-memory cache for last login locations (supplemented by DB)
const _lastLogins = new Map();
const _alerts = [];
const MAX_ALERTS = 1000;

class ImpossibleTravelDetector {
  constructor() {
    this._db = null;
  }

  _getDB() {
    if (!this._db) {
      try {
        this._db = require('../../config/database');
      } catch (err) {
        logger.warn('[ImpossibleTravel] Could not load database module', { error: err.message });
      }
    }
    return this._db;
  }

  /**
   * Check a login attempt for impossible travel.
   * Reads last location from DB, stores new event to DB.
   * Falls back to memory if DB unavailable.
   * @returns {{ isThreat: boolean, details?: object }}
   */
  async check(userId, location) {
    if (!location || !location.lat || !location.lng) {
      return { isThreat: false };
    }

    const now = location.timestamp || Date.now();
    let last = null;

    // Try to get last location from database
    try {
      const db = this._getDB();
      if (db) {
        const result = await db.query(
          `SELECT last_lat, last_lng, last_login_at
           FROM employee_login_locations
           WHERE employee_id = (
             SELECT id FROM employees WHERE employee_id = $1 LIMIT 1
           )`,
          [userId]
        );

        if (result.rows.length > 0) {
          const row = result.rows[0];
          last = {
            lat: parseFloat(row.last_lat),
            lng: parseFloat(row.last_lng),
            timestamp: new Date(row.last_login_at).getTime(),
          };
        }

        // Update last login location
        await db.query(
          `INSERT INTO employee_login_locations (employee_id, last_lat, last_lng, last_login_at, updated_at)
           VALUES (
             (SELECT id FROM employees WHERE employee_id = $1 LIMIT 1),
             $2, $3, NOW(), NOW()
           )
           ON CONFLICT (employee_id) DO UPDATE SET
             last_lat = EXCLUDED.last_lat,
             last_lng = EXCLUDED.last_lng,
             last_login_at = NOW(),
             updated_at = NOW()`,
          [userId, location.lat, location.lng]
        );
      } else {
        last = _lastLogins.get(userId) || null;
      }
    } catch (err) {
      logger.warn('[ImpossibleTravel] DB check failed, using memory fallback', { error: err.message });
      // Fall back to in-memory
      last = _lastLogins.get(userId) || null;
    }

    // Update memory cache as backup
    _lastLogins.set(userId, { lat: location.lat, lng: location.lng, timestamp: now });

    if (!last) {
      return { isThreat: false };
    }

    const distanceKm = this._haversine(last.lat, last.lng, location.lat, location.lng);
    const timeDiffHrs = (now - last.timestamp) / (1000 * 60 * 60);

    if (timeDiffHrs <= 0) {
      return { isThreat: false };
    }

    const requiredSpeedKmh = distanceKm / timeDiffHrs;

    if (requiredSpeedKmh > MAX_SPEED_KMH && distanceKm > 50) {
      const alert = {
        userId,
        from: { lat: last.lat, lng: last.lng },
        to: { lat: location.lat, lng: location.lng },
        distanceKm: Math.round(distanceKm),
        timeDiffMinutes: Math.round(timeDiffHrs * 60),
        requiredSpeedKmh: Math.round(requiredSpeedKmh),
        severity: requiredSpeedKmh > 5000 ? 'critical' : 'high',
        timestamp: new Date(now).toISOString(),
      };

      // Store alert in database
      try {
        const db = this._getDB();
        if (db) {
          await db.query(
            `INSERT INTO impossible_travel_events
               (employee_id_str, from_lat, from_lng, to_lat, to_lng,
                distance_km, time_diff_minutes, required_speed_kmh, severity)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              userId,
              last.lat, last.lng,
              location.lat, location.lng,
              alert.distanceKm,
              alert.timeDiffMinutes,
              alert.requiredSpeedKmh,
              alert.severity,
            ]
          );
        }
      } catch (err) {
        logger.warn('[ImpossibleTravel] DB alert store failed', { error: err.message });
      }

      // Memory backup
      _alerts.push(alert);
      if (_alerts.length > MAX_ALERTS) {
        _alerts.splice(0, _alerts.length - MAX_ALERTS / 2);
      }

      logger.warn('[ImpossibleTravel] Threat detected', alert);

      return { isThreat: true, details: alert };
    }

    return { isThreat: false };
  }

  /** Haversine formula — distance between two GPS coordinates in km. */
  _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = this._toRad(lat2 - lat1);
    const dLng = this._toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(this._toRad(lat1)) * Math.cos(this._toRad(lat2))
      * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  _toRad(deg) { return deg * (Math.PI / 180); }

  async getAlerts(limit = 50) {
    try {
      const db = this._getDB();
      if (db) {
        const result = await db.query(
          `SELECT id, employee_id_str as user_id, from_lat, from_lng, to_lat, to_lng,
                  distance_km, time_diff_minutes, required_speed_kmh, severity, created_at as timestamp
           FROM impossible_travel_events
           WHERE resolved = FALSE
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit]
        );
        return result.rows;
      }
    } catch (err) {
      logger.warn('[ImpossibleTravel] DB getAlerts failed', { error: err.message });
    }
    return _alerts.slice(-limit).reverse();
  }

  async getStats() {
    try {
      const db = this._getDB();
      if (db) {
        const result = await db.query(
          `SELECT COUNT(*) as total_alerts,
                  COUNT(*) FILTER (WHERE resolved = FALSE) as unresolved_alerts,
                  COUNT(DISTINCT employee_id_str) as tracked_users
           FROM impossible_travel_events`
        );
        return {
          source: 'database',
          trackedUsers: parseInt(result.rows[0]?.tracked_users || 0),
          totalAlerts: parseInt(result.rows[0]?.total_alerts || 0),
          unresolvedAlerts: parseInt(result.rows[0]?.unresolved_alerts || 0),
        };
      }
    } catch (err) {
      logger.warn('[ImpossibleTravel] Stats DB query failed', { error: err.message });
    }
    return {
      source: 'memory',
      trackedUsers: _lastLogins.size,
      totalAlerts: _alerts.length,
      recentAlerts: _alerts.slice(-5),
    };
  }

  /** Clear tracking data for a user (e.g., on password reset). */
  async clearUser(userId) {
    _lastLogins.delete(userId);
    try {
      const db = this._getDB();
      if (db) {
        await db.query(
          `DELETE FROM employee_login_locations
           WHERE employee_id = (SELECT id FROM employees WHERE employee_id = $1 LIMIT 1)`,
          [userId]
        );
      }
    } catch (err) {
      logger.warn('[ImpossibleTravel] clearUser DB failed', { error: err.message });
    }
  }
}

const impossibleTravel = new ImpossibleTravelDetector();

module.exports = { impossibleTravel, ImpossibleTravelDetector };
