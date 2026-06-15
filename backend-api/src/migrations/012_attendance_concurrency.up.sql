-- Migration 012: Attendance Concurrency Protection
-- Prevents double check-in race conditions using a partial unique index.
-- The index ensures only ONE open attendance record (NULL check_out_time) exists per employee per day.

BEGIN;

-- Partial unique index: only one open check-in per employee per day
-- If check_out_time IS NULL, the record is "open" (currently checked in)
-- This prevents concurrent duplicate check-ins even with parallel requests
CREATE UNIQUE INDEX IF NOT EXISTS uix_attendance_one_open_per_employee_per_day
  ON attendance_records (employee_id, (check_in_time::date))
  WHERE check_out_time IS NULL;

-- Additional index for faster today-state queries
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date
  ON attendance_records (employee_id, check_in_time);

-- Add idempotency_key column for client-side deduplication
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS uix_attendance_idempotency
  ON attendance_records (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMIT;
