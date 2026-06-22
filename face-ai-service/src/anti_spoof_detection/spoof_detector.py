"""
Anti-Spoof Detection Module
Detects spoofing attempts using texture analysis, screen glare detection,
moire pattern analysis, color consistency, pixel entropy, and temporal
inter-frame consistency (photo/video replay defence).

Pipeline: SpoofDetector.detect_spoof() → main.py FaceAuthenticationPipeline
         → backend-api auth/routes.js → security_events & login_logs tables (PostgreSQL)

Attack classes detected:
  - Printed photo held to camera  (texture, color, temporal static)
  - Photo on phone/tablet screen  (glare, moire, temporal static)
  - Video replay on screen        (glare, moire, temporal periodic)
  - Video held on phone           (temporal periodicity, glare)
"""

import cv2
import numpy as np
from typing import List, Dict
import logging
import os
from scipy import ndimage
from scipy.signal import convolve2d
import pywt

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────
# Method weights for weighted-average confidence fusion.
# Must sum to 1.0.
# temporal_consistency is the primary defence against video replay.
# texture + moire defend against printed photos and screen display.
# ──────────────────────────────────────────────────────────────────
METHOD_WEIGHTS = {
    "texture_analysis":     0.25,
    "moire_patterns":       0.25,
    "screen_glare":         0.15,
    "color_consistency":    0.10,
    "pixel_patterns":       0.05,
    "temporal_consistency": 0.20,   # NEW — photo/video replay defence
}


