# FORENSIC FINDINGS REPORT

This report details the findings from the codebase audit and the runtime behavior analysis of the Face Authentication Enterprise Platform.

---

## 1. Summary of Audited Files

- **Frontend:**
  - `frontend/src/router.tsx`
  - `frontend/src/pages/BootstrapSetupPage.tsx`
  - `frontend/src/pages/LoginPage.tsx`
  - `frontend/src/components/camera/FaceCamera.tsx`
- **Backend API:**
  - `backend-api/src/modules/auth/routes.js`
  - `backend-api/src/modules/admin/routes.js`
  - `backend-api/src/modules/face-management/routes.js`
- **Face AI Service:**
  - `face-ai-service/src/main.py`

---

## 2. Findings by Severity

### 🔴 CRITICAL: Admin Bootstrap/Setup Inaccessibility & Deadlock
- **Finding:** The `/setup/admin-face` page immediately checks bootstrap status and redirects the browser to `/login` if `bootstrapMode` is `false`. Because the database already contains an active admin face profile, `bootstrapMode` defaults to `false`. If the administrator is locked out or face matching fails, they cannot bypass `/login` or reach the setup page to re-enroll.
- **Impact:** System lockout; inability to recover administrative access.
- **Resolution:** Introduce a secure recovery route: `/setup/admin-face?recovery=true`. When accessed, the backend returns `bootstrapMode: true` (override). The frontend will prompt for identity verification using a 6-digit OTP sent to the admin's recovery email before unlocking the credential setup fields.

### 🟡 HIGH: Unauthenticated Recovery Reset Vulnerability
- **Finding:** The backend `POST /api/auth/bootstrap/setup` endpoint allows resetting the administrator credentials when the `?recovery=true` parameter or header is sent, but did not perform any verification of the requester.
- **Impact:** Any client could bypass authentication by appending `?recovery=true` and overwrite the administrator password and face embedding.
- **Resolution:** Protect `/api/auth/bootstrap/setup` in recovery mode. Require the client to verify an OTP first. The setup execution will check for a Redis validation flag (`admin_recovery_verified:${admin.id}`) before applying DB changes.

### 🟢 MEDIUM: Base64 Prefix Transport Crash
- **Finding:** Raw webcam streams yield data URLs containing prefix descriptors (e.g. `data:image/jpeg;base64,`). When passed directly to Python's `base64.b64decode`, non-alphanumeric characters like `:` and `,` cause alignment failures, returning corrupted bytes that fail to decode with `cv2.imdecode` (resulting in `None`).
- **Impact:** Face registration and verification requests failed with `400 Bad Request` or timed out.
- **Resolution:** Stripped the data URL prefixes on both the frontend (during canvas capture) and the backend (Flask AI service route handlers) to ensure clean base64 data transmission.

### 🟢 LOW: Legacy Config & Administrator Table Sync
- **Finding:** The system maintains duplicate configurations in legacy `admin_configuration` and enterprise-aligned `administrators` tables. Synchronizing them through triggers can cause nested recursion.
- **Impact:** Database errors during setup updates.
- **Resolution:** Sync operations are managed via the recursion guards added in migration `016_fix_trigger_recursion.up.sql`.
