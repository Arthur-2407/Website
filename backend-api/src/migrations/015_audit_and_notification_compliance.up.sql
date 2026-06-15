-- Migration 015: Audit and Notification Compliance
-- Purpose: Add required columns to audit_logs and notifications tables,
--          and ensure synchronization with legacy columns via triggers.
-- Safety: Checked column presence, idempotent trigger creations.

BEGIN;

-- ============================================================================
-- 1. NOTIFICATIONS COMPLIANCE
-- ============================================================================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id INTEGER REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unread';

-- Initialize values
UPDATE notifications SET recipient_id = employee_id;
UPDATE notifications SET status = CASE WHEN is_read = TRUE THEN 'read' ELSE 'unread' END;

-- Trigger to sync notifications recipient_id and status
CREATE OR REPLACE FUNCTION sync_notifications_compliance()
RETURNS TRIGGER AS $$
BEGIN
  -- Sync recipient_id and employee_id
  IF NEW.recipient_id IS NOT NULL AND NEW.employee_id IS NULL THEN
    NEW.employee_id := NEW.recipient_id;
  ELSIF NEW.employee_id IS NOT NULL AND NEW.recipient_id IS NULL THEN
    NEW.recipient_id := NEW.employee_id;
  END IF;

  -- Sync status and is_read
  IF NEW.status = 'read' THEN
    NEW.is_read := TRUE;
  ELSIF NEW.status = 'unread' THEN
    NEW.is_read := FALSE;
  END IF;

  IF NEW.is_read = TRUE THEN
    NEW.status := 'read';
  ELSE
    NEW.status := 'unread';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_notifications_compliance
BEFORE INSERT OR UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION sync_notifications_compliance();


-- ============================================================================
-- 2. AUDIT_LOGS COMPLIANCE
-- ============================================================================
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_value TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_value TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS device_id TEXT;

-- Initialize values
UPDATE audit_logs SET user_id = actor_employee_id;
UPDATE audit_logs SET device_id = user_agent;

-- Trigger to sync audit_logs user_id and device_id
CREATE OR REPLACE FUNCTION sync_audit_logs_compliance()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.actor_employee_id IS NULL THEN
    NEW.actor_employee_id := NEW.user_id;
  ELSIF NEW.actor_employee_id IS NOT NULL AND NEW.user_id IS NULL THEN
    NEW.user_id := NEW.actor_employee_id;
  END IF;

  IF NEW.device_id IS NOT NULL AND NEW.user_agent IS NULL THEN
    NEW.user_agent := NEW.device_id;
  ELSIF NEW.user_agent IS NOT NULL AND NEW.device_id IS NULL THEN
    NEW.device_id := NEW.user_agent;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_audit_logs_compliance
BEFORE INSERT OR UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION sync_audit_logs_compliance();

COMMIT;
