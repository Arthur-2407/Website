# AUTH FLOW MAP

This document details the precise verification steps and endpoint transitions across the system's authentication flows.

---

## 1. Admin Bootstrap Setup Flow (First Installation)

### Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Admin as System Installer
    participant Browser as React Frontend
    participant Gateway as Nginx Proxy
    participant Backend as Express backend-api
    participant DB as PostgreSQL
    participant AI as Flask face-ai-service

    Admin->>Browser: Access http://localhost/setup/admin-face
    Browser->>Backend: GET /api/auth/bootstrap/status
    Backend->>DB: Query active face embedding for 'admin'
    DB->>Backend: Returns 0 rows (no admin face exists)
    Backend->>Browser: Response { success: true, bootstrapMode: true }
    Browser->>Admin: Show first-time configuration wizard (Step 1-4)
    Admin->>Browser: Enters Profile, Recovery info, Password & captures 5 face frames
    Admin->>Browser: Clicks "Submit"
    Browser->>Backend: POST /api/auth/bootstrap/setup
    Backend->>AI: POST /api/register-face { frames, employeeId: 'admin' }
    AI->>AI: Detect faces, calculate gray-variance & generate 512-dim embedding vector
    AI->>Backend: Response { success: true, embedding: [...] }
    Backend->>DB: Begin Transaction
    Backend->>DB: Update password_hash, face_enrolled=TRUE in 'employees'
    Backend->>DB: Insert face embedding in 'face_embeddings'
    Backend->>DB: Insert config in 'admin_configuration' / 'administrators'
    Backend->>DB: Commit Transaction
    Backend->>Browser: Response { success: true }
    Browser->>Browser: Redirect to /login
```

---

## 2. Normal Admin Login Flow

### Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Admin as System Administrator
    participant Browser as React Frontend
    participant Backend as Express backend-api
    participant DB as PostgreSQL
    participant AI as Flask face-ai-service

    Admin->>Browser: Go to /login & enter Employee ID: admin
    Browser->>Backend: POST /api/auth/pre-login-check { employeeId: 'admin' }
    Backend->>DB: Query role, password, and face status for 'admin'
    DB->>Backend: Returns role='admin', has_password=true, has_face=true
    Backend->>Browser: Response { required_method: 'face_and_password', ... }
    Browser->>Admin: Show password prompt
    Admin->>Browser: Enters password
    Browser->>Backend: POST /api/auth/login { employeeId: 'admin', password }
    Backend->>DB: Fetch password_hash
    Backend->>Backend: Verify password using bcrypt.compare
    Backend->>Browser: Response 403 Forbidden { code: 'FACE_AUTHENTICATION_REQUIRED' }
    Browser->>Browser: Redirect to /face-login (carrying password state)
    Browser->>Admin: Start camera feed
    Admin->>Browser: Captures face frames
    Browser->>Backend: POST /api/auth/face-login { employeeId: 'admin', password, frames }
    Backend->>DB: Verify password again & query active face embedding
    DB->>Backend: Returns 512-dim embedding vector from face_embeddings
    Backend->>AI: POST /api/face-login { frames, stored_embedding: [...] }
    AI->>AI: Detect faces, check liveness, run spoof check, compare cosine similarity
    AI->>Backend: Response { authenticated: true, similarity: 0.82 }
    Backend->>DB: Reset failed_login_count, insert login_logs
    Backend->>Browser: Response { success: true, tokens: { accessToken, refreshToken } }
    Browser->>Browser: Redirect to /dashboard
```

---

## 3. Secure Admin Recovery Flow (`?recovery=true`)

This flow allows a valid administrator to recover their password and face configuration in the event of lockouts or camera pipeline issues.

### Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Locked Out Admin
    participant Browser as React Frontend
    participant Backend as Express backend-api
    participant Redis as Redis Cache
    participant DB as PostgreSQL

    Admin->>Browser: Access http://localhost/setup/admin-face?recovery=true
    Browser->>Backend: GET /api/auth/bootstrap/status?recovery=true
    Backend->>Browser: Response { success: true, bootstrapMode: true } (override active)
    Browser->>Admin: Display Admin Identity Verification (OTP Screen)
    Admin->>Browser: Click "Send OTP"
    Browser->>Backend: POST /api/auth/recovery/admin/initiate
    Backend->>DB: Fetch admin recovery email (fallback to primary email)
    DB->>Backend: Returns 'admin@attendance-system.local'
    Backend->>Redis: Set admin_recovery_otp:1 = '123456' (expiry 5m)
    Backend->>Backend: Logs OTP securely (mocking email delivery)
    Backend->>Browser: Response { success: true }
    Admin->>Browser: Enters OTP '123456' and clicks "Verify"
    Browser->>Backend: POST /api/auth/recovery/admin/verify-otp { otp: '123456' }
    Backend->>Redis: Get admin_recovery_otp:1
    Backend->>Redis: Set admin_recovery_verified:1 = 'true' (expiry 10m)
    Backend->>Browser: Response { success: true }
    Browser->>Admin: Unlock first-time setup wizard (Step 1-4)
    Admin->>Browser: Configure new password and capture new face frames
    Admin->>Browser: Click "Submit"
    Browser->>Backend: POST /api/auth/bootstrap/setup?recovery=true { password, frames }
    Backend->>Redis: Verify admin_recovery_verified:1 is 'true'
    Redis->>Backend: Returns 'true' (valid)
    Backend->>Backend: Complete password hash & update database
    Backend->>Redis: Delete admin_recovery_verified:1
    Backend->>Browser: Response { success: true }
    Browser->>Browser: Redirect to /login
```

---

## 4. Employee Authentication Flow (Password or Face Login)

Unlike administrative accounts, standard employees are configured to authenticate using either their password or their face profile, based on their preference or dynamic security status.

### Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Employee as Standard Employee
    participant Browser as React Frontend
    participant Backend as Express backend-api
    participant DB as PostgreSQL
    participant AI as Flask face-ai-service

    Employee->>Browser: Go to /login & enter Employee ID: EMP001
    Browser->>Backend: POST /api/auth/pre-login-check { employeeId: 'EMP001' }
    Backend->>DB: Query role, password, and face status for 'EMP001'
    DB->>Backend: Returns role='employee', has_password=true, has_face=true
    Backend->>Browser: Response { required_method: 'password_or_face', ... }
    Browser->>Employee: Show Login options (Password or Face)
    
    alt Option A: Password Authentication
        Employee->>Browser: Enters Password
        Browser->>Backend: POST /api/auth/login { employeeId: 'EMP001', password }
        Backend->>DB: Fetch password_hash
        Backend->>Backend: Verify password using bcrypt.compare
        Backend->>DB: Reset failed_login_count, update last_login_at
        Backend->>Browser: Response { success: true, tokens }
        Browser->>Browser: Redirect to /dashboard
    else Option B: Face Authentication
        Employee->>Browser: Clicks "Login with Face"
        Browser->>Employee: Start camera, capture frames
        Browser->>Backend: POST /api/auth/face-login { employeeId: 'EMP001', frames }
        Backend->>DB: Fetch active face embedding from database
        DB->>Backend: Returns embedding vector
        Backend->>AI: POST /api/face-login { frames, stored_embedding: [...] }
        AI->>AI: Detect faces, analyze liveness, detect spoof, calculate similarity
        AI->>Backend: Response { authenticated: true, similarity: 0.88 }
        Backend->>DB: Reset failed_login_count, update last_login_at, insert login_logs
        Backend->>Browser: Response { success: true, tokens }
        Browser->>Browser: Redirect to /dashboard
    end
```

