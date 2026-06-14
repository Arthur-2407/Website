-- Migration 006: Missing Enterprise Tables + Soft-Delete for Immutable Records
-- Purpose: Create face_embeddings, face_enrollment_logs, device_fingerprints,
--          impossible_travel_events, leave_approval_history tables.
--          Add deleted_at soft-delete column to all immutable tables.
-- Safety: All CREATE TABLE uses IF NOT EXISTS. All ALTER TABLE uses IF NOT EXISTS.
--         Zero data loss guaranteed.

-- ============================================================================
-- FACE EMBEDDINGS TABLE
-- Stores facial embeddings for face authentication
-- ============================================================================
CREATE TABLE IF NOT EXISTS face_embeddings (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  embedding_vector TEXT NOT NULL,           -- JSON-encoded float array
  embedding_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  confidence_score FLOAT,
  model_name    VARCHAR(100) DEFAULT 'face-recognition-v1',
  enrolled_by   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  enrollment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_embeddings_employee ON face_embeddings(employee_id);
CREATE INDEX IF NOT EXISTS idx_face_embeddings_active ON face_embeddings(employee_id) WHERE is_active = TRUE;

-- ============================================================================
-- FACE ENROLLMENT LOGS TABLE
-- Immutable audit trail for all face registration/update/deletion events
-- ============================================================================
CREATE TABLE IF NOT EXISTS face_enrollment_logs (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  target_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  action          VARCHAR(30) NOT NULL CHECK (action IN (
    'ENROLL', 'UPDATE', 'DELETE', 'VERIFY_SUCCESS', 'VERIFY_FAIL',
    'ENROLLMENT_REJECTED', 'ENROLLMENT_APPROVED'
  )),
  performed_by_role VARCHAR(20),
  confidence_score FLOAT,
  embedding_version VARCHAR(20),
  ip_address      INET,
  device_info     TEXT,
  reason          TEXT,
  previous_embedding_id BIGINT,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_logs_employee ON face_enrollment_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_face_logs_target ON face_enrollment_logs(target_employee_id);
CREATE INDEX IF NOT EXISTS idx_face_logs_created ON face_enrollment_logs(created_at DESC);

-- ============================================================================
-- DEVICE FINGERPRINTS TABLE
-- Persistent device trust storage (replaces in-memory Map)
-- ============================================================================
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id              BIGSERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fingerprint     VARCHAR(64) NOT NULL,     -- SHA-256 hash of UA + accept-language
  ip_address      INET,
  user_agent      TEXT,
  trust_score     INTEGER NOT NULL DEFAULT 0 CHECK (trust_score BETWEEN 0 AND 100),
  trust_level     VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (trust_level IN ('high', 'medium', 'low')),
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  login_count     INTEGER NOT NULL DEFAULT 1,
  is_trusted      BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_device_fingerprints_employee ON device_fingerprints(employee_id);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_lookup ON device_fingerprints(employee_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_active ON device_fingerprints(employee_id) WHERE revoked_at IS NULL;

-- ============================================================================
-- IMPOSSIBLE TRAVEL EVENTS TABLE
-- Persistent location anomaly tracking (replaces in-memory Map)
-- ============================================================================
CREATE TABLE IF NOT EXISTS impossible_travel_events (
  id                  BIGSERIAL PRIMARY KEY,
  employee_id         INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  employee_id_str     VARCHAR(40),           -- Cached string for lookup
  from_lat            DOUBLE PRECISION NOT NULL,
  from_lng            DOUBLE PRECISION NOT NULL,
  to_lat              DOUBLE PRECISION NOT NULL,
  to_lng              DOUBLE PRECISION NOT NULL,
  distance_km         FLOAT NOT NULL,
  time_diff_minutes   FLOAT NOT NULL,
  required_speed_kmh  FLOAT NOT NULL,
  severity            VARCHAR(10) NOT NULL CHECK (severity IN ('high', 'critical')),
  ip_address          INET,
  device_info         TEXT,
  resolved            BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at         TIMESTAMPTZ,
  resolved_by         INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_impossible_travel_employee ON impossible_travel_events(employee_id);
CREATE INDEX IF NOT EXISTS idx_impossible_travel_created ON impossible_travel_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_impossible_travel_unresolved ON impossible_travel_events(employee_id) WHERE resolved = FALSE;

-- Store last login location for each employee (for future comparison)
CREATE TABLE IF NOT EXISTS employee_login_locations (
  employee_id     INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  last_lat        DOUBLE PRECISION NOT NULL,
  last_lng        DOUBLE PRECISION NOT NULL,
  last_login_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- LEAVE APPROVAL HISTORY TABLE
-- Complete immutable audit trail for all leave approval/rejection actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS leave_approval_history (
  id              BIGSERIAL PRIMARY KEY,
  leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE RESTRICT,
  action          VARCHAR(20) NOT NULL CHECK (action IN ('submit', 'approve', 'reject', 'cancel', 'override')),
  actor_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  actor_role      VARCHAR(20),
  previous_status VARCHAR(20),
  new_status      VARCHAR(20) NOT NULL,
  reason          TEXT,
  ip_address      INET,
  user_agent      TEXT,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_approval_history_request ON leave_approval_history(leave_request_id);
CREATE INDEX IF NOT EXISTS idx_leave_approval_history_actor ON leave_approval_history(actor_employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_approval_history_created ON leave_approval_history(created_at DESC);

-- ============================================================================
-- SOFT-DELETE COLUMNS FOR IMMUTABLE TABLES
-- Adds deleted_at to support audit-safe soft deletion
-- ============================================================================

-- attendance_records
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_attendance_not_deleted ON attendance_records(employee_id, check_in_time DESC) WHERE deleted_at IS NULL;

-- leave_requests
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_leave_not_deleted ON leave_requests(employee_id, status) WHERE deleted_at IS NULL;

-- security_events
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_security_events_not_deleted ON security_events(timestamp DESC) WHERE deleted_at IS NULL;

-- audit_logs
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_audit_logs_not_deleted ON audit_logs(created_at DESC) WHERE deleted_at IS NULL;

-- login_logs
ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_login_logs_not_deleted ON login_logs(timestamp DESC) WHERE deleted_at IS NULL;

-- work_reports
ALTER TABLE work_reports ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_work_reports_not_deleted ON work_reports(employee_id, report_date DESC) WHERE deleted_at IS NULL;

-- ============================================================================
-- SUPERVISOR ASSIGNMENTS ENHANCEMENT
-- Track assignment history (immutable)
-- ============================================================================
ALTER TABLE supervisor_assignments ADD COLUMN IF NOT EXISTS unassigned_at TIMESTAMPTZ;
ALTER TABLE supervisor_assignments ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE supervisor_assignments ADD COLUMN IF NOT EXISTS unassigned_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;

-- ============================================================================
-- OFFICE LOCATIONS ENHANCEMENT
-- Add address field and ensure address column exists
-- ============================================================================
ALTER TABLE office_locations ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE office_locations ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE office_locations ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;

-- ============================================================================
-- WORK TIMINGS ENHANCEMENT  
-- Add overtime configuration
-- ============================================================================
ALTER TABLE work_timings ADD COLUMN IF NOT EXISTS overtime_start_time TIME;
ALTER TABLE work_timings ADD COLUMN IF NOT EXISTS overtime_end_time TIME;
ALTER TABLE work_timings ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';
ALTER TABLE work_timings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE work_timings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ============================================================================
-- EMPLOYEES TABLE ENHANCEMENTS
-- Add missing tracking fields
-- ============================================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_enrolled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_enrolled_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_enrolled_by INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_must_change BOOLEAN NOT NULL DEFAULT FALSE;
