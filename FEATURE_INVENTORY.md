# FEATURE_INVENTORY.md
**Generated:** 2026-06-14  
**Purpose:** Complete inventory of all system features for preservation validation

---

## FRONTEND PAGES INVENTORY

### Public Pages
| Page | Path | Component | Status | Dependencies |
|------|------|-----------|--------|--------------|
| Login | `/login` | LoginPage.tsx | ✅ ACTIVE | authStore, auth API |
| Face Login | `/face-login` | FaceLogin.tsx | ✅ ACTIVE | faceAuth API, camera access |

### Authenticated Pages (All Roles)
| Page | Path | Component | Status | Dependencies |
|------|------|-----------|--------|--------------|
| Dashboard | `/dashboard` | DashboardPage.tsx | ✅ ACTIVE | attendance API, leave API |
| Attendance | `/attendance` | AttendancePage.tsx | ✅ ACTIVE | attendance API, geolocation |
| Leave | `/leave` | LeavePage.tsx | ✅ ACTIVE | leave API, notifications |
| Reports | `/reports` | ReportsPage.tsx | ✅ ACTIVE | reports API, charts |

### Supervisor Pages (Supervisor + Admin)
| Page | Path | Component | Status | Dependencies |
|------|------|-----------|--------|--------------|
| Supervisor Dashboard | `/supervisor` | SupervisorDashboard.tsx | ✅ ACTIVE | admin API, team data |

### Admin Pages (Admin Only)
| Page | Path | Component | Status | Dependencies |
|------|------|-----------|--------|--------------|
| Security Dashboard | `/security` | SecurityDashboard.tsx | ✅ ACTIVE | security API |
| System Status | `/system-status` | SystemStatusDashboard.tsx | ✅ ACTIVE | telemetry API |

### Layout & Error Handling
| Component | Path | Status | Purpose |
|-----------|------|--------|---------|
| MainLayout | components/layout/MainLayout.tsx | ✅ | App layout wrapper |
| Navbar | components/layout/Navbar.tsx | ✅ | Navigation menu |
| ProtectedRoute | components/ProtectedRoute.tsx | ✅ | Role-based route protection |
| ErrorBoundary | components/ErrorBoundary.tsx | ✅ | Error handling |
| DegradedModeBanner | components/DegradedModeBanner.tsx | ✅ | Service degradation indicator |

---

## FRONTEND COMPONENTS INVENTORY

### Camera/Biometric Components
| Component | Path | Status | Purpose |
|-----------|------|--------|---------|
| FaceCapture | components/camera/FaceCapture.tsx | ✅ | Face image capture |
| FaceLogin | components/FaceLogin.tsx | ✅ | Face authentication |
| LocationCapture | components/camera/LocationCapture.tsx | ✅ | GPS location capture |

### Chart Components
| Component | Path | Status | Purpose |
|-----------|------|--------|---------|
| AttendanceChart | components/charts/AttendanceChart.tsx | ✅ | Attendance visualization |
| LeaveChart | components/charts/LeaveChart.tsx | ✅ | Leave request trends |
| GeofenceChart | components/charts/GeofenceChart.tsx | ✅ | Geofence compliance |
| SecurityChart | components/charts/SecurityChart.tsx | ✅ | Security events |

---

## BACKEND API ROUTES INVENTORY

### Authentication Routes (`/api/auth`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| POST | `/login` | None | Public | ✅ | Password login |
| POST | `/face-login` | None | Public | ✅ | Face authentication |
| POST | `/logout` | Yes | All | ✅ | Logout |
| GET | `/verify` | Yes | All | ✅ | Verify token |
| GET | `/me` | Yes | All | ✅ | Get current user |
| POST | `/refresh` | No (refresh token) | All | ✅ | Refresh access token |
| POST | `/register-face` | Yes | All | ✅ | Register face |

### MFA Routes (`/api/auth/mfa`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| POST | `/enroll` | Yes | All | ✅ | Enroll in MFA |
| POST | `/verify` | Yes | All | ✅ | Verify MFA challenge |
| POST | `/validate` | Yes | All | ✅ | Validate MFA code |
| POST | `/disable` | Yes | All | ✅ | Disable MFA |
| GET | `/status` | Yes | All | ✅ | Check MFA status |

