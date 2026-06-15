-- Migration 011: Account Recovery System
-- Implements the account_recovery_requests table for audited credential recovery workflows.
-- Recovery requests require admin approval and are fully immutable-audited.

BEGIN;

-- ============================================================
-- ACCOUNT RECOVERY REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS account_recovery_requests (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  request_type    VARCHAR(30) NOT NULL CHECK (request_type IN (
                    'password_reset',
                    'face_reset',
                    'full_credential_reset'
                  )),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'expired')),
  -- Who requested it (may differ from employee if admin requests on behalf)
  requested_by    INTEGER REFERENCES employees(id),
  request_reason  TEXT,
  -- Approval workflow
  reviewed_by     INTEGER REFERENCES employees(id),
  reviewed_at     TIMESTAMP,
  review_notes    TEXT,
  -- Completion tracking
  completed_at    TIMESTAMP,
  completed_by    INTEGER REFERENCES employees(id),
  -- Expiry (pending requests auto-expire after 48h)
  expires_at      TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  -- Secure one-time token for recovery link (bcrypt-hashed)
  recovery_token_hash VARCHAR(255),
  recovery_token_used_at TIMESTAMP,
  -- Audit metadata
  ip_address      INET,
  device_info     TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_recovery_employee     ON account_recovery_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_recovery_status       ON account_recovery_requests(status);
CREATE INDEX IF NOT EXISTS idx_recovery_requested_by ON account_recovery_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_recovery_reviewed_by  ON account_recovery_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_recovery_expires      ON account_recovery_requests(expires_at);

-- Auto-update updated_at on every change
CREATE TRIGGER update_account_recovery_updated_at
  BEFORE UPDATE ON account_recovery_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- RECOVERY AUDIT LOG (immutable — INSERT-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS account_recovery_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  recovery_id     INTEGER NOT NULL REFERENCES account_recovery_requests(id) ON DELETE RESTRICT,
  actor_id        INTEGER REFERENCES employees(id),
  action          VARCHAR(50) NOT NULL,   -- e.g. REQUESTED, APPROVED, REJECTED, COMPLETED, EXPIRED
  details         JSONB,
  ip_address      INET,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_audit_recovery ON account_recovery_audit_log(recovery_id);
CREATE INDEX IF NOT EXISTS idx_recovery_audit_actor    ON account_recovery_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_recovery_audit_action   ON account_recovery_audit_log(action);

COMMIT;
