"""
Face AI Service — Production Face Recognition System
Handles face detection, embedding generation, liveness detection, and anti-spoof verification.

SECURITY ARCHITECTURE:
  - Embeddings generated using DeepFace (ArcFace model) — deterministic, face-derived
  - Face comparison uses cosine similarity (NOT random)
  - Stored embeddings are passed FROM the backend (never looked up internally)
  - Liveness detection uses MediaPipe landmark analysis
  - Anti-spoof uses texture + frequency analysis
"""

import os
import cv2
import numpy as np
import json
import time
import base64
from datetime import datetime
from typing import Dict, List, Tuple, Optional
import logging

import eventlet
eventlet.monkey_patch()

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from face_detection.detector import FaceDetector
from liveness_detection.liveness_detector import LivenessDetector
from anti_spoof_detection.spoof_detector import SpoofDetector

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================================================
# REAL EMBEDDING GENERATOR (DeepFace / ArcFace)
# ============================================================================
class EmbeddingGenerator:
    """
    Generates 512-dimensional face embeddings using DeepFace with ArcFace model.
    ArcFace produces deterministic, identity-preserving embeddings from face images.
    """

    def __init__(self):
        self._model_loaded = False
        self._model_name = "ArcFace"
        logger.info("EmbeddingGenerator initializing with ArcFace model...")
        # Attempt to warm up DeepFace model on init
        try:
            import deepface.commons.functions as functions
            self._model_loaded = True
            logger.info("EmbeddingGenerator: DeepFace ArcFace model ready")
        except Exception as e:
            logger.warning(f"EmbeddingGenerator: DeepFace warm-up skipped ({e})")

    def generate_embedding(self, face_image: np.ndarray) -> Optional[np.ndarray]:
        """
        Generate a 512-dimensional ArcFace embedding from a face image.

        Args:
            face_image: BGR face crop (numpy array)

        Returns:
            numpy array of shape (512,) or None on failure
        """
        try:
            from deepface import DeepFace

            # DeepFace expects RGB
            if len(face_image.shape) == 3 and face_image.shape[2] == 3:
                rgb_face = cv2.cvtColor(face_image, cv2.COLOR_BGR2RGB)
            else:
                rgb_face = face_image

            # Resize to ArcFace input size (112x112)
            resized = cv2.resize(rgb_face, (112, 112))

            # Generate embedding — enforce_detection=False since we already detected the face
            result = DeepFace.represent(
                img_path=resized,
                model_name=self._model_name,
                enforce_detection=False,
                detector_backend="skip"
            )

            if result and isinstance(result, list) and len(result) > 0:
                embedding = np.array(result[0]["embedding"], dtype=np.float32)
                # Normalize to unit vector for stable cosine similarity
                norm = np.linalg.norm(embedding)
                if norm > 0:
                    embedding = embedding / norm
                logger.debug(f"Generated embedding: shape={embedding.shape}, norm={np.linalg.norm(embedding):.4f}")
                return embedding

            logger.warning("DeepFace returned empty result")
            return None

        except Exception as e:
            logger.error(f"Embedding generation failed: {e}", exc_info=True)
            return None