class SpoofDetector:
    """
    Detects spoofing attempts through six analysis methods.

    Detection methods:
      1. texture_analysis      – LBP-based printed-photo texture uniformity
      2. screen_glare          – specular highlight detection (phone/screen replay)
      3. moire_patterns        – FFT-based screen pixel grid detection
      4. color_consistency     – LAB channel variance drop (flat printed colours)
      5. pixel_patterns        – Sobel gradient entropy (smooth digital screens)
      6. temporal_consistency  – Inter-frame optical flow analysis:
                                  • Photo → near-zero optical flow (static)
                                  • Video replay → periodic/smooth flow
                                  • Live face → irregular aperiodic micro-movements

    Confidence fusion: weighted average of TRIGGERED methods only.
    If weighted confidence exceeds spoof_threshold → spoof_detected=True.
    All individual_scores + triggered_methods are always returned for DB persistence.
    """

    def __init__(self):
        # ── Texture analysis (LBP uniformity) ──────────────────────────
        self.texture_window_size = 32
        self.texture_threshold = float(os.getenv("FACE_AI_TEXTURE_THRESHOLD", "0.30"))

        # ── Screen glare (specular highlights) ──────────────────────────
        self.glare_threshold = float(os.getenv("FACE_AI_GLARE_THRESHOLD", "0.85"))
        self.glare_area_ratio = float(os.getenv("FACE_AI_GLARE_AREA_RATIO", "0.12"))

        # ── Moire pattern (FFT mid-frequency energy) ────────────────────
        self.moire_frequency_range = (0.1, 0.35)
        self.moire_threshold = float(os.getenv("FACE_AI_MOIRE_THRESHOLD", "0.55"))

        # ── Color consistency (LAB variance drop) ───────────────────────
        self.color_variance_threshold = float(
            os.getenv("FACE_AI_COLOR_VARIANCE_THRESHOLD", "0.015")
        )

        # ── Pixel entropy (Sobel gradient distribution) ─────────────────
        self.pixel_entropy_threshold = float(
            os.getenv("FACE_AI_PIXEL_ENTROPY_THRESHOLD", "1.5")
        )

        # ── Temporal consistency (optical flow) ─────────────────────────
        # Mean optical flow magnitude below this → static (photo attack)
        self.temporal_static_threshold = float(
            os.getenv("FACE_AI_TEMPORAL_STATIC_THRESHOLD", "0.10")
        )
        # Flow periodicity score above this → looping video replay
        self.temporal_periodic_threshold = float(
            os.getenv("FACE_AI_TEMPORAL_PERIODIC_THRESHOLD", "0.55")
        )

        # ── Overall spoof decision threshold ────────────────────────────
        self.spoof_threshold = float(os.getenv("FACE_AI_SPOOF_THRESHOLD", "0.55"))

        logger.info(
            "SpoofDetector initialised | thresholds: texture=%.2f glare_area=%.2f "
            "moire=%.2f color_var=%.3f entropy=%.2f temporal_static=%.2f "
            "temporal_periodic=%.2f spoof=%.2f",
            self.texture_threshold,
            self.glare_area_ratio,
            self.moire_threshold,
            self.color_variance_threshold,
            self.pixel_entropy_threshold,
            self.temporal_static_threshold,
            self.temporal_periodic_threshold,
            self.spoof_threshold,
        )

    # ──────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────

    def detect_spoof(self, face_frames: List[np.ndarray]) -> Dict:
        """
        Detect spoofing attempts across all provided face frames.

        Args:
            face_frames: List of cropped face images (BGR numpy arrays).
                         Pass ALL available frames (not just the clearest)
                         so temporal analysis has sequence data to work with.

        Returns:
            {
              "spoof_detected":    bool,
              "spoof_confidence":  float  [0.0, 1.0],
              "detection_type":    str    (primary firing method or "NONE"),
              "individual_scores": {method_name: float},
              "analysis_results":  {frame metadata},
              "triggered_methods": [list of method names that individually fired]
            }

        All keys are ALWAYS present so the backend-api can persist them
        to security_events / login_logs regardless of detection outcome.
        """
        if not face_frames:
            return {
                "spoof_detected": False,
                "spoof_confidence": 0.0,
                "detection_type": "NO_FRAMES",
                "individual_scores": {},
                "analysis_results": {},
                "triggered_methods": [],
            }

        # Select the clearest (sharpest) frame for single-frame analyses
        clearest_frame = self._select_clearest_frame(face_frames)

        results: Dict = {
            "spoof_detected": False,
            "spoof_confidence": 0.0,
            "detection_type": "NONE",
            "individual_scores": {},
            "analysis_results": {},
            "triggered_methods": [],
        }

        try:
            # Single-frame detection methods (use clearest frame)
            single_frame_methods = [
                ("texture_analysis",  self._analyze_texture_patterns),
                ("screen_glare",      self._detect_screen_glare),
                ("moire_patterns",    self._detect_moire_patterns),
                ("color_consistency", self._analyze_color_consistency),
                ("pixel_patterns",    self._analyze_pixel_patterns),
            ]

            method_results: Dict[str, Dict] = {}

            for method_name, method_func in single_frame_methods:
                method_result = method_func(clearest_frame)
                results["individual_scores"][method_name] = round(
                    float(method_result.get("score", 0.0)), 4
                )
                method_results[method_name] = method_result

            # Multi-frame temporal method (requires frame sequence)
            temporal_result = self._analyze_temporal_consistency(face_frames)
            results["individual_scores"]["temporal_consistency"] = round(
                float(temporal_result.get("score", 0.0)), 4
            )
            method_results["temporal_consistency"] = temporal_result

            # ── Weighted-average confidence fusion ──────────────────────
            # Only triggered methods (detected=True) contribute to weighted sum.
            weighted_numerator = 0.0
            triggered = []

            for method_name, mresult in method_results.items():
                weight = METHOD_WEIGHTS.get(method_name, 0.0)
                if mresult.get("detected", False):
                    weighted_numerator += weight * mresult.get("score", 0.0)
                    triggered.append(method_name)

            triggered_weight_sum = sum(
                METHOD_WEIGHTS[m] for m in triggered
            ) if triggered else 1.0

            weighted_confidence = (
                weighted_numerator / triggered_weight_sum if triggered else 0.0
            )
            weighted_confidence = min(max(weighted_confidence, 0.0), 1.0)

            results["triggered_methods"] = triggered
            results["spoof_confidence"] = round(weighted_confidence, 4)

            if weighted_confidence > self.spoof_threshold and triggered:
                best_method = max(
                    triggered,
                    key=lambda m: method_results[m].get("score", 0.0),
                )
                results["spoof_detected"] = True
                results["detection_type"] = method_results[best_method].get(
                    "type", best_method.upper()
                )

                logger.warning(
                    "SPOOF DETECTED | frames=%d confidence=%.4f type=%s "
                    "triggered=%s individual_scores=%s",
                    len(face_frames),
                    weighted_confidence,
                    results["detection_type"],
                    triggered,
                    results["individual_scores"],
                )
            else:
                results["spoof_detected"] = False
                results["detection_type"] = "NONE"
                logger.info(
                    "No spoof detected | frames=%d confidence=%.4f triggered=%s",
                    len(face_frames),
                    weighted_confidence,
                    triggered,
                )

            # Frame metadata always present for DB persistence
            results["analysis_results"] = {
                "frame_shape": list(clearest_frame.shape),
                "frame_brightness": round(float(np.mean(clearest_frame)), 4),
                "frame_contrast": round(float(np.std(clearest_frame)), 4),
                "frames_analysed": len(face_frames),
            }

        except Exception as exc:
            logger.error("Spoof detection pipeline error: %s", str(exc), exc_info=True)
            results["detection_type"] = "ANALYSIS_ERROR"
            results["error"] = str(exc)
            results.setdefault("spoof_confidence", 0.0)
            results.setdefault("individual_scores", {})

        return results

    # ──────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────

    def _select_clearest_frame(self, frames: List[np.ndarray]) -> np.ndarray:
        """Select the clearest frame based on Laplacian variance (sharpness)."""
        sharpness_scores = []
        for frame in frames:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
            laplacian = cv2.Laplacian(gray, cv2.CV_64F)
            sharpness_scores.append(np.var(laplacian))
        return frames[int(np.argmax(sharpness_scores))]

    # ── Method 1: Texture analysis (LBP) ──────────────────────────────

    def _analyze_texture_patterns(self, image: np.ndarray) -> Dict:
        """LBP texture uniformity — printed photos have unnaturally uniform micro-texture."""
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            h, w = gray.shape
            if h > 256 or w > 256:
                gray = cv2.resize(gray, (256, 256))

            lbp_image = self._calculate_lbp(gray)
            hist, _ = np.histogram(lbp_image.ravel(), bins=256, range=(0, 256))
            hist = hist.astype("float") / (hist.sum() + 1e-7)
            uniformity = float(np.sum(hist ** 2))
            score = min(uniformity / 0.35, 1.0)
            detected = uniformity > self.texture_threshold

            return {"detected": detected, "score": score, "type": "PRINTED_TEXTURE",
                    "uniformity": uniformity}
        except Exception as exc:
            logger.error("Texture analysis error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "TEXTURE_ANALYSIS_ERROR", "error": str(exc)}

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

    # ── Method 2: Screen glare ─────────────────────────────────────────

    def _detect_screen_glare(self, image: np.ndarray) -> Dict:
        """Specular highlights from phone/monitor replay attacks."""
        try:
            if len(image.shape) == 3:
                hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
                value_channel = hsv[:, :, 2]
            else:
                value_channel = image

            _, bright_mask = cv2.threshold(
                value_channel, int(self.glare_threshold * 255), 255, cv2.THRESH_BINARY
            )
            bright_ratio = float(np.sum(bright_mask > 0)) / value_channel.size

            structure_score = 0.0
            contours, _ = cv2.findContours(bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest = max(contours, key=cv2.contourArea)
                area = cv2.contourArea(largest)
                if area > 0:
                    hull_area = cv2.contourArea(cv2.convexHull(largest))
                    solidity = area / (hull_area + 1e-7)
                    structure_score = float(solidity) if solidity > 0.85 else 0.0

            combined = min((bright_ratio / (self.glare_area_ratio + 1e-7)) * 0.7
                           + structure_score * 0.3, 1.0)
            detected = bright_ratio > self.glare_area_ratio and combined > 0.5

            return {"detected": detected, "score": combined, "type": "SCREEN_GLARE",
                    "bright_ratio": round(bright_ratio, 4),
                    "structure_score": round(structure_score, 4)}
        except Exception as exc:
            logger.error("Screen glare detection error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "GLARE_DETECTION_ERROR", "error": str(exc)}

    # ── Method 3: Moire patterns (FFT) ────────────────────────────────

    def _detect_moire_patterns(self, image: np.ndarray) -> Dict:
        """Screen pixel-grid detection via 2-D Fourier Transform."""
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

            f_transform = np.fft.fft2(gray.astype(np.float32))
            f_shift = np.fft.fftshift(f_transform)
            magnitude = 20 * np.log(np.abs(f_shift) + 1)
            mag_min, mag_max = np.min(magnitude), np.max(magnitude)
            magnitude_norm = (magnitude - mag_min) / (mag_max - mag_min + 1e-7)

            h, w = magnitude_norm.shape
            cy, cx = h // 2, w // 2
            y, x = np.ogrid[:h, :w]
            dist = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            lo = self.moire_frequency_range[0] * min(h, w)
            hi = self.moire_frequency_range[1] * min(h, w)
            ring_mask = (dist >= lo) & (dist <= hi)

            avg_magnitude = float(np.mean(magnitude_norm[ring_mask]))
            peak_magnitude = float(np.max(magnitude_norm[ring_mask]))
            peak_ratio = peak_magnitude / (avg_magnitude + 1e-7)
            peak_bonus = min((peak_ratio - 1.5) / 3.0, 0.2) if peak_ratio > 1.5 else 0.0

            raw_score = min(avg_magnitude / 0.4 + peak_bonus, 1.0)
            detected = avg_magnitude > self.moire_threshold

            return {"detected": detected, "score": raw_score, "type": "MOIRE_PATTERN",
                    "avg_magnitude": round(avg_magnitude, 4),
                    "peak_ratio": round(peak_ratio, 4)}
        except Exception as exc:
            logger.error("Moire pattern detection error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "MOIRE_DETECTION_ERROR", "error": str(exc)}

    # ── Method 4: Color consistency ────────────────────────────────────

    def _analyze_color_consistency(self, image: np.ndarray) -> Dict:
        """Flat colour distribution in CIE LAB — printed media loses natural skin variance."""
        try:
            if len(image.shape) != 3:
                return {"detected": False, "score": 0.0, "type": "NOT_COLOR_IMAGE"}

            lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
            channel_variances = [float(np.var(lab[:, :, i]) / 255.0) for i in range(3)]
            avg_variance = float(np.mean(channel_variances))

            if avg_variance >= self.color_variance_threshold:
                score, detected = 0.0, False
            else:
                score = min(
                    (self.color_variance_threshold - avg_variance) / self.color_variance_threshold, 1.0
                )
                detected = True

            return {"detected": detected, "score": max(score, 0.0), "type": "COLOR_CONSISTENCY",
                    "avg_variance": round(avg_variance, 6)}
        except Exception as exc:
            logger.error("Color consistency analysis error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "COLOR_ANALYSIS_ERROR", "error": str(exc)}

    # ── Method 5: Pixel pattern (gradient entropy) ─────────────────────

    def _analyze_pixel_patterns(self, image: np.ndarray) -> Dict:
        """Sobel gradient entropy — screens produce unnaturally directional gradients."""
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
            grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
            grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
            grad_mag = np.sqrt(grad_x ** 2 + grad_y ** 2)

            max_grad = np.max(grad_mag)
            if max_grad < 1e-7:
                return {"detected": False, "score": 0.0, "type": "PIXEL_PATTERN", "entropy": 0.0}

            grad_hist, _ = np.histogram(grad_mag.ravel(), bins=50, range=(0, max_grad))
            grad_hist = grad_hist.astype("float") / (grad_hist.sum() + 1e-7)
            entropy = float(-np.sum(grad_hist * np.log2(grad_hist + 1e-7)))

            h_energy = float(np.mean(np.abs(grad_x)))
            v_energy = float(np.mean(np.abs(grad_y)))
            directionality = abs(h_energy - v_energy) / (h_energy + v_energy + 1e-7)
            dir_bonus = min(directionality * 0.2, 0.15)

            score = 0.0
            if entropy < self.pixel_entropy_threshold:
                base = min((self.pixel_entropy_threshold - entropy) / 1.0, 1.0)
                score = min(max(base, 0.0) + dir_bonus, 1.0)
            detected = entropy < self.pixel_entropy_threshold and score > 0.1

            return {"detected": detected, "score": score, "type": "PIXEL_PATTERN",
                    "entropy": round(entropy, 4),
                    "directionality": round(directionality, 4)}
        except Exception as exc:
            logger.error("Pixel pattern analysis error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "PATTERN_ANALYSIS_ERROR", "error": str(exc)}

    # ── Method 6: Temporal consistency (photo/video replay defence) ────

    def _analyze_temporal_consistency(self, frames: List[np.ndarray]) -> Dict:
        """
        Inter-frame optical flow analysis to detect photo and video replay attacks.

        Photo attack:   very low optical flow magnitude across all frame pairs
                        (the scene is completely static).

        Video replay:   moderate but unnaturally uniform/periodic optical flow
                        (the motion is smooth and repeating, not biologically driven).

        Live face:      irregular, aperiodic micro-movements with natural variance
                        (muscle micro-tremors, breathing, subtle head drift).

        Algorithm:
          1. Compute Farneback dense optical flow between consecutive frame pairs.
          2. Compute per-pair mean magnitude (M) and flow field entropy (E).
          3. Static check: if mean(M) < static_threshold → photo attack score.
          4. Periodicity check: low variance(M) + low mean(E) → video replay score.
          5. Final score = max(static_score, periodic_score).
        """
        if len(frames) < 2:
            # Cannot compute inter-frame flow with fewer than 2 frames
            return {
                "detected": False,
                "score": 0.0,
                "type": "TEMPORAL_CONSISTENCY",
                "reason": "insufficient_frames",
                "mean_flow": 0.0,
                "flow_variance": 0.0,
            }

        try:
            # Downscale frames to 64×64 for fast optical flow
            target_size = (64, 64)
            gray_frames = []
            for f in frames:
                g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if len(f.shape) == 3 else f
                g = cv2.resize(g, target_size)
                gray_frames.append(g)

            flow_magnitudes = []
            flow_entropies = []

            for i in range(len(gray_frames) - 1):
                prev = gray_frames[i]
                curr = gray_frames[i + 1]

                # Dense optical flow (Farneback)
                flow = cv2.calcOpticalFlowFarneback(
                    prev, curr,
                    None,
                    pyr_scale=0.5, levels=3, winsize=10,
                    iterations=3, poly_n=5, poly_sigma=1.1,
                    flags=0
                )

                # Compute flow magnitude
                mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                mean_mag = float(np.mean(mag))
                flow_magnitudes.append(mean_mag)

                # Compute flow entropy (low entropy = unnaturally uniform motion)
                mag_norm = (mag / (mag.max() + 1e-7) * 255).astype(np.uint8)
                hist, _ = np.histogram(mag_norm.ravel(), bins=32, range=(0, 255))
                hist_f = hist.astype(float) / (hist.sum() + 1e-7)
                entropy = float(-np.sum(hist_f * np.log2(hist_f + 1e-7)))
                flow_entropies.append(entropy)

            mean_flow = float(np.mean(flow_magnitudes)) if flow_magnitudes else 0.0
            flow_variance = float(np.var(flow_magnitudes)) if len(flow_magnitudes) > 1 else 0.0
            mean_entropy = float(np.mean(flow_entropies)) if flow_entropies else 0.0

            # ── Static (photo) detection ───────────────────────────────
            # Photos have near-zero flow across ALL frame pairs.
            # Score rises as mean_flow drops below static_threshold.
            if mean_flow < self.temporal_static_threshold:
                static_score = min(
                    1.0 - (mean_flow / (self.temporal_static_threshold + 1e-7)), 1.0
                )
            else:
                static_score = 0.0

            # ── Periodicity (video replay) detection ───────────────────
            # Video replays show unnaturally low flow variance AND low entropy
            # (the motion is smooth and repetitive, not biologically driven).
            # Normalise variance: expected live variance is ~0.005–0.02.
            variance_score = 0.0
            if mean_flow > self.temporal_static_threshold:
                # Only apply periodicity check when there IS motion (not a photo)
                normalized_variance = flow_variance / (mean_flow ** 2 + 1e-7)
                # Low normalised variance + low entropy → periodic (video replay)
                low_variance = normalized_variance < 0.5  # unnaturally smooth motion
                low_entropy = mean_entropy < 2.0          # uniform flow field
                if low_variance and low_entropy:
                    variance_score = min(
                        (1.0 - normalized_variance) * 0.6 +
                        (1.0 - mean_entropy / 3.0) * 0.4,
                        1.0
                    )

            # Final temporal score: max of static or periodic attack
            temporal_score = max(static_score, variance_score)
            attack_type = (
                "PHOTO_STATIC" if static_score >= variance_score
                else "VIDEO_REPLAY"
            )
            detected = temporal_score > 0.45

            logger.debug(
                "Temporal analysis | mean_flow=%.4f flow_var=%.4f "
                "mean_entropy=%.4f static_score=%.4f periodic_score=%.4f",
                mean_flow, flow_variance, mean_entropy,
                static_score, variance_score,
            )

            return {
                "detected": detected,
                "score": round(temporal_score, 4),
                "type": f"TEMPORAL_{attack_type}",
                "mean_flow": round(mean_flow, 4),
                "flow_variance": round(flow_variance, 6),
                "mean_entropy": round(mean_entropy, 4),
                "static_score": round(static_score, 4),
                "periodic_score": round(variance_score, 4),
            }

        except Exception as exc:
            logger.error("Temporal consistency analysis error: %s", str(exc), exc_info=True)
            return {
                "detected": False,
                "score": 0.0,
                "type": "TEMPORAL_ANALYSIS_ERROR",
                "error": str(exc),
                "mean_flow": 0.0,
                "flow_variance": 0.0,
            }


# ──────────────────────────────────────────────────────────────────
# Quick smoke-test (python spoof_detector.py)
# ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import json

    detector = SpoofDetector()

    # ── Test 1: random noise sequence (live-face-like) ─────────────
    real_frames = [np.random.randint(50, 200, (120, 120, 3), dtype=np.uint8)
                   for _ in range(8)]
    r1 = detector.detect_spoof(real_frames)
    print("=== Test 1: Random-noise frames (live-like) ===")
    print(json.dumps({k: v for k, v in r1.items() if k != "analysis_results"}, indent=2))

    # ── Test 2: identical frames (photo attack simulation) ─────────
    static_frame = np.random.randint(50, 200, (120, 120, 3), dtype=np.uint8)
    static_frames = [static_frame.copy() for _ in range(8)]
    r2 = detector.detect_spoof(static_frames)
    print("\n=== Test 2: Identical frames (photo attack) ===")
    print(json.dumps({k: v for k, v in r2.items() if k != "analysis_results"}, indent=2))

    # ── Test 3: flat grey uniform (printed photo) ──────────────────
    flat_frames = [np.full((120, 120, 3), 128, dtype=np.uint8) for _ in range(4)]
    r3 = detector.detect_spoof(flat_frames)
    print("\n=== Test 3: Flat uniform frames (printed photo) ===")
    print(json.dumps({k: v for k, v in r3.items() if k != "analysis_results"}, indent=2))

    # ── Test 4: empty frame list ───────────────────────────────────
    r4 = detector.detect_spoof([])
    print("\n=== Test 4: Empty frames ===")
    print(json.dumps(r4, indent=2))