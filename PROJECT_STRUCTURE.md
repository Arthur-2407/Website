# Phase 1 — Project Structure & Services Map

This report details the scanned repository file layout, service components architecture, ports mapping, database relations, and key dependencies.

## 1. Directory Layout

```text
d:\Website
├── backend-api
│   ├── src
│   │   ├── __tests__             # Jest backend API unit tests
│   │   ├── config                # DB pools, Redis client, logger config
│   │   ├── middleware            # RBAC roles, token auth, rate limits
│   │   ├── modules               # Modules: admin, auth, face-management, leave, security
│   │   └── server.js             # Express API entrypoint
│   ├── package.json
│   ├── config.env
│   ├── Dockerfile
│   └── Dockerfile.prod
├── frontend
│   ├── src
│   │   ├── api                   # Axio APIs: adminApi, authApi, faceManagementApi, leaveApi
│   │   ├── components            # Reusable UI controls (e.g. camera, forms)
│   │   ├── contexts              # Global Contexts (Auth, Notifications)
│   │   ├── pages                 # UI screens (LoginPage, AdminPage, dashboards)
│   │   ├── services              # Services: location, websockets
│   │   ├── main.tsx
│   │   └── router.tsx
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── Dockerfile
│   └── Dockerfile.prod
├── face-ai-service
│   ├── src
│   │   ├── anti_spoof_detection  # AI anti-spoofing pipeline
│   │   ├── challenge_and_scoring # Challenge response engine
│   │   ├── face_detection        # MTCNN / OpenCV face detector
│   │   ├── liveness_detection    # Liveness check pipeline
│   │   ├── app.py / app_ml.py    # Python service APIs
│   │   └── main.py               # Fast API / Uvicorn server entrypoint
│   ├── requirements.txt
│   ├── requirements_ml.txt
│   ├── Dockerfile
│   └── Dockerfile.prod
├── nginx
│   ├── nginx.conf                # Nginx proxy configuration
│   ├── Dockerfile.prod
│   └── ssl                       # Self-signed certificate keys
├── database
│   ├── init.sql                  # Main PostgreSQL database seed
│   └── migration-004-biometric-hardening.sql
├── docker-compose.yml            # Local development compose
└── docker-compose.prod.yml       # Production deployment compose
```

---

## 2. Service Ports Map

| Service Name | Container Name | Host Port | Internal Port | Protocol | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `nginx` | `attendance-nginx-prod` | `80` / `443` | `80` / `443` | HTTP/HTTPS | Main entry gateway (reverse proxy) |
| `frontend` | `attendance-frontend-prod` | *Internal only* | `80` | HTTP | Static React assets (served via Nginx) |
| `backend-api` | `backend-api-prod` | *Internal only* | `3001` | HTTP/WS | Core Express server (REST & Socket.io) |
| `face-ai-service` | `face-ai-service-prod` | *Internal only* | `8000` | HTTP | Biometric Face-AI registration/login API |
| `postgres` | `attendance-db-prod` | `5432` | `5432` | TCP | PostgreSQL Main Database (employees, logs) |
| `postgres-face` | `attendance-face-db-prod` | `5433` | `5432` | TCP | PostgreSQL Face Database (biometric embeddings) |
| `redis` | `attendance-redis-prod` | *Internal only* | `6379` | TCP | Cache, OTP storage, rate limit locks |

---

## 3. Database Schema Mapping

### Main Database (`attendance_system`)
- `employees`: Stores core account credentials, details, supervisor reference, and face enrollment flags.
- `supervisor_assignments`: Connects employees to supervisors.
- `attendance_records`: Punch-in/Punch-out timestamps with geographic fence check metadata.
- `leave_requests` / `leave_approval_history`: Time-off tracking.
- `security_events`: High-severity alerts (spoof detections, travel violations).
- `account_recovery_requests` / `account_recovery_audit_log`: Missing biometric credential resets.

### Face Database (`attendance_face_system`)
- `users`: User identifier map.
- `user_images`: Holds uploaded photo binary metadata for facial records.
- `face_embeddings`: Stores 512-dimensional encrypted biometric templates.
- `face_change_requests`: Audit trail of requests (ADD, UPDATE, DELETE).
- `face_approval_requests` / `face_approval_history`: Holds supervisor/admin signoffs.