# ============================================================================
# REAL FACE MATCHER (Cosine Similarity)
# ============================================================================
class FaceMatcher:
    """
    Compares face embeddings using cosine similarity.
    Embeddings must be unit-normalized 512-dimensional vectors.
    """

    def compare_embeddings(self, emb1: np.ndarray, emb2: np.ndarray) -> Dict:
        """
        Compute cosine similarity between two face embeddings.

        Args:
            emb1: Query embedding (512,)
            emb2: Stored embedding (512,)

        Returns:
            Dict with 'similarity' (0.0–1.0) and 'match' (bool)
        """
        try:
            if emb1 is None or emb2 is None:
                return {"similarity": 0.0, "match": False, "error": "null_embedding"}

            if emb1.shape != emb2.shape:
                return {"similarity": 0.0, "match": False, "error": "shape_mismatch"}

            # Ensure unit vectors
            norm1 = np.linalg.norm(emb1)
            norm2 = np.linalg.norm(emb2)

            if norm1 == 0 or norm2 == 0:
                return {"similarity": 0.0, "match": False, "error": "zero_vector"}

            emb1_norm = emb1 / norm1
            emb2_norm = emb2 / norm2

            # Cosine similarity: dot product of unit vectors
            cosine_sim = float(np.dot(emb1_norm, emb2_norm))

            # Clamp to [0, 1]
            cosine_sim = max(0.0, min(1.0, cosine_sim))

            threshold = CONFIG["similarity_threshold"]
            match = cosine_sim >= threshold

            logger.info(f"Face comparison: similarity={cosine_sim:.4f}, threshold={threshold}, match={match}")
            return {"similarity": cosine_sim, "match": match}

        except Exception as e:
            logger.error(f"Face comparison error: {e}", exc_info=True)
            return {"similarity": 0.0, "match": False, "error": str(e)}


# ============================================================================
# REAL CHALLENGE VERIFIER (MediaPipe Blink Detection)
# ============================================================================
class ChallengeVerifier:
    """
    Verifies liveness challenges using facial landmark analysis.
    Uses MediaPipe Face Mesh for blink detection.
    """

    # MediaPipe eye landmark indices
    LEFT_EYE_LANDMARKS = [362, 385, 387, 263, 373, 380]
    RIGHT_EYE_LANDMARKS = [33, 160, 158, 133, 153, 144]
    EAR_BLINK_THRESHOLD = 0.22
    MIN_BLINKS_REQUIRED = 1

    def __init__(self):
        try:
            import mediapipe as mp
            self.mp_face_mesh = mp.solutions.face_mesh
            self._available = True
            logger.info("ChallengeVerifier: MediaPipe Face Mesh initialized")
        except Exception as e:
            logger.warning(f"ChallengeVerifier: MediaPipe unavailable ({e})")
            self._available = False

    def _eye_aspect_ratio(self, landmarks, eye_indices: List[int], img_w: int, img_h: int) -> float:
        """Calculate Eye Aspect Ratio for blink detection."""
        pts = []
        for idx in eye_indices:
            lm = landmarks.landmark[idx]
            pts.append((lm.x * img_w, lm.y * img_h))

        # Vertical distances
        A = np.linalg.norm(np.array(pts[1]) - np.array(pts[5]))
        B = np.linalg.norm(np.array(pts[2]) - np.array(pts[4]))
        # Horizontal distance
        C = np.linalg.norm(np.array(pts[0]) - np.array(pts[3]))

        if C == 0:
            return 0.0
        return (A + B) / (2.0 * C)

    def verify_challenge(self, faces: List[np.ndarray], challenge_type: str) -> Dict:
        """
        Verify a liveness challenge by analyzing blink patterns across frames.

        Args:
            faces: List of face frame crops
            challenge_type: Type of challenge (e.g., 'blink', 'challenge_1')

        Returns:
            Dict with 'passed' (bool) and 'confidence' (float)
        """
        if not self._available or not faces:
            # Cannot verify challenge without MediaPipe
            return {"passed": False, "confidence": 0.0, "reason": "Challenge verifier unavailable"}

        try:
            import mediapipe as mp
            face_mesh = self.mp_face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5
            )

            ear_values = []
            for face in faces:
                h, w = face.shape[:2]
                rgb = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
                result = face_mesh.process(rgb)

                if result.multi_face_landmarks:
                    lm = result.multi_face_landmarks[0]
                    left_ear = self._eye_aspect_ratio(lm, self.LEFT_EYE_LANDMARKS, w, h)
                    right_ear = self._eye_aspect_ratio(lm, self.RIGHT_EYE_LANDMARKS, w, h)
                    ear_values.append((left_ear + right_ear) / 2.0)

            face_mesh.close()

            if len(ear_values) < 3:
                return {"passed": False, "confidence": 0.0, "reason": "Insufficient landmark data"}

            # Count blinks (EAR drops below threshold then rises)
            blink_count = 0
            in_blink = False
            for ear in ear_values:
                if ear < self.EAR_BLINK_THRESHOLD:
                    if not in_blink:
                        blink_count += 1
                        in_blink = True
                else:
                    in_blink = False

            passed = blink_count >= self.MIN_BLINKS_REQUIRED
            confidence = min(blink_count / 3.0, 1.0) if passed else 0.2

            logger.info(f"Challenge verification: blinks={blink_count}, passed={passed}")
            return {
                "passed": passed,
                "confidence": confidence,
                "reason": f"Detected {blink_count} blink(s)"
            }

        except Exception as e:
            logger.error(f"Challenge verification error: {e}", exc_info=True)
            return {"passed": False, "confidence": 0.0, "reason": str(e)}


