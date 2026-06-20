# Phase 7 — Docker Validation Audit

Created: 2026-06-21T00:54:00+05:30

This report audits the container builds, host-mapping constraints, mount storage, bridge networks, container check scripts, and restart configurations.

---

## 1. Containers Inventory & Specs

| Service Name | Source Image / Dockerfile | Exposed Host Port | Mount Target Volume | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `postgres` | `postgres:15-alpine` | `5432:5432` | `postgres_data` | Core employee schemas. |
| `postgres-face` | `postgres:15-alpine` | `5433:5432` | `postgres_face_data` | Secure face embeddings. |
| `redis` | `redis:7-alpine` | *None* | `redis_data` | Memory cache rate-limit lock. |
| `backend-api` | `./backend-api/Dockerfile.prod` | *None* | `backend_api_logs` | Express API, ORM migrations. |
| `face-ai-service`| `./face-ai-service/Dockerfile.prod`| *None* | `face_ai_models`, `face_ai_logs` | Deepface, PyTorch inference. |
| `frontend` | `./frontend/Dockerfile.prod` | *None* | *None* | Serves static Vite HTML files. |
| `nginx` | `./nginx/Dockerfile.prod` | `80` & `443` | `nginx_logs` | Gateway proxy routing. |

---

## 2. Health Checks Evaluation

All 7 production containers configure dedicated automated health assessments to ensure fast recovery:

- **`postgres` / `postgres-face`**: Uses `pg_isready` binary check tool.
- **`redis`**: Executes `redis-cli ping` passing dynamic password value.
- **`backend-api`**: Invokes Express `/health` REST route handler.
- **`face-ai-service`**:
  - *Script*: `curl -f http://localhost:8000/health`
  - *Start Period*: `900s` (15 minutes).
  > [!NOTE]
  > The extremely long startup period (15 minutes) is required to download weight layers and cache face detection/recognition model variables into CPU system memory on initial deployment without triggering health-check failures.
- **`frontend` / `nginx`**: Simple loop request to `/health` endpoints.

---

## 3. Network Isolation
All components bind to a custom bridge network `attendance-network` with subnet `172.20.0.0/16`.
- **Database Isolation**: PostgreSQL and Redis instances do not expose database ports outside of the internal virtual subnet, except for mapped host ports (`5432`/`5433`) used for local debugging and host-based testing.
- **Gateway Isolation**: Nginx functions as the single public gateway (ports 80 and 443).

---

## 4. Operational Recommendations
- **Frontend Container Build Requirement**:
  > [!WARNING]
  > Since `frontend/Dockerfile.prod` copies from the host `dist/` directory, you must run `npm run build` inside the `/frontend` project folder on the host machine prior to building this docker image.