### Attendance Routes (`/api/attendance`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| POST | `/check-in` | Yes | All | ✅ | Record check-in |
| POST | `/check-out` | Yes | All | ✅ | Record check-out |
| GET | `/today` | Yes | All | ✅ | Get today's record |
| GET | `/history` | Yes | All | ✅ | Get attendance history |
| GET | `/stats` | Yes | All | ✅ | Get attendance stats |

### Leave Routes (`/api/leave`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| POST | `/request` | Yes | All | ✅ | Submit leave request |
| GET | `/my-requests` | Yes | All | ✅ | Get own requests |
| GET | `/team-requests` | Yes | Supervisor+ | ✅ | Get team requests |
| GET | `/request/:id` | Yes | All | ✅ | Get single request |
| PUT | `/request/:id/approve` | Yes | Supervisor+ | ✅ | Approve leave |
| PUT | `/request/:id/reject` | Yes | Supervisor+ | ✅ | Reject leave |
| PUT | `/request/:id/cancel` | Yes | Employee | ✅ | Cancel own request |
| GET | `/stats` | Yes | All | ✅ | Get leave statistics |

### Admin Routes (`/api/admin`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/employees` | Yes | Admin | ✅ | List all employees |
| POST | `/employees` | Yes | Admin | ✅ | Create employee |
| PUT | `/employees/:id` | Yes | Admin | ✅ | Update employee |
| DELETE | `/employees/:id` | Yes | Admin | ✅ | Delete employee |
| POST | `/supervisors/:id/assign-employees` | Yes | Admin | ✅ | Assign employees |
| GET | `/supervisors/:id/employees` | Yes | Admin | ✅ | List team |
| DELETE | `/supervisors/:id/employees/:empId` | Yes | Admin | ✅ | Unassign employee |
| GET | `/hierarchy` | Yes | Admin | ✅ | Get hierarchy tree |
| GET | `/supervisor/team` | Yes | Supervisor+ | ✅ | Get assigned team |
| GET | `/supervisor/team/:empId/attendance` | Yes | Supervisor+ | ✅ | Get employee attendance |
| GET | `/departments` | Yes | Admin | ✅ | List departments |
| POST | `/departments` | Yes | Admin | ✅ | Create department |
| GET | `/work-timings` | Yes | Supervisor+ | ✅ | Get work hours |
| POST | `/work-timings` | Yes | Admin | ✅ | Set work hours |

### Location Routes (`/api/locations`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/` | Yes | All | ✅ | List locations |
| GET | `/:id` | Yes | All | ✅ | Get location |
| POST | `/` | Yes | Admin | ✅ | Create location |
| PUT | `/:id` | Yes | Admin | ✅ | Update location |
| DELETE | `/:id` | Yes | Admin | ✅ | Delete location |
| GET | `/:id/work-hours` | Yes | All | ✅ | Get work hours |

### Geofence Routes (`/api/geofence`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| POST | `/validate` | Yes | All | ✅ | Check in geofence |
| GET | `/config` | Yes | All | ✅ | Get geofence config |
| PUT | `/config` | Yes | All | ✅ | Update geofence config |

### Reports Routes (`/api/reports`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/` | Yes | All | ✅ | Get reports |

### Work Report Routes (`/api/work-report`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| POST | `/` | Yes | All | ✅ | Submit work report |
| GET | `/:id` | Yes | All | ✅ | Get work report |

### Excel Routes (`/api/excel`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/attendance` | Yes | Supervisor+ | ✅ | Export attendance |
| GET | `/leave` | Yes | Supervisor+ | ✅ | Export leave data |
| POST | `/upload` | Yes | Supervisor+ | ✅ | Upload data |

### Notification Routes (`/api/notifications`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/` | Yes | All | ✅ | Get notifications |

### Security Routes (`/api/security`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/events` | Yes | Supervisor+ | ✅ | List security events |
| GET | `/stats` | Yes | Supervisor+ | ✅ | Security statistics |
| POST | `/log` | Yes | Supervisor+ | ✅ | Log event |
| GET | `/login-logs` | Yes | Supervisor+ | ✅ | Login history |
| GET | `/system-logs` | Yes | Admin | ✅ | System logs |
| GET | `/spoof-attempts` | Yes | Supervisor+ | ✅ | Spoof attempts |
| GET | `/geofence-violations` | Yes | Supervisor+ | ✅ | Geofence violations |
| GET | `/health` | No | Public | ✅ | Health check |

