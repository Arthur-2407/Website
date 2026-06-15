BEGIN;

-- Restore sync_audit_logs_compliance to original migration 015 version
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

-- Restore sync_notifications_compliance to original migration 015 version
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

-- Remove the migration entry
DELETE FROM schema_migrations WHERE id = '018_fix_compliance_triggers_for_cascades';

COMMIT;
