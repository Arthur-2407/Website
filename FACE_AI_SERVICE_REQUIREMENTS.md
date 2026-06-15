# Face AI Service - Production Requirements

## Overview
The Face AI Service provides face recognition, liveness detection, and anti-spoofing capabilities for the Attendance System. This document details the production requirements and security policies.

## ⚠️ CRITICAL SECURITY POLICY

### Mock Mode Restrictions
- **DEVELOPMENT ONLY**: Mock implementations are available only when `NODE_ENV != 'production'`
- **PRODUCTION MODE**: All face recognition endpoints require real ML model integration
- **DEFAULT BEHAVIOR**: When real models are not available in production, all endpoints return 501 (Not Implemented)

### Environment Variables
```bash
# Required in all environments
NODE_ENV=production  # Set to "production" for production deployments
FACE_RECOGNITION_MODE=real  # Only "real" is allowed in production

# Optional - defaults to localhost
REDIS_URL=redis://:password@host:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=securepassword

# Service configuration
PORT=8000
MODEL_PATH=/app/models
```

### Production Enforcement
1. If `NODE_ENV=production` and `FACE_RECOGNITION_MODE != 'real'`:
   - All face verification endpoints return HTTP 503 (Service Unavailable)
   - All face registration endpoints return HTTP 503 (Service Unavailable)
   - All liveness detection endpoints return HTTP 503 (Service Unavailable)
   - Critical security event is logged

2. If real models are not loaded:
   - All endpoints return HTTP 501 (Not Implemented)
   - Clear error messages indicate missing ML models

## API Endpoints

### POST /api/face-login
Face authentication endpoint for backend authentication flow.

**Requirements (Production):**
- Real face detection from video frames
- Liveness verification with challenge responses (blink, head turn, etc.)
- Anti-spoofing validation
- Face matching against stored embeddings
- Response must include `authenticated` flag based on all validations passing

**Mock Mode (Development):**
- Returns `authenticated: false` with warnings
- Clearly indicates MOCK_MODE in response

### POST /api/register-face
Face enrollment endpoint for initial face registration.

**Requirements (Production):**
- Real face detection from video frames
- Face quality validation
- Face embedding extraction
- Storage of face embedding (NOT raw images) in database
- Audit logging of enrollment action

**Mock Mode (Development):**
- Returns `registered: false` with warnings
- Does not store any face data

### POST /face/verify
Low-level face verification endpoint.

**Requirements (Production):**
- Real face matching against database embeddings
- Confidence score calculation
- Anti-spoofing validation

### POST /face/detect
Face detection endpoint.

**Requirements (Production):**
- Detect faces in provided image
- Return bounding boxes and confidence scores

### POST /face/liveness
Liveness detection endpoint.

**Requirements (Production):**
- Validate that provided frames are from a live person
- Detect anti-spoofing attacks (photos, videos, deepfakes)
- Challenge response validation

## Face Data Storage

### What MUST Be Stored
- Face embeddings (vector representation, NOT images)
- Enrollment timestamp
- Quality score metadata
- Update history (who, when, why)

### What MUST NOT Be Stored
- Raw face images (without encryption)
- Unprotected biometric data
- Screenshots or photos in production environment

## Integration Points

### Backend Authentication
The backend calls `/api/face-login` during the face authentication flow:
```
POST /api/face-login
{
  "frames": [...],
  "employeeId": "EMP001",
  "challengeType": "blink"
}

Response:
{
  "authenticated": true/false,
  "liveness_passed": true/false,
  "spoof_detected": true/false,
  "face_matched": true/false,
  "confidence": 0.0-1.0
}
```

## ML Model Requirements

For production deployment, you must integrate:

### 1. Face Detection Model
- Detects faces in images/video frames
- Returns bounding boxes and confidence scores
- Example: MTCNN, RetinaFace, YOLOv8-Face

### 2. Face Embedding Model
- Extracts face embeddings (embeddings vector)
- Must be consistent across frames
- Example: VGGFace2, ArcFace, FaceNet

### 3. Liveness Detection Model
- Validates that face is from a live person
- Detects spoofing attacks (photos, videos)
- Validates challenge responses (blink, smile, head movements)
- Example: PyLiveness, MediaPipe Face Detection

### 4. Anti-Spoof Model
- Detects replay attacks
- Validates frame consistency
- Example: FaceShifter detection, custom anti-spoof models

## Testing & Validation

### Development Testing
```bash
# Set development environment
NODE_ENV=development
FACE_RECOGNITION_MODE=mock

# All endpoints will return mock responses
# Real implementation NOT required
```

### Production Pre-flight Checks
```bash
1. Verify NODE_ENV=production
2. Verify FACE_RECOGNITION_MODE=real
3. Verify all ML models are loaded:
   - Call GET /health
   - Check for model loading errors in logs
4. Verify face detection works: POST /face/detect with test image
5. Verify face registration works: POST /api/register-face
6. Verify authentication works: POST /api/face-login
```

## Deployment Checklist

- [ ] All ML models downloaded and mounted to /app/models
- [ ] NODE_ENV set to 'production'
- [ ] FACE_RECOGNITION_MODE set to 'real'
- [ ] Redis connection verified and working
- [ ] Health check endpoint returns healthy status
- [ ] All face recognition endpoints tested
- [ ] Logs monitored for any "NOT IMPLEMENTED" errors
- [ ] Backup face recognition service configured
- [ ] Monitoring/alerting configured for 503 responses

## Error Handling

### Common Errors

#### HTTP 503 - Service Unavailable
- Cause: Production mode without real implementation
- Action: Load ML models and set FACE_RECOGNITION_MODE=real

#### HTTP 501 - Not Implemented
- Cause: Real models not loaded
- Action: Load ML models for face detection, embedding, and liveness

#### HTTP 400 - Bad Request
- Cause: Missing required fields (frames, employeeId)
- Action: Check request payload

#### HTTP 500 - Internal Server Error
- Cause: Processing error
- Action: Check logs for details

## Support & Documentation

- See `/face-ai-service/requirements.txt` for Python dependencies
- See Dockerfile for containerization details
- See architecture documentation for integration patterns

---

**Last Updated:** 2026-06-15
**Status:** Production-Ready (with ML model integration required)
