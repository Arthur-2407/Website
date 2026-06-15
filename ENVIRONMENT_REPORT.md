# ENVIRONMENT REPORT
**Date**: 2026-06-14
**Time**: 21:57 IST (16:27 UTC)

## Runtime Environment

| Component | Version | Source |
|-----------|---------|--------|
| Host OS | Windows 10/11 | `$env:OS` |
| PowerShell | 5.1.26100.8655 | `$PSVersionTable` |
| Node.js | v20.20.1 | `node --version` |
| npm | 10.8.2 | `npm --version` |
| Docker Engine | 29.2.1 build a5c7197 | `docker --version` |
| Docker Compose | v5.1.0 | `docker-compose --version` |

## Container Runtime

| Container | Image | Version | Status |
|-----------|-------|---------|--------|
| attendance-db | postgres:15-alpine | 15 | ✅ healthy |
| attendance-redis | redis:7-alpine | 7 | ✅ healthy |
| face-ai-service | custom/flask | 1.0.0 (Python 3.x) | ✅ healthy |
| backend-api | custom/node | v20.20.1 | ✅ healthy |
| attendance-frontend | custom/nginx | nginx alpine | ✅ healthy |
| attendance-nginx | nginx:alpine | alpine | ✅ healthy (fixed) |

## Network Configuration

| Service | Internal Port | External Port | Protocol |
|---------|--------------|--------------|----------|
| PostgreSQL | 5432 | 5432 | TCP |
| Redis | 6379 | 6379 | TCP |
| Face AI | 8000 | 8000 | HTTP |
| Backend API | 3001 | 3001 | HTTP |
| Frontend | 80 | 3000 | HTTP |
| Nginx | 80/443 | 80/443 | HTTP/HTTPS |

## Dependencies Verified

### Backend (Node.js)
- express: 4.x ✅
- jsonwebtoken: ✅
- bcryptjs: ✅
- pg (node-postgres): ✅
- ioredis: ✅
- socket.io: ✅
- bull (job queue): ✅

### Face AI Service (Python)
- flask: ✅
- flask-cors: ✅
- opencv-python (cv2): ✅
- numpy: ✅
- redis (py): ✅
- hashlib: ✅ (stdlib)

### Frontend (React)
- React 18.x: ✅
- TypeScript: ✅
- Vite: ✅
- Axios: ✅
- Socket.IO client: ✅

## Browser Requirements

| Feature | Browser Support |
|---------|----------------|
| WebRTC (camera) | Chrome 60+, Firefox 55+, Edge 79+, Safari 11+ |
| WebSocket | All modern browsers |
| ES2020 | Chrome 85+, Firefox 78+, Edge 85+, Safari 14+ |

## Environment Variables (Configured)

| Variable | Status |
|----------|--------|
| DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD | ✅ Set |
| REDIS_PASSWORD | ✅ Set |
| JWT_ACCESS_SECRET, JWT_REFRESH_SECRET | ✅ Set (64-char hex) |
| JWT_ACCESS_EXPIRY=15m, JWT_REFRESH_EXPIRY=7d | ✅ Set |
| FACE_AI_SERVICE_URL | ✅ Set |
| CORS_ORIGIN | ✅ Set |
| RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS | ✅ Set |

## ENVIRONMENT_REPORT: ✅ ALL COMPONENTS VERIFIED
