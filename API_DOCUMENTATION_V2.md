# Enterprise Attendance System - API Documentation (V2)

This document contains the complete and production-hardened API specification for the Enterprise Attendance Management System.

---

## 1. Authentication & Recovery APIs (`/api/auth`)

### Pre-Login Status Check
Determines if an employee exists, checks their lock status, and identifies the required credentials (password, face, or both).
```http
POST /api/auth/pre-login-check
Content-Type: application/json

Request Body:
{
  "employeeId": "EMP001"
}

Response (200 OK):
{
  "success": true,
  "exists": true,
  "role": "employee",
  "has_password": true,
  "has_face": true,
  "required_method": "password_or_face", // "face_and_password" | "password_or_face" | "password"
  "missing_credentials": [],
  "needs_recovery": false,
  "account_locked": false,
  "locked_until": null
}

Errors:
- 400 Bad Request: Missing or invalid employeeId
```

### Standard Login
Authenticates an employee using password.
```http
POST /api/auth/login
Content-Type: application/json

Request Body:
{
  "employeeId": "EMP001",
  "password": "UserPassword123!"
}

Response (200 OK):
{
  "success": true,
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  },
  "employee": {
    "id": 1,
    "employeeId": "EMP001",
    "email": "john@company.com",
    "role": "employee",
    "department": "Engineering"
  }
}

Errors:
- 403 Forbidden (FACE_AUTHENTICATION_REQUIRED): Password correct, but face scan is also required (for Admin/Supervisor).
- 423 Locked: Too many failed login attempts.
- 401 Unauthorized: Invalid credentials.
```

### Face Authentication
Authenticates an employee using face frames and optional liveness challenge.
```http
POST /api/auth/face-login
Content-Type: application/json

Request Body:
{
  "employeeId": "EMP001",
  "frames": ["base64_encoded_frame_1", "base64_encoded_frame_2", ...],
  "challengeType": "blink", // "blink" | "head_left" | "head_right" | "head_up" | "head_down" (optional)
  "location": {
    "latitude": 40.7128,
    "longitude": -74.0060
  }
}

Response (200 OK):
{
  "success": true,
  "authenticated": true,
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  },
  "employee": {
    "id": 1,
    "employeeId": "EMP001",
    "role": "employee"
  }
}

Errors:
- 400 Bad Request: Missing face frames or employeeId.
- 403 Forbidden (SPOOF_DETECTED): Face-AI detected photo/video spoofing or challege failure.
- 503 Service Unavailable (FACE_AI_UNAVAILABLE): Face-AI container offline.
```

### Request Account Recovery
Submit a credential recovery request when credentials (password or face profile) are missing.
```http
POST /api/auth/recovery/request
Content-Type: application/json

Request Body:
{
  "employeeId": "EMP001",
  "requestType": "password_reset", // "password_reset" | "face_reset" | "full_credential_reset"
  "reason": "Lost credentials due to device update"
}

Response (201 Created):
{
  "success": true,
  "message": "Recovery request submitted. An administrator will review and approve your request.",
  "recoveryId": 45,
  "expiresAt": "2026-06-17T01:00:00Z"
}

Errors:
- 409 Conflict (RECOVERY_REQUEST_EXISTS): A pending request already exists.
- 404 Not Found: Employee not found.
```

### List Pending Recovery Requests
Retrieve all pending credential recovery requests.
```http
GET /api/auth/recovery/pending
Headers:
  Authorization: Bearer <admin_token>

Response (200 OK):
{
  "success": true,
  "data": [
    {
      "id": 45,
      "employee_id": "EMP001",
      "first_name": "John",
      "last_name": "Doe",
      "request_type": "password_reset",
      "status": "pending",
      "request_reason": "Lost credentials due to device update",
      "created_at": "2026-06-15T01:00:00Z"
    }
  ]
}
```

### Approve Recovery Request
Approve a pending recovery request.
```http
POST /api/auth/recovery/:recoveryId/approve
Headers:
  Authorization: Bearer <admin_token>
Content-Type: application/json

Request Body:
{
  "notes": "Verified employee identity via phone call."
}

Response (200 OK):
{
  "success": true,
  "message": "Recovery request approved",
  "recoveryId": 45
}
```

