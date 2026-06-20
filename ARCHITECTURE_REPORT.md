# Phase 2 — Architecture Detection Report

This document reports the detected application architecture, frameworks, database systems, and reverse proxy routing specifications.

## 1. Stack Detection Summary

- **Frontend Framework**: React SPA (Single Page Application)
  - Built with: **Vite**, **TypeScript**, **React 18**
  - Libraries: Framer Motion (UI transitions), Recharts (data visualizations), React Icons, React Router DOM (client routes), React Webcam
- **Backend API Framework**: Node.js **Express.js**
  - Runtime: Node.js (v18+)
  - Packages: pg (PostgreSQL connection pool), redis (cache interface), socket.io (real-time WebSocket updates), helmet (security headers), express-rate-limit
- **Face AI Service**: Python **FastAPI / Uvicorn**
  - Libraries: OpenCV (image preprocessing), DeepFace (biometric model pipeline), TensorFlow / PyTorch backend, Uvicorn (ASGI web server)
- **Databases**:
  - Main DB: **PostgreSQL 15** (Relational storage)
  - Face DB: **PostgreSQL 15** (Dedicated biometric storage, pgvector compatible)
  - Cache: **Redis 7** (In-memory locks, rate limiter states, verification OTPs)
- **Infrastructure**:
  - Containerization: **Docker**
  - Orchestration: **Docker Compose**
  - Reverse Proxy: **Nginx**

---

## 2. Reverse Proxy Routing (Nginx)

The reverse proxy (`attendance-nginx-prod`) directs incoming host queries:

- `/` → Proxy to `http://frontend:80` (static React distribution SPA)
- `/api/` → Proxy to `http://backend-api:3001` (express API router, strips `/api` prefix)
- `/face-ai/` → Proxy to `http://face-ai-service:8000` (FastAPI endpoints, strips `/face-ai` prefix)

---

## 3. Data Pipelines & Flow

### Biometric Enrollment Flow
1. **Frontend**: Captures 10–20 webcam video frames as base64 images.
2. **Backend API**: Forwards request payload containing frames to Face AI service.
3. **Face AI Service**: preprocesses frames, checks quality/liveness (anti-spoof), computes 512-dimensional vector embedding.
4. **Main/Face DBs**: If admin, instantly registers; otherwise inserts request into `face_change_requests` for supervisor approval. Once approved, encrypts embedding and stores in the Face Database (`face_embeddings` table) and sets `face_enrolled = true` in the main database.

### Attendance Check-in Flow
1. **Frontend**: Captures check-in frame and checks device coordinates (Geo-location API).
2. **Backend API**: Validates geo-fence radius constraint against employee location configuration. Forwards frame to Face AI service.
3. **Face AI Service**: Compares check-in embedding with the employee's stored secure embedding template.
4. **Response**: If similarity exceeds configured threshold (typically `0.65`), checks in the employee and logs `attendance_records`. If spoofing or low similarity detected, triggers a high-severity alert in `security_events`.
