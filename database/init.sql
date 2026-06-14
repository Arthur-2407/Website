-- Enterprise Attendance System Database Schema
-- PostgreSQL with pgvector extension

-- Enable pgvector extension
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Employees table
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(20) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone_number VARCHAR(20),
    department VARCHAR(100) NOT NULL,
    position VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'supervisor', 'admin')),
    supervisor_id INTEGER REFERENCES employees(id),
    hire_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    face_embedding TEXT,
    password_hash VARCHAR(255),
    password_changed_at TIMESTAMP,
    failed_login_count INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for employee_id lookup
CREATE INDEX idx_employees_employee_id ON employees(employee_id);
CREATE INDEX idx_employees_department ON employees(department);
CREATE INDEX idx_employees_supervisor ON employees(supervisor_id);

-- Attendance records table
CREATE TABLE attendance_records (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    check_in_time TIMESTAMP NOT NULL,
    check_out_time TIMESTAMP,
    work_hours INTERVAL,
    location POINT, -- Stores latitude/longitude as (x,y)
    geo_fence_status BOOLEAN DEFAULT FALSE,
    distance_from_office FLOAT,
    check_in_image_url TEXT,
    check_out_image_url TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for attendance queries
CREATE INDEX idx_attendance_employee ON attendance_records(employee_id);
CREATE INDEX idx_attendance_date ON attendance_records(check_in_time);
CREATE INDEX idx_attendance_geo_fence ON attendance_records(geo_fence_status);

-- Leave requests table
CREATE TABLE leave_requests (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    supervisor_id INTEGER REFERENCES employees(id),
    leave_type VARCHAR(50) NOT NULL CHECK (leave_type IN ('vacation', 'sick', 'personal', 'maternity', 'paternity')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approval_date TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for leave management
CREATE INDEX idx_leave_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_supervisor ON leave_requests(supervisor_id);
CREATE INDEX idx_leave_status ON leave_requests(status);
CREATE INDEX idx_leave_dates ON leave_requests(start_date, end_date);

-- Work reports table
CREATE TABLE work_reports (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    supervisor_id INTEGER REFERENCES employees(id),
    report_date DATE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    image_urls TEXT[], -- Array of image URLs
    status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'reviewed', 'approved')),
    feedback TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for work reports
CREATE INDEX idx_work_reports_employee ON work_reports(employee_id);
CREATE INDEX idx_work_reports_supervisor ON work_reports(supervisor_id);
CREATE INDEX idx_work_reports_date ON work_reports(report_date);

-- Login logs table with anti-spoof tracking
CREATE TABLE login_logs (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    success BOOLEAN NOT NULL,
    spoof_detected BOOLEAN DEFAULT FALSE,
    spoof_confidence FLOAT,
    challenge_passed BOOLEAN,
    face_embedding TEXT,
    ip_address INET,
    device_info TEXT,
    location JSONB, -- Stores geolocation data
    error_details TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for security monitoring
CREATE INDEX idx_login_logs_employee ON login_logs(employee_id);
CREATE INDEX idx_login_logs_timestamp ON login_logs(timestamp);
CREATE INDEX idx_login_logs_spoof ON login_logs(spoof_detected);
CREATE INDEX idx_login_logs_success ON login_logs(success);

-- Security events table
CREATE TABLE security_events (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
        'SPOOF_ATTEMPT', 'FACE_MISMATCH', 'GEOFENCE_VIOLATION', 
        'MULTIPLE_LOGIN_ATTEMPTS', 'FACE_REGISTERED',
        'FACE_REGISTRATION_ERROR', 'LOGIN_ERROR', 'SECURITY_ALERT'
    )),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    device_info TEXT,
    details TEXT,
    severity VARCHAR(10) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical'))
);

-- Indexes for security events
CREATE INDEX idx_security_events_employee ON security_events(employee_id);
CREATE INDEX idx_security_events_type ON security_events(event_type);
CREATE INDEX idx_security_events_timestamp ON security_events(timestamp);
CREATE INDEX idx_security_events_severity ON security_events(severity);

-- System logs table
CREATE TABLE system_logs (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(50) NOT NULL,
    log_level VARCHAR(10) NOT NULL CHECK (log_level IN ('debug', 'info', 'warn', 'error', 'fatal')),
    message TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB
);

-- Indexes for system monitoring
CREATE INDEX idx_system_logs_service ON system_logs(service_name);
CREATE INDEX idx_system_logs_level ON system_logs(log_level);
CREATE INDEX idx_system_logs_timestamp ON system_logs(timestamp);

-- Office location configuration
CREATE TABLE office_locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default office location
INSERT INTO office_locations (name, latitude, longitude, radius_meters) VALUES
('Main Office', 40.7128, -74.0060, 100);

-- Backup configuration
CREATE TABLE backup_configurations (
    id SERIAL PRIMARY KEY,
    schedule_type VARCHAR(20) NOT NULL DEFAULT 'daily' CHECK (schedule_type IN ('daily', 'weekly', 'monthly')),
    retention_days INTEGER NOT NULL DEFAULT 30,
    last_backup_time TIMESTAMP,
    last_backup_status VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default backup configuration
INSERT INTO backup_configurations (schedule_type, retention_days) VALUES
('daily', 30);

-- Create functions for automatic timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_employees_updated_at 
    BEFORE UPDATE ON employees 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_attendance_updated_at 
    BEFORE UPDATE ON attendance_records 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leave_updated_at 
    BEFORE UPDATE ON leave_requests 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_work_reports_updated_at 
    BEFORE UPDATE ON work_reports 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_office_locations_updated_at 
    BEFORE UPDATE ON office_locations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_backup_configurations_updated_at 
    BEFORE UPDATE ON backup_configurations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate distance using Haversine formula
CREATE OR REPLACE FUNCTION calculate_distance(
    lat1 DOUBLE PRECISION, 
    lon1 DOUBLE PRECISION, 
    lat2 DOUBLE PRECISION, 
    lon2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
DECLARE
    earth_radius DOUBLE PRECISION := 6371000; -- meters
    dlat DOUBLE PRECISION;
    dlon DOUBLE PRECISION;
    a DOUBLE PRECISION;
    c DOUBLE PRECISION;
BEGIN
    dlat = radians(lat2 - lat1);
    dlon = radians(lon2 - lon1);
    
    a = sin(dlat/2) * sin(dlat/2) +
        cos(radians(lat1)) * cos(radians(lat2)) *
        sin(dlon/2) * sin(dlon/2);
    
    c = 2 * atan2(sqrt(a), sqrt(1-a));
    
    RETURN earth_radius * c;
END;
$$ LANGUAGE plpgsql;

-- Function to check geo-fence status
CREATE OR REPLACE FUNCTION check_geo_fence(
    check_lat DOUBLE PRECISION, 
    check_lon DOUBLE PRECISION
) RETURNS TABLE (
    within_fence BOOLEAN, 
    distance DOUBLE PRECISION, 
    office_name VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        calculate_distance(check_lat, check_lon, ol.latitude, ol.longitude) <= ol.radius_meters,
        calculate_distance(check_lat, check_lon, ol.latitude, ol.longitude),
        ol.name
    FROM office_locations ol
    WHERE ol.is_active = TRUE
    ORDER BY calculate_distance(check_lat, check_lon, ol.latitude, ol.longitude)
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Seed default admin user
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
ON CONFLICT (employee_id) DO NOTHING;