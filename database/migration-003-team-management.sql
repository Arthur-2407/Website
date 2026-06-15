-- Migration: Team Management and Additional Enhancements
-- Date: 2026-06-15
-- Purpose: Add team configuration table and team membership tracking

-- ============================================================================
-- 1. TEAM_CONFIG TABLE - Team definitions and configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_config (
    id SERIAL PRIMARY KEY,
    team_name VARCHAR(100) NOT NULL,
    team_lead_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    department VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_team_config_department ON team_config(department);
CREATE INDEX IF NOT EXISTS idx_team_config_team_lead ON team_config(team_lead_id);
CREATE INDEX IF NOT EXISTS idx_team_config_active ON team_config(is_active);

-- ============================================================================
-- 2. TEAM_MEMBERS TABLE - Track which employees belong to which teams
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_members (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES team_config(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member', -- 'lead', 'senior', 'member'
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(team_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_employee ON team_members(employee_id);
CREATE INDEX IF NOT EXISTS idx_team_members_active ON team_members(is_active);

-- ============================================================================
-- 3. ROLE_ASSIGNMENTS TABLE - Explicit role assignment tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS role_assignments (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('employee', 'supervisor', 'admin')),
    assigned_by INTEGER REFERENCES employees(id),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(employee_id, role)
);

CREATE INDEX IF NOT EXISTS idx_role_assignments_employee ON role_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_role ON role_assignments(role);
CREATE INDEX IF NOT EXISTS idx_role_assignments_active ON role_assignments(is_active);

-- ============================================================================
-- 4. ENSURE REQUIRED COLUMNS EXISTS IN EMPLOYEES TABLE
-- ============================================================================
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mfa_pending_secret VARCHAR(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mfa_backup_codes TEXT[];
ALTER TABLE employees ADD COLUMN IF NOT EXISTS face_enrolled BOOLEAN DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES employees(id);

-- ============================================================================
-- 5. CREATE UPDATED_AT TRIGGER FOR TEAM_CONFIG
-- ============================================================================
CREATE TRIGGER update_team_config_updated_at BEFORE UPDATE ON team_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 6. CREATE UPDATED_AT TRIGGERS FOR TEAM_MEMBERS
-- ============================================================================
CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON team_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Ensure function exists for team_members (it might need a custom trigger)
CREATE OR REPLACE FUNCTION update_team_members_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.joined_at = COALESCE(NEW.joined_at, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- The following tables and indexes have been created or verified:
-- - team_config: Team configuration and metadata
-- - team_members: Team membership tracking
-- - role_assignments: Explicit role assignment history
-- - Enhanced employees table with missing columns
