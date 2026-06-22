"""
Multi-Frame Liveness Detection Module
Detects live faces by analyzing:
  1. Blink detection          (EAR via MediaPipe landmarks)
  2. Head movement            (nose/eye centroid displacement)
  3. Depth variation          (focus/Laplacian variance change)
  4. Micro-texture variation  (LBP histogram drift — video replay defence)
  5. Optical flow naturalness (irregular aperiodic motion — video replay defence)

Video replay attack defence:
  Methods 4 and 5 specifically target the case where an attacker plays a video
  of the real user. A video contains blinks and head movement (methods 1–2 pass),
  but it cannot replicate the biologically-driven irregularity of live skin:
  - Micro-texture: living skin has subtle surface changes (blood flow, micro-muscle)
    that produce LBP histogram drift with high inter-frame variance. A video replay
    shows artificially periodic or static texture change.
  - Optical flow naturalness: live faces produce aperiodic, high-entropy flow fields.
    Video replays produce smooth, low-entropy, temporally regular motion.
"""

import cv2
import numpy as np
from typing import List, Dict, Tuple, Optional
import logging
import os
from scipy import signal
from scipy.spatial import distance

try:
    import mediapipe as mp
    _MP_AVAILABLE = True
except ImportError:
    mp = None
    _MP_AVAILABLE = False

logger = logging.getLogger(__name__)


