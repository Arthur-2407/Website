-- Migration 010 DOWN: Restore the original narrow security_events event_type CHECK constraint
-- WARNING: This will fail if any rows contain event types not in the original set.
-- Manually delete or update such rows before running this rollback.

BEGIN;

ALTER TABLE security_events
  DROP CONSTRAINT IF EXISTS security_events_event_type_check;

ALTER TABLE security_events
  ADD CONSTRAINT security_events_event_type_check
  CHECK (event_type IN (
    'SPOOF_ATTEMPT', 'FACE_MISMATCH', 'GEOFENCE_VIOLATION',
    'MULTIPLE_LOGIN_ATTEMPTS', 'FACE_REGISTERED',
    'FACE_REGISTRATION_ERROR', 'LOGIN_ERROR', 'SECURITY_ALERT'
  ));

COMMIT;
