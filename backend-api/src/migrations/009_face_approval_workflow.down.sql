-- Migration 009: Face Approval Workflow and Seeding - Down
-- Purpose: Revert changes added in up migration
-- Date: 2026-06-14

-- Delete seeded face embeddings
DELETE FROM face_embeddings WHERE employee_id IN (
  SELECT id FROM employees WHERE employee_id IN ('admin', 'supervisor')
);

-- Reset employees face enrolled fields
UPDATE employees SET
  face_enrolled = FALSE,
  face_enrolled_at = NULL,
  face_enrolled_by = NULL
WHERE employee_id IN ('admin', 'supervisor');

-- Delete seeded supervisor account
DELETE FROM employees WHERE employee_id = 'supervisor';

-- Drop tables
DROP TABLE IF EXISTS face_audit_logs CASCADE;
DROP TABLE IF EXISTS face_approval_history CASCADE;
DROP TABLE IF EXISTS face_approval_requests CASCADE;
DROP TABLE IF EXISTS face_change_requests CASCADE;
