# Phase 3 — Dependency Validation Audit

Created: 2026-06-21T00:45:00+05:30

This report documents the dependencies, potential conflicts, version pinning, and environment requirements for all application services.

---

## 1. Node.js Backend API Service (`backend-api`)

### Package Specifications (`package.json`)
- **Node.js Engines**: `>=18.0.0`
- **Core Production Dependencies**:
  - `express` (`^4.18.2`): Minimalist web framework.
  - `pg` (`^8.11.3`): PostgreSQL client pool.
  - `redis` (`^4.6.8`): In-memory datastore interface.
  - `jsonwebtoken` (`^9.0.2`), `bcryptjs` (`^2.4.3`): Auth token signing and password hashing.
  - `socket.io` (`^4.7.2`): Real-time WebSockets event server.
  - `multer` (`^1.4.5-lts.1`): File upload multipart body handling.
  - `helmet` (`^7.0.0`), `express-rate-limit` (`^6.8.1`): HTTP headers security and endpoint throttling.
- **Development Dependencies**:
  - `jest` (`^29.6.4`), `supertest` (`^6.3.3`): API testing suite.
  - `nodemon` (`^3.0.1`): Development file-watcher process execution.

### Evaluation & Risk Analysis
- **Version Compatibility**: Excellent. All production packages are mature and compatible with Node.js 18/20 LTS.
- **Dependency Conflicts**: None detected. Locks are cleanly resolved.
- **Missing Variables**: Relies on `.env` settings for PostgreSQL credentials and JWT secrets. Fallbacks are specified in `docker-compose.prod.yml`.

---

## 2. Node.js Frontend Service (`frontend`)

### Package Specifications (`package.json`)
- **Runtime Compiler**: TypeScript (`^5.2.2`), Vite (`^8.0.11`)
- **Core Production Dependencies**:
  - `react` / `react-dom` (`^18.2.0`): React UI components context library.
  - `react-router-dom` (`^6.21.0`): Client-side path routing.
  - `zustand` (`^4.4.7`): Lightweight state store (auth state, preferences).
  - `framer-motion` (`^10.16.16`): UI transitions and animations.
  - `recharts` (`^2.10.0`): Admin dash SVG analytics.
  - `react-webcam` (`^7.2.0`): Camera streaming abstraction.
  - `socket.io-client` (`^4.7.2`): WS connectivity.

### Evaluation & Risk Analysis
- **Vite Configuration**: Vite uses `vite.config.ts` to bundle outputs.
- **Build Output**: Building requires host execution because `frontend/Dockerfile.prod` copies pre-built static assets from the `dist/` directory directly, rather than building inside the container.
  > [!TIP]
  > Execute `npm run build` inside `/frontend` on the host (or prior build pipeline step) before triggering container builds.

---

## 3. Python Face AI Service (`face-ai-service`)

### Package Specifications (`requirements.txt`)
- **Runtime**: `Python 3.9` (slim image base).
- **Core AI/ML Stack**:
  - `tensorflow-cpu` (`==2.16.1`), `tf-keras` (`==2.16.0`), `keras` (`==3.0.5`): Deep learning engine.
  - `deepface` (`==0.0.92`): VGG-Face / Facenet biometric wrapper.
  - `facenet-pytorch` (`==2.6.0`): PyTorch implementation of FaceNet.
  - `retina-face` (`==0.0.17`): Deep face detection pipeline.
  - `mediapipe` (`==0.10.14`): Holistic face mesh landmarks (challenge liveness check).
  - `opencv-python-headless` (`==4.9.0.80`): Frame preprocessing without GUI modules.
  - `numpy` (`==1.26.4`), `scipy` (`==1.12.0`): Mathematical operations and vector algebra.
- **Web Service Framework**:
  - `flask` (`==3.0.2`), `flask-cors` (`==4.0.0`), `flask-socketio` (`==5.3.6`).
  - `eventlet` (`==0.35.2`): Concurrency daemon.

### Evaluation & Critical Fix Risk Analysis
- **Eventlet Thread Deadlock Warning**:
  > [!WARNING]
  > As noted in `main.py`, Eventlet monkey-patching is disabled inside the Python execution context. TensorFlow and PyTorch rely on native C++ threading pools. Forcing monkey-patching causes instant system deadlocks when multiple frames are processed concurrently.
- **TensorFlow vs CPU limitations**: Running full TensorFlow/Keras loops on lower-spec CPU-only servers can generate latency. Heavy deep learning models are optimized using `tensorflow-cpu` to limit binary sizes.

---

## 4. Environment Variables Checklist
The services require the following variables to be set in the deployment configuration:
- `DB_PASSWORD`: Password for main and face database.
- `REDIS_PASSWORD`: Password for the Redis client pool.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`: Crypto keys for token validation.