### Reject Recovery Request
Reject a pending recovery request.
```http
POST /api/auth/recovery/:recoveryId/reject
Headers:
  Authorization: Bearer <admin_token>
Content-Type: application/json

Request Body:
{
  "reason": "Unable to verify identity."
}

Response (200 OK):
{
  "success": true,
  "message": "Recovery request rejected",
  "recoveryId": 45
}
```

---

## 2. Face Management & Approval APIs (`/api`)

### Submit Face Change Request
Creates a new face enrollment or update request. Admins bypass approval instantly.
```http
POST /api/face-change-requests
Headers:
  Authorization: Bearer <token>
Content-Type: application/json

Request Body:
{
  "employeeId": "EMP001",
  "requestType": "ADD", // "ADD" | "UPDATE" | "REPLACE" | "DELETE"
  "frames": ["base64_encoded_frame_1", ...]
}

Response (201 Created - Employee/Supervisor):
{
  "success": true,
  "message": "Request submitted successfully. Pending approval.",
  "requestId": 101,
  "assignedApproverRole": "supervisor"
}

Response (200 OK - Admin Instant):
{
  "success": true,
  "message": "Face profile updated instantly.",
  "instant": true,
  "embeddingId": 201
}
```

### List Pending Face Change Requests
```http
GET /api/face-change-requests/pending
Headers:
  Authorization: Bearer <token>

Response (200 OK):
{
  "success": true,
  "data": [
    {
      "id": 101,
      "employee_id": "EMP001",
      "request_type": "ADD",
      "status": "PENDING"
    }
  ]
}
```

### Approve Face Change Request
```http
POST /api/face-change-requests/:id/approve
Headers:
  Authorization: Bearer <supervisor/admin_token>
Content-Type: application/json

Request Body:
{
  "notes": "Visual check passed."
}

Response (200 OK):
{
  "success": true,
  "message": "Request approved and credentials updated."
}
```

### Delete Face Profile (Admin Only)
Directly purges active face embedding records.
```http
DELETE /api/face-management/admin-delete/:employeeId
Headers:
  Authorization: Bearer <admin_token>

Response (200 OK):
{
  "success": true,
  "message": "Face profile purged successfully"
}
```

---

## 3. Excel Export APIs (`/api/excel`)

All endpoints generate a beautifully-styled, real `.xlsx` spreadsheet using ExcelJS.
*Role requirements: Supervisor scope constraints apply for non-admins.*

- **`GET /api/excel/attendance`**: Exports attendance records. Filters: `start_date`, `end_date`, `department`.
- **`GET /api/excel/leave`**: Exports leave requests. Filters: `start_date`, `end_date`.
- **`GET /api/excel/employees`** *(Admin Only)*: Exports the employee roster.
- **`GET /api/excel/audit-logs`** *(Admin Only)*: Exports general audit logs.
- **`GET /api/excel/security-events`** *(Admin Only)*: Exports security incident events. Includes color-coding for severity levels.

---

## 4. RBAC & Access Control Matrix

| API Path | Method | Public | Employee | Supervisor | Admin |
|----------|--------|--------|----------|------------|-------|
| `/api/auth/pre-login-check` | POST | Yes | Yes | Yes | Yes |
| `/api/auth/login` | POST | Yes | Yes | Yes | Yes |
| `/api/auth/face-login` | POST | Yes | Yes | Yes | Yes |
| `/api/auth/recovery/request` | POST | Yes | Yes | Yes | Yes |
| `/api/auth/recovery/pending` | GET | No | No | No | Yes |
| `/api/auth/recovery/:id/approve` | POST | No | No | No | Yes |
| `/api/auth/recovery/:id/reject` | POST | No | No | No | Yes |
| `/api/face-change-requests` | POST | No | Self | Team / Self | Any |
| `/api/face-change-requests/pending`| GET | No | No | Team | Any |
| `/api/face-change-requests/:id/approve`| POST | No| No | Team | Any |
| `/api/face-management/admin-delete/:id`| DELETE | No | No | No | Yes |
| `/api/excel/attendance` | GET | No | No | Team | Any |
| `/api/excel/leave` | GET | No | No | Team | Any |
| `/api/excel/employees` | GET | No | No | No | Yes |
| `/api/excel/audit-logs` | GET | No | No | No | Yes |
| `/api/excel/security-events` | GET | No | No | No | Yes |