# ============================================================================
# CONFIGURATION
# ============================================================================
CONFIG = {
    "multi_frame_count": 15,
    "frame_interval_ms": 100,
    "liveness_threshold": 0.70,   # Minimum liveness confidence
    "spoof_threshold": 0.30,       # Maximum allowed spoof confidence
    "similarity_threshold": 0.65,  # Minimum cosine similarity for face match
    "challenge_timeout": 30,
    "max_face_size": 1024,
    "min_face_size": 48,
    "min_embedding_dim": 512,
}

# ============================================================================
# INITIALIZE COMPONENTS
# ============================================================================
face_detector = FaceDetector()
liveness_detector = LivenessDetector()
challenge_verifier = ChallengeVerifier()
spoof_detector = SpoofDetector()
embedding_generator = EmbeddingGenerator()
face_matcher = FaceMatcher()


# ============================================================================
# AUTHENTICATION PIPELINE
# ============================================================================
class FaceAuthenticationPipeline:
    """
    Complete face authentication pipeline with anti-spoof protection.

    SECURITY MODEL:
    - The stored embedding is passed IN from the backend (queried from DB)
    - The AI service NEVER looks up embeddings internally
    - This prevents the AI service from bypassing the DB security layer
    """

    def __init__(self, config: Dict):
        self.config = config
        self.logger = logging.getLogger(__name__)

    def process_face_login(
        self,
        video_frames: List[np.ndarray],
        employee_id: str,
        stored_embedding: Optional[List[float]] = None,
        challenge_type: Optional[str] = None
    ) -> Dict:
        """
        Complete face authentication pipeline.

        Args:
            video_frames: List of decoded video frames
            employee_id: Employee identifier (for logging only)
            stored_embedding: The employee's registered face embedding (from DB)
            challenge_type: Optional liveness challenge type

        Returns:
            Authentication result dict
        """
        result = {
            "authenticated": False,
            "confidence": 0.0,
            "liveness_passed": False,
            "spoof_detected": False,
            "challenge_passed": False,
            "face_matched": False,
            "errors": [],
            "timestamps": {},
            "security_events": [],
            "spoof_confidence": 0.0,
        }

        start_time = time.time()

        try:
            # ──────────────────────────────────────────────
            # GATE 0: Validate stored embedding exists
            # ──────────────────────────────────────────────
            if stored_embedding is None:
                result["errors"].append("No registered face embedding found for this employee")
                result["security_events"].append("NO_REGISTERED_EMBEDDING")
                result["timestamps"]["total"] = time.time() - start_time
                return result

            stored_np = np.array(stored_embedding, dtype=np.float32)
            if stored_np.shape[0] < self.config["min_embedding_dim"]:
                result["errors"].append("Stored embedding is corrupted or invalid")
                result["security_events"].append("CORRUPTED_STORED_EMBEDDING")
                result["timestamps"]["total"] = time.time() - start_time
                return result

            # ──────────────────────────────────────────────
            # STEP 1: Face Detection
            # ──────────────────────────────────────────────
            self.logger.info(f"Starting face authentication for employee: {employee_id}")

            faces_detected = []
            face_boxes = []

            for frame in video_frames[:self.config["multi_frame_count"]]:
                if frame is None:
                    continue
                faces, boxes = face_detector.detect_faces(frame)
                if faces:
                    faces_detected.append(faces[0])
                    face_boxes.append(boxes[0])

            if not faces_detected:
                result["errors"].append("No face detected in provided frames")
                result["security_events"].append("NO_FACE_DETECTED")
                result["timestamps"]["total"] = time.time() - start_time
                return result

            # Reject if multiple faces detected in most frames
            multi_face_count = 0
            for frame in video_frames[:self.config["multi_frame_count"]]:
                if frame is None:
                    continue
                faces, _ = face_detector.detect_faces(frame)
                if len(faces) > 1:
                    multi_face_count += 1

            if multi_face_count > len(video_frames) * 0.3:
                result["errors"].append("Multiple faces detected — cannot authenticate")
                result["security_events"].append("MULTIPLE_FACES_DETECTED")
                result["timestamps"]["total"] = time.time() - start_time
                return result

            result["timestamps"]["face_detection"] = time.time() - start_time

            # ──────────────────────────────────────────────
            # STEP 2: Anti-Spoof Detection (before liveness)
            # ──────────────────────────────────────────────
            spoof_start = time.time()
            spoof_result = spoof_detector.detect_spoof(faces_detected)

            result["spoof_confidence"] = float(spoof_result.get("spoof_confidence", 0.0))

            if spoof_result["spoof_confidence"] > self.config["spoof_threshold"]:
                result["spoof_detected"] = True
                result["errors"].append(
                    f"Spoof attempt detected: {spoof_result['detection_type']} "
                    f"(confidence={spoof_result['spoof_confidence']:.2f})"
                )
                result["security_events"].append("SPOOF_DETECTED")
                result["security_events"].append(spoof_result["detection_type"])
                self.logger.warning(
                    f"SECURITY: Spoof detected for {employee_id}: "
                    f"type={spoof_result['detection_type']}, "
                    f"confidence={spoof_result['spoof_confidence']:.2f}"
                )
                result["timestamps"]["spoof_detection"] = time.time() - spoof_start
                result["timestamps"]["total"] = time.time() - start_time
                return result

            result["timestamps"]["spoof_detection"] = time.time() - spoof_start

            # ──────────────────────────────────────────────
            # STEP 3: Liveness Detection
            # ──────────────────────────────────────────────
            liveness_start = time.time()
            liveness_result = liveness_detector.analyze_liveness(faces_detected)

            liveness_confidence = liveness_result.get("confidence", 0.0)
            result["liveness_passed"] = liveness_confidence >= self.config["liveness_threshold"]

            if not result["liveness_passed"]:
                result["errors"].append(
                    f"Liveness check failed: confidence={liveness_confidence:.2f} "
                    f"(required={self.config['liveness_threshold']})"
                )
                result["security_events"].append("LIVENESS_FAILED")
                result["confidence"] = liveness_confidence

            result["timestamps"]["liveness_detection"] = time.time() - liveness_start

            # ──────────────────────────────────────────────
            # STEP 4: Challenge-Response (optional)
            # ──────────────────────────────────────────────
            if challenge_type and result["liveness_passed"]:
                challenge_start = time.time()
                challenge_result = challenge_verifier.verify_challenge(faces_detected, challenge_type)

                result["challenge_passed"] = challenge_result["passed"]
                if not challenge_result["passed"]:
                    result["errors"].append(f"Challenge failed: {challenge_result.get('reason', 'unknown')}")
                    result["security_events"].append("CHALLENGE_FAILED")

                result["timestamps"]["challenge_verification"] = time.time() - challenge_start

            # ──────────────────────────────────────────────
            # STEP 5: Face Embedding + Matching
            # ──────────────────────────────────────────────
            if result["liveness_passed"] and not result["spoof_detected"]:
                embedding_start = time.time()

                # Select clearest face for embedding generation
                clearest_face = self._select_clearest_face(faces_detected)

                # Generate embedding from current frame using ArcFace
                current_embedding = embedding_generator.generate_embedding(clearest_face)

                if current_embedding is None:
                    result["errors"].append("Failed to generate face embedding from frames")
                    result["security_events"].append("EMBEDDING_GENERATION_FAILED")
                    result["timestamps"]["total"] = time.time() - start_time
                    return result

                # Compare against stored embedding (passed from backend DB)
                match_result = face_matcher.compare_embeddings(current_embedding, stored_np)

                result["face_matched"] = match_result["match"]
                similarity = match_result["similarity"]

                if result["face_matched"]:
                    result["confidence"] = max(result.get("confidence", 0.0), similarity)
                    self.logger.info(
                        f"Face MATCHED for {employee_id}: similarity={similarity:.4f}"
                    )
                else:
                    result["errors"].append(
                        f"Face mismatch: similarity={similarity:.4f} "
                        f"(threshold={self.config['similarity_threshold']})"
                    )
                    result["security_events"].append("FACE_MISMATCH")
                    self.logger.warning(
                        f"Face MISMATCH for {employee_id}: similarity={similarity:.4f}"
                    )

                result["timestamps"]["face_matching"] = time.time() - embedding_start

            # ──────────────────────────────────────────────
            # STEP 6: Final Decision — ALL gates must pass
            # ──────────────────────────────────────────────
            all_passed = (
                result["liveness_passed"]
                and not result["spoof_detected"]
                and result["face_matched"]
                and (not challenge_type or result["challenge_passed"])
            )

            result["authenticated"] = all_passed

            if all_passed:
                self.logger.info(
                    f"Authentication SUCCESS for {employee_id}: "
                    f"confidence={result['confidence']:.4f}"
                )
            else:
                self.logger.warning(
                    f"Authentication FAILED for {employee_id}: "
                    f"liveness={result['liveness_passed']}, "
                    f"spoof={result['spoof_detected']}, "
                    f"matched={result['face_matched']}"
                )

            result["timestamps"]["total"] = time.time() - start_time

        except Exception as e:
            self.logger.error(f"Authentication pipeline error: {e}", exc_info=True)
            result["errors"].append(f"Pipeline error: {str(e)}")
            result["security_events"].append("PIPELINE_ERROR")
            result["timestamps"]["total"] = time.time() - start_time

        return result

    def _select_clearest_face(self, faces: List[np.ndarray]) -> np.ndarray:
        """Select the sharpest face based on Laplacian variance."""
        if len(faces) == 1:
            return faces[0]
        variances = []
        for face in faces:
            gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY) if len(face.shape) == 3 else face
            lap = cv2.Laplacian(gray, cv2.CV_64F)
            variances.append(np.var(lap))
        return faces[int(np.argmax(variances))]


