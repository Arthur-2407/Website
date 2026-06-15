-- Migration 010: Expand security_events event_type CHECK constraint
-- The original constraint was missing many event types that the application logs,
-- causing PostgreSQL constraint violations in production.

BEGIN;

-- Step 1: Drop the old restrictive CHECK constraint
ALTER TABLE security_events
  DROP CONSTRAINT IF EXISTS security_events_event_type_check;

-- Step 2: Add comprehensive constraint covering all event types used in the codebase
ALTER TABLE security_events
  ADD CONSTRAINT security_events_event_type_check
  CHECK (event_type IN (
    -- Authentication events
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'LOGIN_ATTEMPT',
    'LOGIN_ERROR',
    -- Account state events
    'ACCOUNT_LOCKED',
    'ACCOUNT_UNLOCKED',
    'ACCOUNT_CREATED',
    'ACCOUNT_DEACTIVATED',
    -- Token events
    'TOKEN_REFRESH',
    'TOKEN_REVOKED',
    'SESSION_REVOKED',
    -- Face events
    'SPOOF_ATTEMPT',
    'FACE_MISMATCH',
    'FACE_REGISTERED',
    'FACE_REGISTRATION_ERROR',
    'FACE_ENROLLMENT_UPDATED',
    'FACE_ENROLLMENT_FAILED',
    -- Geofence events
    'GEOFENCE_VIOLATION',
    -- Travel & device events
    'IMPOSSIBLE_TRAVEL',
    'SUSPICIOUS_DEVICE',
    'DEVICE_REGISTERED',
    -- Rate limiting events
    'MULTIPLE_LOGIN_ATTEMPTS',
    'RATE_LIMIT_EXCEEDED',
    -- System events
    'LOGIN_ERROR',
    'SECURITY_ALERT',
    'PIPELINE_ERROR',
    'SYSTEM_ERROR',
    -- Admin events
    'ADMIN_ACTION',
    'PERMISSION_DENIED',
    'PRIVILEGE_ESCALATION_ATTEMPT',
    -- Recovery events
    'ACCOUNT_RECOVERY_REQUESTED',
    'ACCOUNT_RECOVERY_APPROVED',
    'ACCOUNT_RECOVERY_REJECTED'
  ));

-- Step 3: Ensure the event_type column has an index for fast querying
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);

COMMIT;