### Telemetry Routes (`/api/telemetry`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/dashboard` | Yes | Supervisor+ | ✅ | Metrics dashboard |
| GET | `/health` | Yes | Supervisor+ | ✅ | System health |
| GET | `/metrics` | Yes | Supervisor+ | ✅ | Prometheus metrics |

### System Routes (`/api/system`)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/status` | No | Public | ✅ | System status |
| GET | `/features` | Yes | All | ✅ | Feature flags |
| GET | `/permissions` | Yes | All | ✅ | User permissions |
| GET | `/queue` | Yes | Supervisor+ | ✅ | Job queue stats |
| GET | `/traces` | Yes | Supervisor+ | ✅ | Tracing stats |
| GET | `/health` | No | Public | ✅ | Health check |

### Metrics Routes (Prometheus)
| Method | Endpoint | Authentication | Role | Status | Purpose |
|--------|----------|-----------------|------|--------|---------|
| GET | `/metrics` | No | Public | ✅ | Prometheus format |
| GET | `/api/telemetry/prometheus` | Yes | Supervisor+ | ✅ | JSON format |

---

## DATABASE TABLES INVENTORY

### Core Business Tables
| Table | Columns | Indexes | Status | Purpose |
|-------|---------|---------|--------|---------|
| employees | id, employee_id, name, email, role, department, supervisor_id, password_hash, mfa_enabled, is_active, locked_until, last_login_at | 4 | ✅ | User records |
| attendance_records | id, employee_id, check_in_time, check_out_time, location, geo_fence_status, work_hours, check_in_image_url, check_out_image_url | 3 | ✅ | Attendance log |
| leave_requests | id, employee_id, supervisor_id, leave_type, start_date, end_date, status, reason, approver_id, approval_timestamp, rejection_reason | 4 | ✅ | Leave log |
| work_reports | id, employee_id, supervisor_id, report_date, description, location, metadata | 3 | ✅ | Work reports |

### Security & Logs
| Table | Columns | Indexes | Status | Purpose |
|-------|---------|---------|--------|---------|
| login_logs | id, employee_id, timestamp, success, ip_address, device_info, spoof_detected, mfa_method | 4 | ✅ | Login history |
| security_events | id, employee_id, event_type, severity, timestamp, ip_address, details | 4 | ✅ | Security events |
| system_logs | id, service_name, log_level, message, timestamp, context | 3 | ✅ | System logs |
| audit_logs | id, actor_employee_id, action, resource_type, resource_id, details, created_at | 2 | ✅ | Audit trail |
| face_enrollment_logs | id, employee_id, target_employee_id, action, performed_by_role, confidence_score, embedding_version, ip_address, device_info, reason, previous_embedding_id, details, created_at | 3 | ✅ | Face registration audit |
| leave_approval_history | id, leave_request_id, action, actor_employee_id, actor_role, previous_status, new_status, reason, ip_address, user_agent, details, created_at | 3 | ✅ | Leave approval audit trail |
| device_fingerprints | id, employee_id, fingerprint, ip_address, user_agent, trust_score, trust_level, first_seen_at, last_seen_at, login_count, is_trusted, revoked_at, created_at, updated_at | 3 | ✅ | Device trust persistence |
| impossible_travel_events | id, employee_id, employee_id_str, from_lat, from_lng, to_lat, to_lng, distance_km, time_diff_minutes, required_speed_kmh, severity, ip_address, device_info, resolved, resolved_at, resolved_by, created_at | 3 | ✅ | Impossible travel audit |
| employee_login_locations | employee_id, last_lat, last_lng, last_login_at, updated_at | 0 | ✅ | Last login location cache |

### Configuration & Management
| Table | Columns | Indexes | Status | Purpose |
|-------|---------|---------|--------|---------|
| office_locations | id, name, address, latitude, longitude, radius, is_active, created_at | 0 | ✅ | Geofence config |
| work_timings | id, work_start_time, work_end_time, lunch_start, lunch_end, timezone | 0 | ✅ | Work hours |
| leave_policy | id, leave_type, max_days, requires_approval, description | 0 | ✅ | Leave rules |
| leave_balance | id, employee_id, leave_type, balance, used, year | 2 | ✅ | Leave tracking |
| department_config | id, name, max_daily_members, is_active | 0 | ✅ | Department setup |

