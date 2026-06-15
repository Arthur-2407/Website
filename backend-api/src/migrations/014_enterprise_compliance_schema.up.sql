-- Migration 014: Enterprise Compliance Schema Mapping
-- Purpose: Add administrators, employee_relationships, face_update_requests,
--          and password_reset_requests tables per schema spec, and keep them
--          synced with existing tables via triggers.
-- Safety: Checked table presence, idempotent trigger creations. Uses text for face embeddings.

BEGIN;

-- ============================================================================
-- 1. EMPLOYEE_RELATIONSHIPS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS employee_relationships (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  supervisor_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, supervisor_id)
);

-- Seed employee_relationships from existing supervisor associations
INSERT INTO employee_relationships (employee_id, supervisor_id)
SELECT id, supervisor_id FROM employees
WHERE supervisor_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Triggers for bidirectional sync of supervisor_id
CREATE OR REPLACE FUNCTION sync_employee_relationship()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE employees
  SET supervisor_id = NEW.supervisor_id
  WHERE id = NEW.employee_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_employee_relationship
AFTER INSERT OR UPDATE ON employee_relationships
FOR EACH ROW EXECUTE FUNCTION sync_employee_relationship();

CREATE OR REPLACE FUNCTION sync_employees_to_relationship()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.supervisor_id IS NOT NULL THEN
    INSERT INTO employee_relationships (employee_id, supervisor_id)
    VALUES (NEW.id, NEW.supervisor_id)
    ON CONFLICT (employee_id) DO UPDATE
    SET supervisor_id = EXCLUDED.supervisor_id;
  ELSE
    DELETE FROM employee_relationships WHERE employee_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_employees_to_relationship
AFTER INSERT OR UPDATE OF supervisor_id ON employees
FOR EACH ROW EXECUTE FUNCTION sync_employees_to_relationship();


