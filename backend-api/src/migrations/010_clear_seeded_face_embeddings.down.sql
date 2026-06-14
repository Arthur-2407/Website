-- Migration 010 DOWN: Restore seeded face embeddings and remove constraints
-- WARNING: This will re-activate the known-invalid seeded embeddings.
-- Only use this for rollback testing, not in production.

BEGIN;

DROP INDEX IF EXISTS idx_face_embeddings_unique_active;
ALTER TABLE face_embeddings DROP CONSTRAINT IF EXISTS chk_embedding_not_empty;

COMMIT;
