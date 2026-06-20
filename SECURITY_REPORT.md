# Phase 13 — Security Audit Report

Created: 2026-06-21T00:56:00+05:30

This report assesses the security posture of the deployed Enterprise Attendance Portal, auditing network access, secret strength, authentication policies, and rate limit protections.

---

## 1. Network & Port Exposure Audit
Only standard web-traffic channels are routed public access.
- **Port 80 (HTTP)**: Open. Managed by Nginx to serve static resources and auto-redirect incoming queries to port 443 (HTTPS).
- **Port 443 (HTTPS)**: Open. Managed by Nginx with TLSv1.2/TLSv1.3 configurations.
- **Port 5432 (PostgreSQL Main)**: Mapped to host loopback interface (`127.0.0.1:5432` / local bridge subnet). Protected from external public ingress by UFW firewall block rules.
- **Port 5433 (PostgreSQL Face)**: Mapped to host loopback interface (`127.0.0.1:5433`). Protected from external public ingress by UFW.
- **Port 6379 (Redis)**: Completely internal to the Docker subnet bridge network. No external ports mapped to host.

---

## 2. Secrets & Encryption Strength
- **JWT Key Strength**: Access and Refresh tokens are signed using high-entropy 256-bit (64-character) hex keys (`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`).
- **Password Protection**: User passwords are encrypted using `bcryptjs` with standard salt rounds (`10`).
- **Biometric Templates**: Face recognition features calculate unit vector embeddings (512-dimension) which are stored in the dedicated face database.

---

## 3. Configuration Security Check
- **App Debug Mode**:
  - `NODE_ENV` is set to `production` in backend-api and frontend containers.
  - Face AI service mode is configured to `real` (`FACE_RECOGNITION_MODE=real`), preventing mock frame bypasses in production.
- **Authentication Safety (MFA)**:
  - High-privilege administrative accounts (Admin/Supervisor role) require both correct credentials and camera face verification. Password-only logins are strictly blocked.
- **Rate-Limiting Protection**:
  - Express backend-api implements rate-limiting checks (`express-rate-limit`) restricting client traffic to `100` queries per `60000ms` window per IP address, preventing Denial of Service (DoS) and brute-force events.
- **Account Lockout Policy**:
  - Set to trigger lockout when successive failed authentication requests reach configured limits, keeping supervisor access safe from credential stuffing.
