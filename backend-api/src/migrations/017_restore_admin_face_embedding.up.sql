-- =================================================================
-- MIGRATION 017: Restore Admin Face Embedding
-- =================================================================
-- PURPOSE:
--   Recovers the system from a state where the admin user has a stored 
--   face embedding but it is deactivated (is_active = FALSE), and 
--   face_enrolled is FALSE. This causes the system to boot into 
--   Bootstrap Setup page, blocking normal admin password+face logins.
--
-- BEHAVIOR:
--   1. Check if an admin user exists.
--   2. Check if the admin has no active face embeddings.
--   3. If so, find the most recently created face embedding for the admin 
--      and set is_active = TRUE.
--   4. Set employees.face_enrolled = TRUE for the admin.
-- =================================================================

DO $$
DECLARE
  v_admin_id INTEGER;
  v_active_count INTEGER;
  v_target_embedding_id INTEGER;
BEGIN
  -- Get the internal ID of the admin employee
  SELECT id INTO v_admin_id FROM employees WHERE employee_id = 'admin';
  
  IF v_admin_id IS NULL THEN
    RAISE NOTICE '[Migration 017] Admin user (employee_id = admin) not found. Skipping recovery.';
    RETURN;
  END IF;

  -- Count currently active face embeddings for admin
  SELECT COUNT(*) INTO v_active_count FROM face_embeddings 
  WHERE employee_id = v_admin_id AND is_active = TRUE;

  IF v_active_count > 0 THEN
    RAISE NOTICE '[Migration 017] Admin already has % active embedding(s). No action needed.', v_active_count;
    RETURN;
  END IF;

  -- Find the most recent embedding for the admin (active or inactive)
  SELECT id INTO v_target_embedding_id FROM face_embeddings 
  WHERE employee_id = v_admin_id
  ORDER BY created_at DESC 
  LIMIT 1;

  IF v_target_embedding_id IS NULL THEN
    RAISE NOTICE '[Migration 017] Admin has no face embeddings in database. Please register a face profile.';
    RETURN;
  END IF;

  -- Reactivate the embedding
  UPDATE face_embeddings 
  SET is_active = TRUE, updated_at = NOW() 
  WHERE id = v_target_embedding_id;
  
  RAISE NOTICE '[Migration 017] Reactivated face embedding id=% for admin (employee_id=1).', v_target_embedding_id;

  -- Sync employees table
  UPDATE employees 
  SET face_enrolled = TRUE, updated_at = NOW() 
  WHERE id = v_admin_id;
  
  RAISE NOTICE '[Migration 017] Synced employees.face_enrolled = TRUE for admin.';
END $$;
