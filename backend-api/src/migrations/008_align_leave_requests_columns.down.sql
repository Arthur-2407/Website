-- Rollback Migration 008: Remove approver_id and approval_timestamp from leave_requests

DROP INDEX IF EXISTS idx_leave_requests_approver;

ALTER TABLE leave_requests
  DROP COLUMN IF EXISTS approver_id,
  DROP COLUMN IF EXISTS approval_timestamp;