class LivenessDetector:
    """Detects liveness through multi-frame analysis with video-replay defence."""

    def __init__(self):
        # ── MediaPipe Face Mesh ──────────────────────────────────────
        if _MP_AVAILABLE:
            self.mp_face_mesh = mp.solutions.face_mesh
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=True,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        else:
            self.face_mesh = None
            logger.warning("mediapipe not available — blink/head-movement detection disabled")

        # Eye landmarks indices (MediaPipe)
        self.LEFT_EYE_INDICES = list(range(33, 161))
        self.RIGHT_EYE_INDICES = list(range(362, 471))

        # ── Thresholds ───────────────────────────────────────────────
        self.EYE_AR_THRESHOLD = float(os.getenv("FACE_AI_EAR_THRESHOLD", "0.25"))
        self.EYE_AR_CONSEC_FRAMES = 2
        self.HEAD_MOVEMENT_THRESHOLD = float(os.getenv("FACE_AI_HEAD_MOVEMENT_THRESHOLD", "0.02"))

        # Micro-texture: minimum inter-frame LBP histogram variance to be
        # considered "live" — replays show lower variance (too regular).
        self.MICRO_TEXTURE_VAR_THRESHOLD = float(
            os.getenv("FACE_AI_MICRO_TEXTURE_VAR_THRESHOLD", "0.0003")
        )

        # Optical flow naturalness: minimum flow entropy to be "live".
        # Replays produce lower entropy (smoother, more uniform motion).
        self.FLOW_ENTROPY_THRESHOLD = float(
            os.getenv("FACE_AI_FLOW_ENTROPY_THRESHOLD", "1.8")
        )

        # Overall liveness confidence threshold (used by pipeline, mirrored here)
        self.liveness_threshold = float(os.getenv("FACE_AI_LIVENESS_THRESHOLD", "0.65"))

        logger.info(
            "LivenessDetector initialised | ear=%.2f head_move=%.3f "
            "micro_tex_var=%.5f flow_entropy=%.2f liveness_thresh=%.2f",
            self.EYE_AR_THRESHOLD,
            self.HEAD_MOVEMENT_THRESHOLD,
            self.MICRO_TEXTURE_VAR_THRESHOLD,
            self.FLOW_ENTROPY_THRESHOLD,
            self.liveness_threshold,
        )

    # ──────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────

    def analyze_liveness(self, face_frames: List[np.ndarray]) -> Dict:
        """
        Analyze multiple frames for liveness detection.

        Args:
            face_frames: List of cropped face images (BGR).
                         Minimum 3 required; 8–15 recommended.

        Returns:
            {
              "confidence":             float [0, 1],
              "blink_detected":         bool,
              "head_movement_detected": bool,
              "depth_variation_detected": bool,
              "micro_texture_live":     bool,
              "flow_naturalness_live":  bool,
              "liveness_confidence":    float (same as confidence — alias for DB)
              "reasons":                [str]
            }
        """
        if len(face_frames) < 3:
            return {
                "confidence": 0.0,
                "liveness_confidence": 0.0,
                "blink_detected": False,
                "head_movement_detected": False,
                "depth_variation_detected": False,
                "micro_texture_live": False,
                "flow_naturalness_live": False,
                "reasons": ["Insufficient frames for liveness analysis"],
            }

        results = {
            "confidence": 0.0,
            "liveness_confidence": 0.0,
            "blink_detected": False,
            "head_movement_detected": False,
            "depth_variation_detected": False,
            "micro_texture_live": False,
            "flow_naturalness_live": False,
            "eye_aspect_ratios": [],
            "head_positions": [],
            "reasons": [],
        }

        try:
            # ── Methods 1 & 2: MediaPipe-based (blink + head movement) ─
            if self.face_mesh is not None:
                for frame in face_frames:
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    mp_result = self.face_mesh.process(rgb_frame)
                    if mp_result.multi_face_landmarks:
                        landmarks = mp_result.multi_face_landmarks[0]
                        results["eye_aspect_ratios"].append(
                            self._calculate_eye_aspect_ratio(landmarks)
                        )
                        results["head_positions"].append(
                            self._calculate_head_position(landmarks)
                        )
                    else:
                        results["eye_aspect_ratios"].append(0.0)
                        results["head_positions"].append((0.0, 0.0, 0.0))
            else:
                # No MediaPipe — fill with neutral values
                results["eye_aspect_ratios"] = [0.3] * len(face_frames)
                results["head_positions"] = [(0.5, 0.5, 0.1)] * len(face_frames)

            blink_analysis = self._analyze_blink_pattern(results["eye_aspect_ratios"])
            results["blink_detected"] = blink_analysis["blink_detected"]
            results["blink_count"] = blink_analysis["blink_count"]

            head_movement = self._analyze_head_movement(results["head_positions"])
            results["head_movement_detected"] = head_movement["movement_detected"]
            results["head_movement_magnitude"] = head_movement["movement_magnitude"]

            # ── Method 3: Depth variation (focus change) ─────────────
            depth_variation = self._analyze_depth_variation(face_frames)
            results["depth_variation_detected"] = depth_variation["variation_detected"]
            results["depth_variation_score"] = depth_variation["variation_score"]

            # ── Method 4: Micro-texture variation (video replay defence)
            micro_texture = self._analyze_micro_texture_variation(face_frames)
            results["micro_texture_live"] = micro_texture["is_live"]
            results["micro_texture_variance"] = micro_texture["inter_frame_variance"]

            # ── Method 5: Optical flow naturalness (video replay defence)
            flow_naturalness = self._analyze_optical_flow_naturalness(face_frames)
            results["flow_naturalness_live"] = flow_naturalness["is_live"]
            results["flow_entropy"] = flow_naturalness["mean_entropy"]

            # ── Confidence fusion ────────────────────────────────────
            confidence = self._calculate_confidence(
                blink_analysis,
                head_movement,
                depth_variation,
                micro_texture,
                flow_naturalness,
            )
            results["confidence"] = confidence
            results["liveness_confidence"] = confidence  # alias for DB persistence

            # ── Reasons for low confidence ───────────────────────────
            if confidence < self.liveness_threshold:
                if not blink_analysis["blink_detected"]:
                    results["reasons"].append("No blink detected")
                if not head_movement["movement_detected"]:
                    results["reasons"].append("Insufficient head movement")
                if not depth_variation["variation_detected"]:
                    results["reasons"].append("Suspicious depth pattern")
                if not micro_texture["is_live"]:
                    results["reasons"].append("Micro-texture too static (possible video replay)")
                if not flow_naturalness["is_live"]:
                    results["reasons"].append("Unnatural optical flow (possible video replay)")

            logger.info(
                "Liveness analysis | confidence=%.4f blinks=%d head_move=%.4f "
                "micro_tex_var=%.6f flow_entropy=%.4f",
                confidence,
                blink_analysis["blink_count"],
                head_movement["movement_magnitude"],
                micro_texture["inter_frame_variance"],
                flow_naturalness["mean_entropy"],
            )

        except Exception as exc:
            logger.error("Liveness analysis error: %s", str(exc), exc_info=True)
            results["reasons"].append(f"Analysis error: {str(exc)}")

        return results

    # ──────────────────────────────────────────────────────────────────
    # Method 1 helpers: Blink detection
    # ──────────────────────────────────────────────────────────────────

    def _calculate_eye_aspect_ratio(self, landmarks) -> float:
        """Eye Aspect Ratio (EAR) for blink detection."""
        try:
            left_pts = [(landmarks.landmark[idx].x, landmarks.landmark[idx].y)
                        for idx in self.LEFT_EYE_INDICES[:6]]
            right_pts = [(landmarks.landmark[idx].x, landmarks.landmark[idx].y)
                         for idx in self.RIGHT_EYE_INDICES[:6]]
            return (self._ear_single(left_pts) + self._ear_single(right_pts)) / 2.0
        except Exception as exc:
            logger.error("EAR calculation error: %s", str(exc))
            return 0.0

    def _ear_single(self, eye_points: List[Tuple[float, float]]) -> float:
        if len(eye_points) < 6:
            return 0.0
        A = distance.euclidean(eye_points[1], eye_points[5])
        B = distance.euclidean(eye_points[2], eye_points[4])
        C = distance.euclidean(eye_points[0], eye_points[3])
        return (A + B) / (2.0 * C + 1e-7)

    def _calculate_head_position(self, landmarks) -> Tuple[float, float, float]:
        try:
            nose = landmarks.landmark[1]
            l_eye = landmarks.landmark[33]
            r_eye = landmarks.landmark[263]
            cx = (nose.x + l_eye.x + r_eye.x) / 3.0
            cy = (nose.y + l_eye.y + r_eye.y) / 3.0
            eye_dist = abs(l_eye.x - r_eye.x)
            return (cx, cy, eye_dist)
        except Exception as exc:
            logger.error("Head position error: %s", str(exc))
            return (0.0, 0.0, 0.0)

    def _analyze_blink_pattern(self, ear_values: List[float]) -> Dict:
        if len(ear_values) < 5:
            return {"blink_detected": False, "blink_count": 0, "blink_frequency": 0.0}

        blink_count = 0
        for i in range(1, len(ear_values) - 1):
            if (ear_values[i] < self.EYE_AR_THRESHOLD and
                    ear_values[i - 1] >= self.EYE_AR_THRESHOLD):
                consecutive = sum(
                    1 for j in range(i, min(i + 5, len(ear_values)))
                    if ear_values[j] < self.EYE_AR_THRESHOLD
                )
                if consecutive >= self.EYE_AR_CONSEC_FRAMES:
                    blink_count += 1

        total = len(ear_values)
        return {
            "blink_detected": blink_count > 0,
            "blink_count": blink_count,
            "blink_frequency": (blink_count / total) * 30,
        }

    def _analyze_head_movement(self, head_positions: List[Tuple]) -> Dict:
        if len(head_positions) < 3:
            return {"movement_detected": False, "movement_magnitude": 0.0}

        movements = [
            np.sqrt(sum((head_positions[i][k] - head_positions[i - 1][k]) ** 2 for k in range(3)))
            for i in range(1, len(head_positions))
        ]
        avg = float(np.mean(movements)) if movements else 0.0
        return {
            "movement_detected": avg > self.HEAD_MOVEMENT_THRESHOLD,
            "movement_magnitude": avg,
        }

    # ──────────────────────────────────────────────────────────────────
    # Method 3: Depth variation
    # ──────────────────────────────────────────────────────────────────

    def _analyze_depth_variation(self, face_frames: List[np.ndarray]) -> Dict:
        if len(face_frames) < 3:
            return {"variation_detected": False, "variation_score": 0.0}
        try:
            focus_scores = []
            for f in face_frames:
                gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if len(f.shape) == 3 else f
                lap = cv2.Laplacian(gray, cv2.CV_64F)
                focus_scores.append(np.var(lap))

            focus_range = max(focus_scores) - min(focus_scores)
            avg_focus = np.mean(focus_scores)
            var_score = focus_range / (avg_focus + 1e-7) if avg_focus > 0 else 0.0

            return {
                "variation_detected": var_score > 0.05,
                "variation_score": float(var_score),
            }
        except Exception as exc:
            logger.error("Depth variation error: %s", str(exc))
            return {"variation_detected": False, "variation_score": 0.0}

    # ──────────────────────────────────────────────────────────────────
    # Method 4: Micro-texture variation (video replay defence)
    # ──────────────────────────────────────────────────────────────────

    def _analyze_micro_texture_variation(self, face_frames: List[np.ndarray]) -> Dict:
        """
        Compare LBP histograms across consecutive frames.

        Live skin changes subtly between frames due to blood-flow and
        micro-muscle activity → high inter-frame histogram variance.
        A video replay of live video has artificially periodic or too-regular
        micro-texture changes → lower histogram variance.
        A static photo has near-zero inter-frame texture change.
        """
        if len(face_frames) < 3:
            return {
                "is_live": False,
                "inter_frame_variance": 0.0,
                "reason": "insufficient_frames",
            }
        try:
            target_size = (64, 64)
            lbp_hists = []
            for f in face_frames:
                gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if len(f.shape) == 3 else f
                gray = cv2.resize(gray, target_size)
                lbp = self._calculate_lbp(gray)
                hist, _ = np.histogram(lbp.ravel(), bins=64, range=(0, 256))
                hist = hist.astype(float) / (hist.sum() + 1e-7)
                lbp_hists.append(hist)

            # Inter-frame L1 distances between consecutive histograms
            dists = [
                float(np.sum(np.abs(lbp_hists[i] - lbp_hists[i - 1])))
                for i in range(1, len(lbp_hists))
            ]
            inter_frame_variance = float(np.var(dists)) if len(dists) > 1 else 0.0
            mean_dist = float(np.mean(dists)) if dists else 0.0

            # Live: high mean distance AND high variance (irregular changes)
            # Photo: near-zero mean distance
            # Video replay: moderate mean distance but LOW variance (too regular)
            is_live = (
                mean_dist > 0.005 and
                inter_frame_variance >= self.MICRO_TEXTURE_VAR_THRESHOLD
            )

            return {
                "is_live": is_live,
                "inter_frame_variance": round(inter_frame_variance, 8),
                "mean_distance": round(mean_dist, 6),
            }
        except Exception as exc:
            logger.error("Micro-texture variation error: %s", str(exc))
            return {"is_live": False, "inter_frame_variance": 0.0, "error": str(exc)}

    def _calculate_lbp(self, image: np.ndarray) -> np.ndarray:
        """Vectorised 8-neighbourhood Local Binary Pattern."""
        center = image[1:-1, 1:-1]
        lbp = np.zeros((image.shape[0] - 2, image.shape[1] - 2), dtype=np.uint8)
        lbp |= ((image[:-2,  :-2]  >= center) << 7).astype(np.uint8)
        lbp |= ((image[:-2,  1:-1] >= center) << 6).astype(np.uint8)
        lbp |= ((image[:-2,  2:]   >= center) << 5).astype(np.uint8)
        lbp |= ((image[1:-1, 2:]   >= center) << 4).astype(np.uint8)
        lbp |= ((image[2:,   2:]   >= center) << 3).astype(np.uint8)
        lbp |= ((image[2:,   1:-1] >= center) << 2).astype(np.uint8)
        lbp |= ((image[2:,   :-2]  >= center) << 1).astype(np.uint8)
        lbp |= ((image[1:-1, :-2]  >= center) << 0).astype(np.uint8)
        return lbp

    # ──────────────────────────────────────────────────────────────────
    # Method 5: Optical flow naturalness (video replay defence)
    # ──────────────────────────────────────────────────────────────────

    def _analyze_optical_flow_naturalness(self, face_frames: List[np.ndarray]) -> Dict:
        """
        Dense optical flow analysis for video replay detection.

        Live faces produce high-entropy, aperiodic flow fields (muscle tremors,
        micro-breathing, subtle random head drift).

        Video replay frames show smooth, low-entropy, temporally regular flow
        (the playback has predictable motion).

        Static photo frames show near-zero flow.
        """
        if len(face_frames) < 3:
            return {
                "is_live": False,
                "mean_entropy": 0.0,
                "reason": "insufficient_frames",
            }
        try:
            target_size = (48, 48)
            gray_frames = []
            for f in face_frames:
                g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if len(f.shape) == 3 else f
                g = cv2.resize(g, target_size)
                gray_frames.append(g)

            entropies = []
            magnitudes = []
            for i in range(1, len(gray_frames)):
                flow = cv2.calcOpticalFlowFarneback(
                    gray_frames[i - 1], gray_frames[i],
                    None,
                    pyr_scale=0.5, levels=2, winsize=8,
                    iterations=3, poly_n=5, poly_sigma=1.1, flags=0
                )
                mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                magnitudes.append(float(np.mean(mag)))

                mag_u8 = (mag / (mag.max() + 1e-7) * 255).astype(np.uint8)
                hist, _ = np.histogram(mag_u8.ravel(), bins=32, range=(0, 255))
                hist_f = hist.astype(float) / (hist.sum() + 1e-7)
                entropy = float(-np.sum(hist_f * np.log2(hist_f + 1e-7)))
                entropies.append(entropy)

            mean_entropy = float(np.mean(entropies)) if entropies else 0.0
            mean_mag = float(np.mean(magnitudes)) if magnitudes else 0.0
            mag_variance = float(np.var(magnitudes)) if len(magnitudes) > 1 else 0.0

            # Live: mean_entropy > threshold (complex, irregular flow)
            # Photo: near-zero magnitude → entropy of a uniform histogram ≈ 5 (all in bin 0)
            #        But we catch photos in spoof detector's temporal method already.
            # Video: low-to-moderate entropy with low variance (predictable smooth motion)
            is_live = mean_entropy >= self.FLOW_ENTROPY_THRESHOLD and mean_mag > 0.01

            return {
                "is_live": is_live,
                "mean_entropy": round(mean_entropy, 4),
                "mean_magnitude": round(mean_mag, 4),
                "magnitude_variance": round(mag_variance, 6),
            }
        except Exception as exc:
            logger.error("Optical flow naturalness error: %s", str(exc))
            return {"is_live": False, "mean_entropy": 0.0, "error": str(exc)}

    # ──────────────────────────────────────────────────────────────────
    # Confidence fusion
    # ──────────────────────────────────────────────────────────────────

    def _calculate_confidence(
        self,
        blink_analysis: Dict,
        head_movement: Dict,
        depth_variation: Dict,
        micro_texture: Dict,
        flow_naturalness: Dict,
    ) -> float:
        """
        Weighted confidence across all 5 liveness signals.

        Weights:
          blink         0.20 (reduced — videos contain blinks)
          head_movement 0.15 (reduced — videos contain head movement)
          depth         0.10
          micro_texture 0.25 (key video-replay defence)
          flow_natural  0.30 (primary video-replay defence)
        """
        weights = {
            "blink":         0.20,
            "head_movement": 0.15,
            "depth":         0.10,
            "micro_texture": 0.25,
            "flow_natural":  0.30,
        }

        # Check if the primary video-replay/spoof defenses are passed
        primary_defenses_passed = micro_texture["is_live"] or flow_naturalness["is_live"]

        # Blink: fallback to 0.75 if primary defenses are passed, otherwise 0.0
        blink_conf = min(blink_analysis["blink_count"] / 2.0, 1.0) \
            if blink_analysis["blink_detected"] else (0.75 if primary_defenses_passed else 0.0)

        # Head movement: fallback to 0.75 if primary defenses are passed, otherwise 0.0
        head_conf = min(head_movement["movement_magnitude"] / 0.05, 1.0) \
            if head_movement["movement_detected"] else (0.75 if primary_defenses_passed else 0.0)

        # Depth variation: fallback to 0.75 if primary defenses are passed, otherwise 0.0
        depth_conf = min(depth_variation["variation_score"] / 0.15, 1.0) \
            if depth_variation["variation_detected"] else (0.75 if primary_defenses_passed else 0.0)


        # Micro-texture: binary live/not — but scale by variance level
        if micro_texture["is_live"]:
            var = micro_texture.get("inter_frame_variance", 0.0)
            micro_conf = min(var / (self.MICRO_TEXTURE_VAR_THRESHOLD * 5), 1.0)
            micro_conf = max(micro_conf, 0.6)
        else:
            micro_conf = 0.0

        # Optical flow naturalness: scale by entropy
        if flow_naturalness["is_live"]:
            entropy = flow_naturalness.get("mean_entropy", 0.0)
            flow_conf = min(entropy / (self.FLOW_ENTROPY_THRESHOLD * 1.5), 1.0)
            flow_conf = max(flow_conf, 0.6)
        else:
            flow_conf = 0.0

        confidence = (
            blink_conf    * weights["blink"] +
            head_conf     * weights["head_movement"] +
            depth_conf    * weights["depth"] +
            micro_conf    * weights["micro_texture"] +
            flow_conf     * weights["flow_natural"]
        )

        return float(min(max(confidence, 0.0), 1.0))