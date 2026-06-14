-- Seed default administrator access for initial setup and local recovery.
-- Default credentials:
--   employee_id: admin
--   password:    admin

INSERT INTO employees (
  employee_id,
  first_name,
  last_name,
  email,
  phone_number,
  department,
  position,
  role,
  hire_date,
  is_active,
  password_hash,
  password_changed_at,
  failed_login_count,
  locked_until,
  metadata,
  created_at,
  updated_at
) VALUES (
  'admin',
  'System',
  'Administrator',
  'admin@attendance-system.local',
  '+1-555-0100',
  'Administration',
  'System Administrator',
  'admin',
  CURRENT_DATE,
  TRUE,
  '$2a$10$OXc.LHem9gEyDNMKjyH7CepTNesYPmZ62HPF8ISZheTGkk2YqwPgm',
  CURRENT_TIMESTAMP,
  0,
  NULL,
  '{"default_admin": true, "all_feature_access": true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (employee_id) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  email = EXCLUDED.email,
  phone_number = EXCLUDED.phone_number,
  department = EXCLUDED.department,
  position = EXCLUDED.position,
  role = 'admin',
  is_active = TRUE,
  password_hash = EXCLUDED.password_hash,
  password_changed_at = CURRENT_TIMESTAMP,
  failed_login_count = 0,
  locked_until = NULL,
  metadata = COALESCE(employees.metadata, '{}'::jsonb)
    || '{"default_admin": true, "all_feature_access": true}'::jsonb,
  updated_at = CURRENT_TIMESTAMP;
