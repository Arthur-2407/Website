-- Migration 016: Fix trigger recursion between admin_configuration and administrators
-- Purpose: Break infinite recursion loop during updates by checking pg_trigger_depth()

BEGIN;

CREATE OR REPLACE FUNCTION sync_administrators_to_legacy()
RETURNS TRIGGER AS $$
DECLARE
  v_emp_id INT;
BEGIN
  -- Break infinite trigger recursion loop
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

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

CREATE OR REPLACE FUNCTION sync_admin_config_to_administrators()
RETURNS TRIGGER AS $$
DECLARE
  v_admin_id VARCHAR(50);
  v_password_hash VARCHAR(255);
BEGIN
  -- Break infinite trigger recursion loop
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

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

COMMIT;
