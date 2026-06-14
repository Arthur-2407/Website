-- Migration: Add data persistence for security features
-- Purpose: Migrate in-memory security tracking to database
-- Date: 2026-06-13

-- ============================================================================
-- 1. DEVICE TRUST TABLE
-- Migrate from: backend-api/src/modules/security/deviceTrust.js (in-memory Map)
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_trust (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(255) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    trust_score INTEGER DEFAULT 0 CHECK (trust_score >= 0 AND trust_score <= 100),
    is_known BOOLEAN DEFAULT FALSE,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, device_fingerprint),
    INDEX idx_device_trust_employee (employee_id),
    INDEX idx_device_trust_created (created_at)
);

COMMENT ON TABLE device_trust IS 'Tracks device trust scores for multi-factor authentication and anomaly detection';
COMMENT ON COLUMN device_trust.trust_score IS 'Trust score 0-100: HIGH (80-100), MEDIUM (40-79), LOW (0-39)';

-- ============================================================================
-- 2. IMPOSSIBLE TRAVEL ALERTS TABLE
-- Migrate from: backend-api/src/modules/security/impossibleTravel.js (in-memory Map)
-- ============================================================================

CREATE TABLE IF NOT EXISTS impossible_travel_alerts (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    from_location POINT,
    to_location POINT,
    from_timestamp TIMESTAMP NOT NULL,
    to_timestamp TIMESTAMP NOT NULL,
    distance_km FLOAT,
    required_speed_kmh FLOAT,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by INTEGER REFERENCES employees(id),
    acknowledged_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_impossible_travel_employee (employee_id),
    INDEX idx_impossible_travel_created (created_at),
    INDEX idx_impossible_travel_severity (severity)
);

COMMENT ON TABLE impossible_travel_alerts IS 'Tracks login attempts from geographically impossible locations';
COMMENT ON COLUMN impossible_travel_alerts.severity IS 'Alert severity: low, medium, high, critical';

-- ============================================================================
-- 3. LEAVE APPROVAL AUDIT TRAIL TABLE
-- Purpose: Track who approved/rejected leave and when
-- ============================================================================

CREATE TABLE IF NOT EXISTS leave_approval_history (
    id SERIAL PRIMARY KEY,
    leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
    approver_id INTEGER NOT NULL REFERENCES employees(id),
    action VARCHAR(20) NOT NULL CHECK (action IN ('approved', 'rejected', 'overridden', 'cancelled')),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_leave_approval_request (leave_request_id),
    INDEX idx_leave_approval_approver (approver_id),
    INDEX idx_leave_approval_created (created_at)
);

COMMENT ON TABLE leave_approval_history IS 'Audit trail for all leave request approval/rejection actions';

-- ============================================================================
-- 4. UPDATE leave_requests TABLE
-- Add approver tracking fields
-- ============================================================================

ALTER TABLE leave_requests
ADD COLUMN IF NOT EXISTS approver_id INTEGER REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS approval_timestamp TIMESTAMP,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS overridden_by INTEGER REFERENCES employees(id),
ADD COLUMN IF NOT EXISTS override_timestamp TIMESTAMP,
ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- ============================================================================
-- 5. UPDATE office_locations TABLE
-- Ensure work timing columns exist for configurable hours
-- ============================================================================

ALTER TABLE office_locations
ADD COLUMN IF NOT EXISTS work_start_time TIME DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS work_end_time TIME DEFAULT '18:00:00',
ADD COLUMN IF NOT EXISTS lunch_start_time TIME DEFAULT '12:00:00',
ADD COLUMN IF NOT EXISTS lunch_end_time TIME DEFAULT '13:00:00';

-- ============================================================================
-- 6. CREATE CLEANUP JOBS TABLE
-- Stores references to old data that should be cleaned up periodically
-- ============================================================================

CREATE TABLE IF NOT EXISTS data_cleanup_jobs (
    id SERIAL PRIMARY KEY,
    job_name VARCHAR(100) NOT NULL,
    last_run TIMESTAMP,
    next_run TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',
    rows_affected INTEGER,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cleanup_job_name (job_name),
    INDEX idx_cleanup_next_run (next_run)
);

COMMENT ON TABLE data_cleanup_jobs IS 'Tracks scheduled cleanup jobs for old security events and alerts';

-- ============================================================================
-- 7. CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

-- Device trust lookups
CREATE INDEX IF NOT EXISTS idx_device_trust_employee_fingerprint 
ON device_trust(employee_id, device_fingerprint);

-- Impossible travel lookups
CREATE INDEX IF NOT EXISTS idx_impossible_travel_employee_timestamp 
ON impossible_travel_alerts(employee_id, created_at DESC);

-- Leave approval history queries
CREATE INDEX IF NOT EXISTS idx_leave_approval_history_request_approver 
ON leave_approval_history(leave_request_id, approver_id);

-- ============================================================================
-- 8. MIGRATION NOTES
-- ============================================================================

/*
This migration adds database persistence for security features that were 
previously stored in-memory, causing data loss on server restart.

MIGRATION STEPS FOR DEPLOYMENT:
1. Run this migration against the production database
2. Restart all application servers to pick up new table references
3. Update deviceTrust.js to read/write to device_trust table
4. Update impossibleTravel.js to read/write to impossible_travel_alerts table
5. Monitor for any errors in the application logs
6. Set up cleanup jobs to remove old data (> 90 days)

TABLES AFFECTED:
- NEW: device_trust
- NEW: impossible_travel_alerts
- NEW: leave_approval_history
- NEW: data_cleanup_jobs
- MODIFIED: leave_requests (added approver tracking)
- MODIFIED: office_locations (added timing columns)

BREAKING CHANGES:
- Device trust history is reset (old in-memory data not migrated)
- Impossible travel alerts history is reset (old in-memory data not migrated)
- Leave approval audit trail begins fresh from this date
*/
