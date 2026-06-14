-- Migration 008: Align leave_requests columns with API
-- Purpose: Add approver_id and approval_timestamp columns used by leave routes

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS approver_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_timestamp TIMESTAMPTZ;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_leave_requests_approver ON leave_requests(approver_id);
