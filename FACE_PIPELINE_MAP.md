# FACE PIPELINE MAP

This document tracks the precise data flow and file involvement for face processing, from the browser camera to database storage and cosine-similarity verification.

---

## 1. Flow Diagram: Capture to Storage

```
[Browser Camera] ──> Frame Capture (data:image/jpeg;base64,...)
      │
      ▼
[BootstrapSetupPage.tsx] / [FaceLogin.tsx] ──> Strip header data (Base64 only)
      │
      ▼
[Express API Gateway] ──> HTTP POST /api/face-login OR /bootstrap/setup
      │
      ▼
[Flask face-ai-service] ──> HTTP POST /api/register-face OR /api/face-login
      │
      ├─► base64.b64decode() ──> np.frombuffer() ──> cv2.imdecode()
      ├─► FaceDetector.detect_faces() (MTCNN / FaceNet)
      ├─► LivenessDetector.analyze_liveness()
      ├─► SpoofDetector.detect_spoof()
      ├─► EmbeddingGenerator.generate_embedding() ──> 512-dim Float Vector
      │
      ▼
[Express API Gateway] ──> Persist embedding JSON.stringify() to DB
      │
      ▼
[PostgreSQL Database] ──> Saved in face_embeddings.embedding_vector (TEXT)
```

---

## 2. Component File Trace

### A. Frontend Layer (Capture and Format)
- **File:** [FaceCamera.tsx](file:///d:/Website/frontend/src/components/camera/FaceCamera.tsx)
  - Uses `useCamera()` hook to interface with hardware via `navigator.mediaDevices.getUserMedia`.
  - Captures video frames onto a virtual canvas and outputs standard data URLs (`data:image/jpeg;base64,...`).
- **File:** [BootstrapSetupPage.tsx](file:///d:/Website/frontend/src/pages/BootstrapSetupPage.tsx) / [FaceLogin.tsx](file:///d:/Website/frontend/src/components/FaceLogin.tsx)
  - Strips the data URL metadata prefix (`data:image/jpeg;base64,`) during frame capture/file upload.
  - Groups frames into a clean JSON string array for forwarding.

### B. Backend API Gateway Layer (Routing & Database Access)
- **File:** [routes.js](file:///d:/Website/backend-api/src/modules/auth/routes.js)
  - Handles `/api/auth/bootstrap/setup` and `/api/auth/face-login`.
  - Queries `face_embeddings` table to fetch the registered administrator embedding.
  - Forwards the frame arrays and reference embeddings to the Face AI microservice.

### C. Face AI Service Layer (Processing Models)
- **File:** [main.py](file:///d:/Website/face-ai-service/src/main.py)
  - Implements the API routes `/api/register-face` and `/api/face-login`.
  - **Frame Decoders:** Decodes base64 arrays into Numpy matrices (`cv2.imdecode`).
  - **Liveness Detection:** Evaluates temporal face landmarks across frame sequences to confirm physical presence.
  - **Spoof Detection:** Runs texture and reflection classification to detect screens/printouts.
  - **Feature Extraction:** Passes the cropped face through `InceptionResnetV1` (pre-trained on VGGFace2) to return a 512-dimensional float vector.
  - **Face Matching:** Calculates the cosine similarity score against the reference embedding (threshold: 0.65).
- **File:** [app.py](file:///d:/Website/face-ai-service/src/app.py)
  - Serves as the backup/mock implementation in development environments.
