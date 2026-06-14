-- Migration 009: Face Approval Workflow and Seeding
-- Purpose: Add approval workflow tables for face modifications and seed default supervisor + default embeddings
-- Date: 2026-06-14

-- ============================================================================
-- 1. FACE_CHANGE_REQUESTS TABLE
-- Tracks requests to add, update, replace, or delete face profile embeddings.
-- ============================================================================
CREATE TABLE IF NOT EXISTS face_change_requests (
  id            BIGSERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  request_type  VARCHAR(20) NOT NULL CHECK (request_type IN ('ADD', 'UPDATE', 'REPLACE', 'DELETE')),
  requested_by  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  new_face_embedding TEXT,              -- JSON-encoded float array (NULL for DELETE)
  previous_face_embedding TEXT,         -- JSON-encoded float array
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_face_change_requests_employee ON face_change_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_face_change_requests_status ON face_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_face_change_requests_not_deleted ON face_change_requests(created_at DESC) WHERE deleted_at IS NULL;

-- ============================================================================
-- 2. FACE_APPROVAL_REQUESTS TABLE
-- Tracks the specific role level authorized to approve a pending request.
-- ============================================================================
CREATE TABLE IF NOT EXISTS face_approval_requests (
  id                    BIGSERIAL PRIMARY KEY,
  request_id            BIGINT NOT NULL REFERENCES face_change_requests(id) ON DELETE CASCADE,
  assigned_approver_role VARCHAR(20) NOT NULL CHECK (assigned_approver_role IN ('admin', 'supervisor')),
  status                VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_approval_requests_request ON face_approval_requests(request_id);
CREATE INDEX IF NOT EXISTS idx_face_approval_requests_role ON face_approval_requests(assigned_approver_role) WHERE status = 'PENDING';

-- ============================================================================
-- 3. FACE_APPROVAL_HISTORY TABLE
-- Log actions taken by approvers on face change requests.
-- ============================================================================
CREATE TABLE IF NOT EXISTS face_approval_history (
  id              BIGSERIAL PRIMARY KEY,
  request_id      BIGINT NOT NULL REFERENCES face_change_requests(id) ON DELETE CASCADE,
  action          VARCHAR(20) NOT NULL CHECK (action IN ('APPROVE', 'REJECT')),
  actioned_by     INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  actioned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_face_approval_hist_request ON face_approval_history(request_id);

-- ============================================================================
-- 4. FACE_AUDIT_LOGS TABLE
-- Immutable logs capturing exact face changes applied in the database.
-- ============================================================================
CREATE TABLE IF NOT EXISTS face_audit_logs (
  id                    BIGSERIAL PRIMARY KEY,
  employee_id           INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  action                VARCHAR(20) NOT NULL CHECK (action IN ('ADD', 'UPDATE', 'REPLACE', 'DELETE')),
  performed_by          INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  previous_embedding_id BIGINT,
  new_embedding_id      BIGINT,
  ip_address            INET,
  device_info           TEXT,
  timestamp             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_audit_logs_employee ON face_audit_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_face_audit_logs_timestamp ON face_audit_logs(timestamp DESC);

-- ============================================================================
-- 5. SEED DEFAULT SUPERVISOR ACCOUNT
-- ============================================================================
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
  'supervisor',
  'Supervisor',
  'User',
  'supervisor@attendance-system.local',
  '+1-555-0200',
  'Management',
  'Team Supervisor',
  'supervisor',
  CURRENT_DATE,
  TRUE,
  '$2a$10$7GfM9N7hE293W8P0fT4PLuB5zflrh3N7Y2MOiGGr4VooKPkjRyGOa',
  CURRENT_TIMESTAMP,
  0,
  NULL,
  '{"default_supervisor": true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (employee_id) DO NOTHING;

-- ============================================================================
-- 6. SEED DEFAULT FACE EMBEDDINGS FOR ADMIN AND SUPERVISOR
-- ============================================================================
DO $$
DECLARE
  v_admin_id INT;
  v_supervisor_id INT;
  v_vector TEXT := '[0.5,0.9207,0.9546,0.5706,0.1216,0.0205,0.3603,0.8285,0.9947,0.7061,0.228,0,0.2317,0.7101,0.9953,0.8251,0.356,0.0193,0.1245,0.5749,0.9565,0.9183,0.4956,0.0769,0.0472,0.4338,0.8813,0.9782,0.6355,0.1682,0.006,0.298,0.7757,1,0.7645,0.2859,0.0041,0.1782,0.6482,0.9819,0.8726,0.4207,0.0417,0.0841,0.5089,0.9255,0.9509,0.5618,0.1159,0.0231,0.3688,0.8351,0.9933,0.698,0.2206,0.0001,0.2392,0.7181,0.9964,0.8184,0.3476,0.0169,0.1304,0.5837,0.96,0.9134,0.4867,0.0722,0.051,0.4426,0.8869,0.9755,0.6269,0.1616,0.0074,0.3061,0.7831,0.9998,0.757,0.2779,0.0031,0.1851,0.6566,0.9842,0.8666,0.412,0.0383,0.0891,0.5177,0.93,0.947,0.553,0.1103,0.0259,0.3774,0.8416,0.9918,0.6898,0.2133,0.0004,0.2468,0.726,0.9974,0.8115,0.3392,0.0147,0.1364,0.5924,0.9634,0.9084,0.4779,0.0677,0.055,0.4514,0.8925,0.9727,0.6183,0.1552,0.009,0.3143,0.7903,0.9994,0.7494,0.27,0.0022,0.192,0.665,0.9863,0.8605,0.4033,0.0349,0.0942,0.5265,0.9345,0.943,0.5442,0.1048,0.0287,0.386,0.848,0.9901,0.6816,0.2061,0.0008,0.2545,0.7339,0.9982,0.8045,0.3308,0.0127,0.1426,0.6011,0.9667,0.9032,0.469,0.0633,0.0591,0.4602,0.8979,0.9698,0.6097,0.1488,0.0108,0.3225,0.7975,0.9989,0.7416,0.2622,0.0014,0.199,0.6733,0.9883,0.8543,0.3946,0.0318,0.0994,0.5354,0.9388,0.9388,0.5354,0.0994,0.0318,0.3946,0.8543,0.9883,0.6733,0.199,0.0014,0.2622,0.7417,0.9989,0.7975,0.3225,0.0108,0.1488,0.6097,0.9698,0.8979,0.4602,0.0591,0.0634,0.4691,0.9032,0.9667,0.6011,0.1426,0.0127,0.3308,0.8045,0.9982,0.7339,0.2545,0.0008,0.2061,0.6816,0.9901,0.848,0.386,0.0287,0.1048,0.5442,0.943,0.9345,0.5265,0.0942,0.035,0.4033,0.8605,0.9863,0.665,0.192,0.0022,0.2701,0.7494,0.9994,0.7903,0.3143,0.009,0.1552,0.6183,0.9727,0.8925,0.4514,0.055,0.0677,0.4779,0.9084,0.9634,0.5924,0.1364,0.0147,0.3392,0.8115,0.9974,0.726,0.2468,0.0004,0.2133,0.6898,0.9918,0.8416,0.3774,0.0259,0.1103,0.553,0.947,0.93,0.5177,0.0891,0.0383,0.412,0.8666,0.9842,0.6566,0.185,0.0031,0.278,0.757,0.9998,0.783,0.3061,0.0074,0.1616,0.6269,0.9755,0.8869,0.4426,0.051,0.0722,0.4867,0.9134,0.96,0.5837,0.1304,0.0169,0.3476,0.8184,0.9964,0.7181,0.2392,0.0001,0.2206,0.698,0.9933,0.8351,0.3688,0.0231,0.1159,0.5618,0.9509,0.9254,0.5088,0.0841,0.0417,0.4207,0.8726,0.9819,0.6482,0.1782,0.0041,0.2859,0.7646,1,0.7757,0.298,0.006,0.1682,0.6355,0.9782,0.8813,0.4338,0.0472,0.0769,0.4956,0.9183,0.9565,0.5749,0.1245,0.0193,0.3561,0.8252,0.9953,0.7101,0.2317,0,0.228,0.7061,0.9947,0.8285,0.3603,0.0205,0.1216,0.5706,0.9547,0.9207,0.5,0.0793,0.0454,0.4295,0.8784,0.9795,0.6397,0.1715,0.0053,0.294,0.772,1,0.7683,0.2899,0.0047,0.1749,0.644,0.9807,0.8755,0.425,0.0435,0.0817,0.5044,0.9231,0.9528,0.5662,0.1187,0.0218,0.3646,0.8318,0.994,0.702,0.2243,0,0.2355,0.7141,0.9959,0.8218,0.3518,0.0181,0.1275,0.5793,0.9583,0.9159,0.4911,0.0745,0.0491,0.4382,0.8841,0.9769,0.6312,0.1649,0.0067,0.3021,0.7794,0.9999,0.7608,0.2819,0.0036,0.1816,0.6524,0.9831,0.8696,0.4163,0.04,0.0866,0.5133,0.9278,0.949,0.5574,0.113,0.0245,0.3731,0.8384,0.9926,0.6939,0.2169,0.0002,0.243,0.7221,0.9969,0.8149,0.3434,0.0158,0.1334,0.5881,0.9617,0.9109,0.4823,0.07,0.053,0.447,0.8897,0.9741,0.6226,0.1584,0.0082,0.3102,0.7867,0.9996,0.7532,0.274,0.0026,0.1885,0.6608,0.9853,0.8636,0.4076,0.0366,0.0916,0.5221,0.9323,0.945,0.5486,0.1075,0.0273,0.3817,0.8449,0.991,0.6857,0.2097,0.0006,0.2507,0.73,0.9978,0.808,0.335,0.0137,0.1395,0.5968,0.9651,0.9058,0.4734,0.0655,0.057,0.4558,0.8952,0.9713,0.614,0.1519,0.0099,0.3184,0.7939,0.9992,0.7455,0.2661,0.0018,0.1955,0.6692,0.9873,0.8574,0.3989,0.0333,0.0968,0.531,0.9367,0.9409]';
  v_env TEXT := NULLIF('${NODE_ENV}', '${' || 'NODE_ENV}');
BEGIN
  -- If production, do NOT seed default face embeddings
  IF v_env = 'production' THEN
    RETURN;
  END IF;

  -- Get employee IDs
  SELECT id INTO v_admin_id FROM employees WHERE employee_id = 'admin';
  SELECT id INTO v_supervisor_id FROM employees WHERE employee_id = 'supervisor';

  -- Register admin face embedding if admin exists
  IF v_admin_id IS NOT NULL THEN
    -- Deactivate old active embeddings for admin
    UPDATE face_embeddings SET is_active = FALSE WHERE employee_id = v_admin_id;

    INSERT INTO face_embeddings (
      employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by
    ) VALUES (
      v_admin_id, v_vector, '1.0', 1.0, v_admin_id
    );

    UPDATE employees SET 
      face_enrolled = TRUE, 
      face_enrolled_at = NOW(),
      face_enrolled_by = v_admin_id 
    WHERE id = v_admin_id;
  END IF;

  -- Register supervisor face embedding if supervisor exists
  IF v_supervisor_id IS NOT NULL THEN
    UPDATE face_embeddings SET is_active = FALSE WHERE employee_id = v_supervisor_id;

    INSERT INTO face_embeddings (
      employee_id, embedding_vector, embedding_version, confidence_score, enrolled_by
    ) VALUES (
      v_supervisor_id, v_vector, '1.0', 1.0, v_admin_id
    );

    UPDATE employees SET 
      face_enrolled = TRUE, 
      face_enrolled_at = NOW(),
      face_enrolled_by = v_admin_id 
    WHERE id = v_supervisor_id;
  END IF;
END $$;
