# Phase 14 — Performance Analysis Report

Created: 2026-06-21T00:58:00+05:30

This report compiles resource usage data, response metrics, and query execution times for the production containers.

---

## 1. Container Resource Usage (Active Baseline)
Resource stats captured using `docker stats` during healthy system operation:

| Container Name | CPU % | Memory Usage | Memory Limit | Memory % | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `face-ai-service-prod` | `0.01%` | **869.6 MiB** | 11.5 GiB | 7.39% | TensorFlow, MTCNN model weight maps. |
| `backend-api-prod` | `0.02%` | **46.4 MiB** | 11.5 GiB | 0.39% | Express.js event handlers. |
| `attendance-db-prod` | `0.00%` | **33.5 MiB** | 1.0 GiB | 3.27% | Core transactional database. |
| `attendance-face-db-prod` | `0.01%` | **23.2 MiB** | 512 MiB | 4.54% | Face embeddings relational database. |
| `attendance-nginx-prod` | `0.00%` | **19.6 MiB** | 11.5 GiB | 0.17% | Reverse proxy gateway routing. |
| `attendance-redis-prod` | `0.36%` | **9.3 MiB** | 256 MiB | 3.61% | Cache server, session records. |
| `attendance-frontend-prod` | `0.00%` | **8.5 MiB** | 11.5 GiB | 0.07% | Static asset server (Vite bundle). |

---

## 2. API Response Times & Latencies
Average transaction speeds measured from end-to-end verification queries:
- **API Health Endpoint (`GET /health`)**: ~56ms
- **Bootstrap Status Query (`GET /api/auth/bootstrap/status`)**: ~15ms
- **Credential Signin Routing (`POST /api/auth/login`)**: ~75ms (utilizes bcrypt password verification).
- **Face Auth Routing (`POST /api/auth/face-login`)**: ~510ms (includes frame base64 decoding, liveness checking, anti-spoof checks, and embedding similarity comparison).

---

## 3. System Bottlenecks & Optimization
- **Biometric Processing Load**:
  > [!TIP]
  > Because Face AI liveness and similarity checks are CPU-intensive, a compute-optimized VPS instance (minimum 4 vCPUs) is recommended to prevent latency spikes when multiple employees clock in simultaneously.
- **Model Load Delay**:
  - The start period for `face-ai-service-prod` is intentionally set to `900s` (15 minutes). This is because the service downloads and initializes deep learning models (ArcFace/MTCNN) on initial startup. Once loaded, memory usage stabilizes at ~870 MiB.