# ============================================================================
# INITIALIZE PIPELINE
# ============================================================================
pipeline = FaceAuthenticationPipeline(CONFIG)

# ============================================================================
# FLASK APP
# ============================================================================
app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')


@socketio.on('connect')
def handle_connect():
    logger.info('Client connected')
    emit('connected', {'message': 'Connected to Face AI Service'})


@socketio.on('disconnect')
def handle_disconnect():
    logger.info('Client disconnected')


# ============================================================================
# HEALTH CHECK
# ============================================================================
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'face-ai-service',
        'timestamp': datetime.now().isoformat(),
        'components': {
            'face_detector': 'operational',
            'liveness_detector': 'operational',
            'spoof_detector': 'operational',
            'embedding_generator': 'operational',
            'face_matcher': 'operational',
            'challenge_verifier': 'operational',
        },
        'config': {
            'similarity_threshold': CONFIG['similarity_threshold'],
            'liveness_threshold': CONFIG['liveness_threshold'],
            'spoof_threshold': CONFIG['spoof_threshold'],
        }
    }), 200


# ============================================================================
# FACE LOGIN — accepts stored_embedding from backend
# ============================================================================
@app.route('/api/face-login', methods=['POST'])
def face_login():
    """
    Face authentication endpoint.

    Expected body:
    {
        "frames": ["<base64-encoded JPEG>", ...],
        "employee_id": "EMP001",
        "stored_embedding": [0.1, 0.2, ...],  ← Required: from backend DB query
        "challenge_type": "blink"              ← Optional
    }
    """
    try:
        data = request.json

        if not data:
            return jsonify({'error': 'Request body required', 'code': 'INVALID_REQUEST'}), 400

        required = ['frames', 'employee_id', 'stored_embedding']
        missing = [f for f in required if f not in data or data[f] is None]
        if missing:
            return jsonify({
                'error': f'Missing required fields: {", ".join(missing)}',
                'code': 'MISSING_FIELDS',
                'authenticated': False,
                'spoof_confidence': 0.0,
            }), 400

        frames_raw = data.get('frames', [])
        employee_id = data.get('employee_id', 'unknown')
        stored_embedding_raw = data.get('stored_embedding')
        challenge_type = data.get('challenge_type') or data.get('challengeType')

        if not frames_raw:
            return jsonify({
                'error': 'No frames provided',
                'code': 'NO_FRAMES',
                'authenticated': False,
                'spoof_confidence': 0.0,
            }), 400

        # Validate stored embedding
        if not isinstance(stored_embedding_raw, list) or len(stored_embedding_raw) < CONFIG['min_embedding_dim']:
            return jsonify({
                'error': 'Invalid or empty stored embedding — employee must re-enroll face',
                'code': 'INVALID_STORED_EMBEDDING',
                'authenticated': False,
                'spoof_confidence': 0.0,
            }), 400

        # Decode frames
        frames = []
        decode_errors = 0
        for frame_data in frames_raw[:CONFIG['multi_frame_count']]:
            try:
                frame_bytes = base64.b64decode(frame_data)
                nparr = np.frombuffer(frame_bytes, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if frame is not None:
                    frames.append(frame)
            except Exception:
                decode_errors += 1

        if not frames:
            return jsonify({
                'error': 'All frames failed to decode',
                'code': 'FRAME_DECODE_ERROR',
                'authenticated': False,
                'spoof_confidence': 0.0,
            }), 400

        if decode_errors > 0:
            logger.warning(f"[face-login] {decode_errors} frames failed to decode for {employee_id}")

        # Run authentication pipeline
        result = pipeline.process_face_login(
            video_frames=frames,
            employee_id=employee_id,
            stored_embedding=stored_embedding_raw,
            challenge_type=challenge_type
        )

        # Ensure spoof_confidence is always present
        if 'spoof_confidence' not in result:
            result['spoof_confidence'] = 0.0

        # Log security events
        if result.get('security_events'):
            logger.warning(
                f"Security events for {employee_id}: {result['security_events']}"
            )

        return jsonify(result), 200

    except Exception as e:
        logger.error(f"Face login endpoint error: {e}", exc_info=True)
        return jsonify({
            'error': 'Internal server error',
            'code': 'INTERNAL_ERROR',
            'authenticated': False,
            'spoof_confidence': 0.0,
        }), 500


# ============================================================================
# REGISTER FACE — returns actual embedding vector
# ============================================================================
@app.route('/api/register-face', methods=['POST'])
def register_face():
    """
    Face enrollment endpoint.

    Expected body:
    {
        "frames": ["<base64-encoded JPEG>", ...],
        "employee_id": "EMP001"
    }

    Returns:
    {
        "success": true,
        "embedding": [0.1, 0.2, ...],  ← The actual 512-float embedding vector
        "embedding_dim": 512,
        "quality_score": 0.92,
        "model_version": "arcface-1.0",
        "employee_id": "EMP001"
    }
    """
    try:
        data = request.json

        if not data or 'frames' not in data or 'employee_id' not in data:
            return jsonify({
                'error': 'Missing required fields: frames, employee_id',
                'code': 'INVALID_REQUEST'
            }), 400

        frames_raw = data.get('frames', [])
        employee_id = data.get('employee_id', data.get('employeeId', 'unknown'))

        if not frames_raw:
            return jsonify({'error': 'No frames provided', 'code': 'NO_FRAMES'}), 400

        # Decode frames
        frames = []
        for frame_data in frames_raw[:10]:
            try:
                frame_bytes = base64.b64decode(frame_data)
                nparr = np.frombuffer(frame_bytes, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if frame is not None:
                    frames.append(frame)
            except Exception:
                pass

        if not frames:
            return jsonify({'error': 'All frames failed to decode', 'code': 'FRAME_DECODE_ERROR'}), 400

        # Detect faces across frames
        faces = []
        for frame in frames:
            detected_faces, _ = face_detector.detect_faces(frame)
            if detected_faces:
                faces.append(detected_faces[0])

        if not faces:
            return jsonify({
                'error': 'No face detected in provided frames. Please ensure your face is clearly visible.',
                'code': 'NO_FACE_DETECTED',
                'registered': False,
            }), 400

        # Reject multiple faces
        multi_face_frames = sum(
            1 for frame in frames
            if len(face_detector.detect_faces(frame)[0]) > 1
        )
        if multi_face_frames > len(frames) * 0.3:
            return jsonify({
                'error': 'Multiple faces detected. Please ensure only one face is visible.',
                'code': 'MULTIPLE_FACES',
                'registered': False,
            }), 400

        # Generate embedding from the clearest detected face
        clearest_face = pipeline._select_clearest_face(faces)
        embedding = embedding_generator.generate_embedding(clearest_face)

        if embedding is None:
            return jsonify({
                'error': 'Failed to generate face embedding. Please try with better lighting.',
                'code': 'EMBEDDING_GENERATION_FAILED',
                'registered': False,
            }), 400

        # Calculate quality score based on face clarity
        gray = cv2.cvtColor(clearest_face, cv2.COLOR_BGR2GRAY)
        laplacian_var = np.var(cv2.Laplacian(gray, cv2.CV_64F))
        quality_score = min(laplacian_var / 500.0, 1.0)

        embedding_list = embedding.tolist()

        logger.info(
            f"Face enrolled for {employee_id}: "
            f"embedding_dim={len(embedding_list)}, "
            f"quality={quality_score:.3f}, "
            f"faces_processed={len(faces)}"
        )

        return jsonify({
            'success': True,
            'registered': True,
            'employee_id': employee_id,
            'embedding': embedding_list,          # ← The actual embedding vector
            'face_embedding': embedding_list,     # ← Alias for backward compatibility
            'embedding_dim': len(embedding_list),
            'quality_score': round(quality_score, 4),
            'model_version': 'arcface-1.0',
            'timestamp': datetime.now().isoformat(),
        }), 200

    except Exception as e:
        logger.error(f"Face registration error: {e}", exc_info=True)
        return jsonify({
            'error': 'Internal server error',
            'code': 'INTERNAL_ERROR',
            'registered': False,
        }), 500


if __name__ == '__main__':
    port = int(os.getenv('PORT', 8000))
    logger.info(f"Starting Face AI Service on port {port}")
    socketio.run(app, host='0.0.0.0', port=port, debug=False)