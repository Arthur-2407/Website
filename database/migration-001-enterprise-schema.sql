-- Migration: Enterprise Schema Enhancements
-- Date: 2026-06-13
-- Purpose: Add missing tables for complete role hierarchy, leave policies, work timings, and audit logging

-- ============================================================================
-- 1. WORK_TIMINGS TABLE - Configure work hours per employee/department
-- ============================================================================
CREATE TABLE IF NOT EXISTS work_timings (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    department VARCHAR(100),
    work_start_time TIME NOT NULL DEFAULT '09:00:00',
    work_end_time TIME NOT NULL DEFAULT '18:00:00',
    lunch_start_time TIME DEFAULT '12:00:00',
    lunch_end_time TIME DEFAULT '13:00:00',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_work_timings_employee ON work_timings(employee_id);
CREATE INDEX IF NOT EXISTS idx_work_timings_department ON work_timings(department);

-- ============================================================================
-- 2. LEAVE_POLICY TABLE - Define company leave policies
-- ============================================================================
CREATE TABLE IF NOT EXISTS leave_policy (
    id SERIAL PRIMARY KEY,
    leave_type VARCHAR(50) NOT NULL UNIQUE CHECK (leave_type IN ('vacation', 'sick', 'personal', 'maternity', 'paternity')),
    annual_days_allowed INTEGER NOT NULL DEFAULT 20,
    carry_over_days INTEGER DEFAULT 5,
    requires_approval BOOLEAN DEFAULT TRUE,
    approval_required_after_days INTEGER DEFAULT 2,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leave_policy_type ON leave_policy(leave_type);

-- Insert default leave policies
INSERT INTO leave_policy (leave_type, annual_days_allowed, carry_over_days, description)
VALUES 
  ('vacation', 20, 5, 'Annual paid vacation days'),
  ('sick', 10, 0, 'Sick leave - no carryover'),
  ('personal', 3, 0, 'Personal leave days'),
  ('maternity', 90, 0, 'Maternity leave - 90 days'),
  ('paternity', 10, 0, 'Paternity leave - 10 days')
ON CONFLICT (leave_type) DO NOTHING;

-- ============================================================================
-- 3. LEAVE_BALANCE TABLE - Track employee leave balances
-- ============================================================================
CREATE TABLE IF NOT EXISTS leave_balance (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type VARCHAR(50) NOT NULL,
    year INTEGER NOT NULL,
    total_days INTEGER NOT NULL DEFAULT 0,
    used_days INTEGER NOT NULL DEFAULT 0,
    carried_over_days INTEGER NOT NULL DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, leave_type, year),
    FOREIGN KEY (leave_type) REFERENCES leave_policy(leave_type)
);

CREATE INDEX IF NOT EXISTS idx_leave_balance_employee ON leave_balance(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_balance_year ON leave_balance(year);

-- ============================================================================
-- 4. SUPERVISOR_ASSIGNMENTS TABLE - Explicit employee-to-supervisor mapping
-- ============================================================================
CREATE TABLE IF NOT EXISTS supervisor_assignments (
    id SERIAL PRIMARY KEY,
    supervisor_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    department VARCHAR(100),
    assigned_by INTEGER REFERENCES employees(id),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(supervisor_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_assignments_supervisor ON supervisor_assignments(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_assignments_employee ON supervisor_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_supervisor_assignments_active ON supervisor_assignments(is_active);

-- ============================================================================
-- 5. AUDIT_LOGS TABLE - Comprehensive audit trail (already exists, but ensure)
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    actor_employee_id INTEGER REFERENCES employees(id),
    action VARCHAR(255) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    request_id VARCHAR(255),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);

-- ============================================================================
-- 6. DEPARTMENT_CONFIG TABLE - Department-level settings
-- ============================================================================
CREATE TABLE IF NOT EXISTS department_config (
    id SERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL UNIQUE,
    department_head_id INTEGER REFERENCES employees(id),
    default_work_start_time TIME DEFAULT '09:00:00',
    default_work_end_time TIME DEFAULT '18:00:00',
    default_lunch_start TIME DEFAULT '12:00:00',
    default_lunch_end TIME DEFAULT '13:00:00',
    max_employees INTEGER,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_department_config_name ON department_config(department_name);
CREATE INDEX IF NOT EXISTS idx_department_config_head ON department_config(department_head_id);

-- ============================================================================
-- 7. REFRESH_TOKENS TABLE - If it doesn't exist
-- ============================================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    token_family UUID,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    replaced_by UUID REFERENCES refresh_tokens(id),
    ip_address INET,
    device_info TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_employee ON refresh_tokens(employee_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(token_family);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ============================================================================
-- 8. NOTIFICATIONS TABLE - If it doesn't exist
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- ============================================================================
-- 9. OFFICE_TIMINGS_CONFIG - Enhanced location management with timings
-- ============================================================================
ALTER TABLE office_locations ADD COLUMN IF NOT EXISTS work_start_time TIME DEFAULT '09:00:00';
ALTER TABLE office_locations ADD COLUMN IF NOT EXISTS work_end_time TIME DEFAULT '18:00:00';
ALTER TABLE office_locations ADD COLUMN IF NOT EXISTS lunch_start_time TIME DEFAULT '12:00:00';
ALTER TABLE office_locations ADD COLUMN IF NOT EXISTS lunch_end_time TIME DEFAULT '13:00:00';

-- ============================================================================
-- 10. ENHANCE LEAVE_REQUESTS TABLE
-- ============================================================================
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES employees(id);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_date TIMESTAMP;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approval_notes TEXT;

-- ============================================================================
-- 11. ENHANCE WORK_REPORTS TABLE
-- ============================================================================
ALTER TABLE work_reports ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES employees(id);
ALTER TABLE work_reports ADD COLUMN IF NOT EXISTS approval_date TIMESTAMP;

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_work_timings_updated_at BEFORE UPDATE ON work_timings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leave_policy_updated_at BEFORE UPDATE ON leave_policy
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_department_config_updated_at BEFORE UPDATE ON department_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_office_locations_updated_at BEFORE UPDATE ON office_locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- STORED PROCEDURES FOR BUSINESS LOGIC
-- ============================================================================

-- Calculate leave balance for an employee
CREATE OR REPLACE FUNCTION get_leave_balance(
    p_employee_id INTEGER,
    p_leave_type VARCHAR,
    p_year INTEGER DEFAULT NULL
)
RETURNS TABLE (
    leave_type VARCHAR,
    total_days INTEGER,
    used_days INTEGER,
    carried_over INTEGER,
    available_days INTEGER
) AS $$
DECLARE
    v_year INTEGER;
    v_balance RECORD;
BEGIN
    v_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER);
    
    SELECT lb.* INTO v_balance
    FROM leave_balance lb
    WHERE lb.employee_id = p_employee_id
      AND lb.leave_type = p_leave_type
      AND lb.year = v_year;
    
    IF v_balance.id IS NULL THEN
        RETURN QUERY SELECT p_leave_type::VARCHAR, 0::INTEGER, 0::INTEGER, 0::INTEGER, 0::INTEGER;
    ELSE
        RETURN QUERY SELECT 
            v_balance.leave_type,
            v_balance.total_days,
            v_balance.used_days,
            v_balance.carried_over_days,
            (v_balance.total_days + v_balance.carried_over_days - v_balance.used_days)::INTEGER as available_days;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Get all employees supervised by a supervisor
CREATE OR REPLACE FUNCTION get_supervised_employees(p_supervisor_id INTEGER)
RETURNS TABLE (
    employee_id INTEGER,
    employee_id_str VARCHAR,
    first_name VARCHAR,
    last_name VARCHAR,
    email VARCHAR,
    department VARCHAR,
    position VARCHAR,
    role VARCHAR,
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id,
        e.employee_id,
        e.first_name,
        e.last_name,
        e.email,
        e.department,
        e.position,
        e.role,
        e.is_active
    FROM employees e
    LEFT JOIN supervisor_assignments sa ON e.id = sa.employee_id
    WHERE (sa.supervisor_id = p_supervisor_id AND sa.is_active = TRUE)
       OR e.supervisor_id = p_supervisor_id
    ORDER BY e.first_name, e.last_name;
END;
$$ LANGUAGE plpgsql;

-- Migration complete
COMMIT;