-- ============================================================================
-- 2. ADMINISTRATORS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS administrators (
  id BIGSERIAL PRIMARY KEY,
  admin_id VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(100),
  email VARCHAR(200),
  phone VARCHAR(50),
  address TEXT,
  designation VARCHAR(100),
  face_image_path TEXT,
  face_embedding TEXT, -- Text representation of the 512-dim embedding vector
  password_hash VARCHAR(255),
  recovery_email VARCHAR(200),
  recovery_phone VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed administrators from current config
INSERT INTO administrators (admin_id, name, email, phone, address, designation, password_hash, recovery_email, recovery_phone, created_at, updated_at)
SELECT 
  e.employee_id, 
  ac.admin_name, 
  ac.admin_email, 
  ac.admin_phone, 
  ac.admin_address, 
  ac.admin_designation, 
  e.password_hash, 
  ac.recovery_email, 
  ac.recovery_phone,
  ac.created_at,
  ac.updated_at
FROM admin_configuration ac
JOIN employees e ON ac.admin_employee_id = e.id
ON CONFLICT (admin_id) DO NOTHING;

-- Triggers for bidirectional sync of administrators
CREATE OR REPLACE FUNCTION sync_administrators_to_legacy()
RETURNS TRIGGER AS $$
DECLARE
  v_emp_id INT;
BEGIN
  SELECT id INTO v_emp_id FROM employees WHERE employee_id = NEW.admin_id;
  
  IF v_emp_id IS NULL THEN
    INSERT INTO employees (employee_id, first_name, last_name, email, password_hash, role, is_active)
    VALUES (NEW.admin_id, split_part(NEW.name, ' ', 1), COALESCE(split_part(NEW.name, ' ', 2), 'Admin'), NEW.email, NEW.password_hash, 'admin', TRUE)
    RETURNING id INTO v_emp_id;
  ELSE
    UPDATE employees
    SET password_hash = NEW.password_hash,
        email = NEW.email,
        first_name = split_part(NEW.name, ' ', 1),
        last_name = COALESCE(split_part(NEW.name, ' ', 2), 'Admin')
    WHERE id = v_emp_id;
  END IF;

  INSERT INTO admin_configuration (admin_employee_id, admin_name, admin_email, admin_phone, admin_address, admin_designation, recovery_email, recovery_phone, created_at, updated_at)
  VALUES (v_emp_id, NEW.name, NEW.email, NEW.phone, NEW.address, NEW.designation, NEW.recovery_email, NEW.recovery_phone, NEW.created_at, NEW.updated_at)
  ON CONFLICT (admin_employee_id) DO UPDATE
  SET admin_name = EXCLUDED.admin_name,
      admin_email = EXCLUDED.admin_email,
      admin_phone = EXCLUDED.admin_phone,
      admin_address = EXCLUDED.admin_address,
      admin_designation = EXCLUDED.admin_designation,
      recovery_email = EXCLUDED.recovery_email,
      recovery_phone = EXCLUDED.recovery_phone,
      updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_administrators_to_legacy
AFTER INSERT OR UPDATE ON administrators
FOR EACH ROW EXECUTE FUNCTION sync_administrators_to_legacy();

CREATE OR REPLACE FUNCTION sync_admin_config_to_administrators()
RETURNS TRIGGER AS $$
DECLARE
  v_admin_id VARCHAR(50);
  v_password_hash VARCHAR(255);
BEGIN
  SELECT employee_id, password_hash INTO v_admin_id, v_password_hash
  FROM employees WHERE id = NEW.admin_employee_id;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO administrators (admin_id, name, email, phone, address, designation, password_hash, recovery_email, recovery_phone, created_at, updated_at)
    VALUES (v_admin_id, NEW.admin_name, NEW.admin_email, NEW.admin_phone, NEW.admin_address, NEW.admin_designation, v_password_hash, NEW.recovery_email, NEW.recovery_phone, NEW.created_at, NEW.updated_at)
    ON CONFLICT (admin_id) DO UPDATE
    SET name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        designation = EXCLUDED.designation,
        recovery_email = EXCLUDED.recovery_email,
        recovery_phone = EXCLUDED.recovery_phone,
        updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_admin_config_to_administrators
AFTER INSERT OR UPDATE ON admin_configuration
FOR EACH ROW EXECUTE FUNCTION sync_admin_config_to_administrators();


-- ============================================================================
-- 3. FACE_UPDATE_REQUESTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS face_update_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  approver_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  request_type VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

-- Seed face_update_requests
INSERT INTO face_update_requests (id, requester_id, approver_id, status, request_type, created_at, approved_at)
SELECT 
  fcr.id, 
  fcr.employee_id, 
  (SELECT actioned_by FROM face_approval_history WHERE request_id = fcr.id AND action = 'APPROVE' LIMIT 1), 
  LOWER(fcr.status), 
  fcr.request_type, 
  fcr.created_at,
  (SELECT actioned_at FROM face_approval_history WHERE request_id = fcr.id AND action = 'APPROVE' LIMIT 1)
FROM face_change_requests fcr
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- 4. PASSWORD_RESET_REQUESTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id BIGSERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  approver_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

-- Seed password_reset_requests
INSERT INTO password_reset_requests (id, requester_id, approver_id, status, created_at, approved_at)
SELECT 
  arr.id, 
  arr.employee_id, 
  arr.reviewed_by, 
  LOWER(arr.status), 
  arr.created_at, 
  arr.reviewed_at
FROM account_recovery_requests arr
WHERE arr.request_type = 'password_reset'
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- 5. LEAVE_REQUESTS ALIGNMENT
-- ============================================================================
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
UPDATE leave_requests SET approved_at = approval_timestamp WHERE approval_timestamp IS NOT NULL;

-- Trigger to sync approved_at and approval_timestamp in leave_requests
CREATE OR REPLACE FUNCTION sync_leave_approved_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.approval_timestamp IS NOT NULL AND NEW.approved_at IS NULL THEN
    NEW.approved_at := NEW.approval_timestamp;
  ELSIF NEW.approved_at IS NOT NULL AND NEW.approval_timestamp IS NULL THEN
    NEW.approval_timestamp := NEW.approved_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sync_leave_approved_at
BEFORE INSERT OR UPDATE ON leave_requests
FOR EACH ROW EXECUTE FUNCTION sync_leave_approved_at();

COMMIT;