### Infrastructure
| Table | Columns | Indexes | Status | Purpose |
|-------|---------|---------|--------|---------|
| refresh_tokens | id, employee_id, token_family, expires_at, revoked_at, ip_address, device_info | 3 | ✅ | Token tracking |
| notifications | id, employee_id, type, title, message, is_read, created_at | 2 | ✅ | User notifications |
| supervisor_assignments | id, supervisor_id, employee_id, is_active, assigned_at | 0 | ✅ | Supervisor mapping |
| backup_configurations | id, backup_type, frequency, retention_days, is_active | 0 | ✅ | Backup settings |
| face_embeddings | id, employee_id, embedding_vector, embedding_version, confidence_score, model_name, enrolled_by, enrollment_date, last_verified_at, is_active, created_at, updated_at | 2 | ✅ | Face recognition vectors |

---

## MIDDLEWARE STACK INVENTORY

| Middleware | File | Status | Purpose |
|-----------|------|--------|---------|
| errorHandler | middleware/errorHandler.js | ✅ | Global error handling |
| authenticateToken | middleware/authMiddleware.js | ✅ | JWT validation |
| generateTokens | middleware/authMiddleware.js | ✅ | Token generation |
| rbac (requireRole) | middleware/rbac.js | ✅ | Role-based access |
| rateLimiter | middleware/rateLimiter.js | ✅ | Rate limiting |
| requestTimeout | middleware/requestTimeout.js | ✅ | Timeout management |
| securityHeaders | middleware/securityHeaders.js | ✅ | CSP, HSTS headers |
| logRequest | middleware/loggingMiddleware.js | ✅ | Request logging |
| correlationId | middleware/correlationId.js | ✅ | Tracing |
| apiVersioning | middleware/apiVersioning.js | ✅ | Feature flags |
| degradedModeMiddleware | middleware/degradedModeMiddleware.js | ✅ | Graceful degradation |
| sentryErrorMiddleware | config/sentry.js | ✅ | Error tracking |

---

## EXTERNAL SERVICES INVENTORY

| Service | Type | Status | Purpose | Connection |
|---------|------|--------|---------|-----------|
| Face AI Service | Python | ✅ | Face recognition | localhost:8000 |
| PostgreSQL | Database | ✅ | Data persistence | DATABASE_URL env |
| Redis | Cache | ✅ | Rate limit, tokens | REDIS_URL env |
| Socket.IO | WebSocket | ✅ | Real-time notifications | Integrated |
| Sentry | Error Tracking | ✅ | Error monitoring | SENTRY_DSN env |

---

## SECURITY FEATURES INVENTORY

| Feature | Component | Status | Purpose |
|---------|-----------|--------|---------|
| Password Hashing | bcryptjs | ✅ | Secure passwords |
| JWT Tokens | jsonwebtoken | ✅ | Stateless auth |
| Rate Limiting | express-rate-limit | ✅ | DDoS protection |
| CORS | cors middleware | ✅ | Cross-origin access |
| Helmet | helmet.js | ✅ | Security headers |
| Role-Based Access | rbac middleware | ✅ | Authorization |
| Token Refresh Rotation | authMiddleware | ✅ | Token security |
| Audit Logging | securityLogger | ✅ | Action tracking |
| Impossible Travel Detection | impossibleTravel.js | ✅ | Location anomaly (persistent) |
| Device Fingerprinting | deviceTrust.js | ✅ | Device tracking (persistent) |
| MFA/2FA | mfaRoutes | ✅ | Multi-factor auth |
| Deepfake Detection | AI service | ✅ | Face spoof detection |

---

## SUMMARY STATISTICS

- **Total Frontend Pages:** 10 (7 authenticated, 2 public, 1 layout)
- **Total API Endpoints:** 72+
- **Total Database Tables:** 23 (all verified and active)
- **Middleware Components:** 12
- **External Services:** 5
- **Security Features:** 12 (all active and production-hardened)

---

## PRESERVATION CHECKLIST

✅ All existing features must remain in Phase 1  
✅ All routes must continue to work  
✅ All tables must be accessible  
✅ All middleware must be functional  
✅ No hard deletions without 10-point proof  
✅ Backward compatibility maintained  
✅ Historical data immutable  
