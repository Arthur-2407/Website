# WEBSITE_LINK_AUDIT_REPORT
Generated: 2026-06-15T07:23:08.347Z

## 1. Frontend Route Verification Summary
* Total Frontend Files Scanned: 60
* Total Links/Navigations Scanned: 12
* Total Broken Links Detected: 3

### Broken Links Details
| File | Link | Type | Line | Status |
|------|------|------|------|--------|
| [FaceLogin.tsx](file:///d:/Website/frontend/src/components/FaceLogin.tsx) | `/dashboard` | navigate() | 184 | ❌ Broken |
| [LoginPage.tsx](file:///d:/Website/frontend/src/pages/LoginPage.tsx) | `/dashboard` | navigate() | 133 | ❌ Broken |
| [LoginPage.tsx](file:///d:/Website/frontend/src/pages/LoginPage.tsx) | `/register` | <Link> | 389 | ❌ Broken |

## 2. API Endpoints Verification Summary
* Total Backend Endpoints Found: 116
* Total Frontend API Calls Scanned: 60
* Total Broken API Calls Detected: 50

### Broken API Calls Details
| File | Method | Path | Line | Status |
|------|--------|------|------|--------|
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/employees` | 77 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/employees` | 81 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/hierarchy` | 94 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/departments` | 112 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/departments` | 116 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/work-timings` | 121 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/work-timings` | 134 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/supervisor/team` | 139 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/configuration` | 152 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/configuration` | 156 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/reset/initiate` | 160 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/reset/verify-otp` | 164 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/reset/replace` | 168 | ❌ Unmapped |
| [attendanceApi.ts](file:///d:/Website/frontend/src/api/attendanceApi.ts) | `POST` | `/attendance/check-in` | 71 | ❌ Unmapped |
| [attendanceApi.ts](file:///d:/Website/frontend/src/api/attendanceApi.ts) | `POST` | `/attendance/check-out` | 76 | ❌ Unmapped |
| [attendanceApi.ts](file:///d:/Website/frontend/src/api/attendanceApi.ts) | `GET` | `/attendance/today` | 81 | ❌ Unmapped |
| [attendanceApi.ts](file:///d:/Website/frontend/src/api/attendanceApi.ts) | `GET` | `/attendance/history` | 86 | ❌ Unmapped |
| [authApi.ts](file:///d:/Website/frontend/src/api/authApi.ts) | `POST` | `/auth/logout` | 131 | ❌ Unmapped |
| [leaveApi.ts](file:///d:/Website/frontend/src/api/leaveApi.ts) | `POST` | `/leave/request` | 49 | ❌ Unmapped |
| [leaveApi.ts](file:///d:/Website/frontend/src/api/leaveApi.ts) | `GET` | `/leave/stats` | 84 | ❌ Unmapped |
| [mfaApi.ts](file:///d:/Website/frontend/src/api/mfaApi.ts) | `POST` | `/auth/mfa/verify` | 19 | ❌ Unmapped |
| [mfaApi.ts](file:///d:/Website/frontend/src/api/mfaApi.ts) | `POST` | `/auth/mfa/validate` | 22 | ❌ Unmapped |
| [mfaApi.ts](file:///d:/Website/frontend/src/api/mfaApi.ts) | `POST` | `/auth/mfa/disable` | 25 | ❌ Unmapped |
| [systemApi.ts](file:///d:/Website/frontend/src/api/systemApi.ts) | `GET` | `/system/status` | 30 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/employees` | 77 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/employees` | 81 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/hierarchy` | 94 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/departments` | 112 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/departments` | 116 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/work-timings` | 121 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/work-timings` | 134 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/supervisor/team` | 139 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `GET` | `/admin/configuration` | 152 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/configuration` | 156 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/reset/initiate` | 160 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/reset/verify-otp` | 164 | ❌ Unmapped |
| [adminApi.ts](file:///d:/Website/frontend/src/api/adminApi.ts) | `POST` | `/admin/reset/replace` | 168 | ❌ Unmapped |
| [attendanceApi.ts](file:///d:/Website/frontend/src/api/attendanceApi.ts) | `POST` | `/attendance/check-in` | 71 | ❌ Unmapped |
| [attendanceApi.ts](file:///d:/Website/frontend/src/api/attendanceApi.ts) | `POST` | `/attendance/check-out` | 76 | ❌ Unmapped |
| [attendanceApi.ts](file:///d:/Website/frontend/src/api/attendanceApi.ts) | `GET` | `/attendance/today` | 81 | ❌ Unmapped |
| [attendanceApi.ts](file:///d:/Website/frontend/src/api/attendanceApi.ts) | `GET` | `/attendance/history` | 86 | ❌ Unmapped |
| [authApi.ts](file:///d:/Website/frontend/src/api/authApi.ts) | `POST` | `/auth/logout` | 131 | ❌ Unmapped |
| [leaveApi.ts](file:///d:/Website/frontend/src/api/leaveApi.ts) | `POST` | `/leave/request` | 49 | ❌ Unmapped |
| [leaveApi.ts](file:///d:/Website/frontend/src/api/leaveApi.ts) | `GET` | `/leave/stats` | 84 | ❌ Unmapped |
| [mfaApi.ts](file:///d:/Website/frontend/src/api/mfaApi.ts) | `POST` | `/auth/mfa/verify` | 19 | ❌ Unmapped |
| [mfaApi.ts](file:///d:/Website/frontend/src/api/mfaApi.ts) | `POST` | `/auth/mfa/validate` | 22 | ❌ Unmapped |
| [mfaApi.ts](file:///d:/Website/frontend/src/api/mfaApi.ts) | `POST` | `/auth/mfa/disable` | 25 | ❌ Unmapped |
| [systemApi.ts](file:///d:/Website/frontend/src/api/systemApi.ts) | `GET` | `/system/status` | 30 | ❌ Unmapped |
| [SystemStatusDashboard.tsx](file:///d:/Website/frontend/src/pages/SystemStatusDashboard.tsx) | `GET` | `/telemetry/dashboard?window=5` | 54 | ❌ Unmapped |
| [api.ts](file:///d:/Website/frontend/src/services/api.ts) | `POST` | `/auth/refresh` | 117 | ❌ Unmapped |

## 3. All Scanned Links & Hrefs (Valid)
| File | Link | Type | Line |
|------|------|------|------|
| [FaceLogin.tsx](file:///d:/Website/frontend/src/components/FaceLogin.tsx) | `/login` | navigate() | 492 |
| [BootstrapSetupPage.tsx](file:///d:/Website/frontend/src/pages/BootstrapSetupPage.tsx) | `/login` | navigate() | 84 |
| [BootstrapSetupPage.tsx](file:///d:/Website/frontend/src/pages/BootstrapSetupPage.tsx) | `/login` | navigate() | 137 |
| [LoginPage.tsx](file:///d:/Website/frontend/src/pages/LoginPage.tsx) | `/setup/admin-face` | navigate() | 54 |
| [LoginPage.tsx](file:///d:/Website/frontend/src/pages/LoginPage.tsx) | `/face-login` | navigate() | 142 |
| [LoginPage.tsx](file:///d:/Website/frontend/src/pages/LoginPage.tsx) | `/face-login` | navigate() | 157 |
| [LoginPage.tsx](file:///d:/Website/frontend/src/pages/LoginPage.tsx) | `/face-login` | navigate() | 249 |
| [LoginPage.tsx](file:///d:/Website/frontend/src/pages/LoginPage.tsx) | `/recovery-request` | navigate() | 296 |
| [RecoveryRequestPage.tsx](file:///d:/Website/frontend/src/pages/RecoveryRequestPage.tsx) | `/login` | navigate() | 179 |