-- Migration 010: Clear Identical Seeded Face Embeddings & Add Data Integrity Constraints
-- Purpose: 
--   1. Remove the identical sine-wave/bootstrap embeddings seeded for Admin and Supervisor
--      in migration 009 (both had the SAME vector, enabling cross-role identity collision).
--   2. Add a partial unique index to prevent multiple active embeddings per employee.
--   3. Reset face_enrolled flags for accounts with invalidated embeddings.
-- Date: 2026-06-14

BEGIN;

-- ============================================================================
-- 1. IDENTIFY AND DEACTIVATE THE KNOWN BOOTSTRAP EMBEDDING
-- The vector seeded in migration 009 is a 512-element sine-wave pattern.
-- Its first element is exactly 0.5 — a trivial fingerprint for detection.
-- We deactivate ALL embeddings that begin with this known-bad seed value.
-- ============================================================================
DO $$
DECLARE
  v_deactivated_count INT := 0;
  v_reset_count INT := 0;
BEGIN
  -- Deactivate embeddings whose first element matches the known bootstrap seed
  -- The seed vector starts with 0.5 (JSON begins with '[0.5,')
  UPDATE face_embeddings
  SET
    is_active   = FALSE,
    updated_at  = NOW()
  WHERE
    is_active = TRUE
    AND (
      -- Match the 009 migration sine-wave seed (starts with [0.5,)
      embedding_vector LIKE '[0.5,%'
      -- Match empty embeddings stored as '[]'
      OR embedding_vector = '[]'
      -- Match short vectors (valid ArcFace is always 512 elements)
      OR length(embedding_vector) < 100
    );

  GET DIAGNOSTICS v_deactivated_count = ROW_COUNT;
  RAISE NOTICE 'Deactivated % invalid/seeded face embeddings', v_deactivated_count;

  -- Reset face_enrolled flags for employees whose only embeddings were deactivated
  UPDATE employees e
  SET
    face_enrolled    = FALSE,
    face_enrolled_at = NULL,
    updated_at       = NOW()
  WHERE
    e.face_enrolled = TRUE
    AND NOT EXISTS (
      SELECT 1 FROM face_embeddings fe
      WHERE fe.employee_id = e.id AND fe.is_active = TRUE
    );

  GET DIAGNOSTICS v_reset_count = ROW_COUNT;
  RAISE NOTICE 'Reset face_enrolled=FALSE for % employees with no valid embeddings', v_reset_count;
END $$;

-- ============================================================================
-- 2. ADD UNIQUE CONSTRAINT: only ONE active embedding per employee
-- This prevents the scenario where both Admin and Supervisor share the same
-- active embedding, and also prevents duplicate active embeddings on re-enroll.
-- Using a partial unique index (WHERE is_active = TRUE).
-- ============================================================================
DROP INDEX IF EXISTS idx_face_embeddings_unique_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_face_embeddings_unique_active
ON face_embeddings (employee_id)
WHERE is_active = TRUE;

-- ============================================================================
-- 3. ADD EMBEDDING LENGTH VALIDATION CHECK CONSTRAINT
-- Prevents empty, short, or obviously invalid embeddings from being inserted.
-- A valid ArcFace embedding JSON string is always > 1000 characters.
-- ============================================================================
ALTER TABLE face_embeddings
  DROP CONSTRAINT IF EXISTS chk_embedding_not_empty;

ALTER TABLE face_embeddings
  ADD CONSTRAINT chk_embedding_not_empty
  CHECK (
    embedding_vector IS NOT NULL
    AND length(embedding_vector) > 100
    AND embedding_vector != '[]'
    AND embedding_vector NOT LIKE '[0.5,%'
  );

-- ============================================================================
-- 4. ADD COMMENT DOCUMENTING BOOTSTRAP VECTOR HISTORY
-- ============================================================================
COMMENT ON TABLE face_embeddings IS
  'Stores ArcFace 512-dimensional face embeddings. '
  'Migration 009 seeded a known-bad identical vector for admin and supervisor '
  '(deactivated by migration 010). All active embeddings must pass chk_embedding_not_empty.';

COMMIT;
