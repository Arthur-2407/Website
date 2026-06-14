UPDATE employees
SET metadata = COALESCE(metadata, '{}'::jsonb) - 'default_admin' - 'all_feature_access',
    updated_at = CURRENT_TIMESTAMP
WHERE employee_id = 'admin'
  AND metadata->>'default_admin' = 'true';
