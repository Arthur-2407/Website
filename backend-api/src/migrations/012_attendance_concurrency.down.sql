-- Migration 012 DOWN: Remove attendance concurrency controls

BEGIN;

DROP INDEX IF EXISTS uix_attendance_one_open_per_employee_per_day;
DROP INDEX IF EXISTS idx_attendance_employee_date;
DROP INDEX IF EXISTS uix_attendance_idempotency;

ALTER TABLE attendance_records
  DROP COLUMN IF EXISTS idempotency_key;

COMMIT;
