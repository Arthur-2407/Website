-- Migration 007 Down: Revert default admin password hash to default seed hash
UPDATE employees
SET password_hash = '$2a$10$OXc.LHem9gEyDNMKjyH7CepTNesYPmZ62HPF8ISZheTGkk2YqwPgm',
    updated_at = NOW()
WHERE employee_id = 'admin';
