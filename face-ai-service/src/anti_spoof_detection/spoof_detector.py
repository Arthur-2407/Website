"""
Anti-Spoof Detection Module
Detects spoofing attempts using texture analysis, screen glare detection,
moire pattern analysis, color consistency, and pixel entropy.

Pipeline: SpoofDetector.detect_spoof() → main.py FaceAuthenticationPipeline
         → backend-api auth/routes.js → security_events & login_logs tables (PostgreSQL)
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
# These must sum to 1.0.
# Moire + texture are strongest signals; glare/entropy support.
# ──────────────────────────────────────────────────────────────────
METHOD_WEIGHTS = {
    "texture_analysis":   0.30,
    "moire_patterns":     0.30,
    "screen_glare":       0.20,
    "color_consistency":  0.10,
    "pixel_patterns":     0.10,
}


class SpoofDetector:
    """
    Detects spoofing attempts through multiple analysis methods.

    Detection methods:
      1. texture_analysis  – LBP-based printed-photo texture uniformity
      2. screen_glare      – specular highlight detection (phone/screen replay)
      3. moire_patterns    – FFT-based screen pixel grid detection
      4. color_consistency – LAB channel variance drop (flat printed colours)
      5. pixel_patterns    – Sobel gradient entropy (smooth digital screens)

    Confidence fusion strategy:
      - Each method returns a raw [0, 1] score and a boolean `detected` flag.
      - Weighted average across ALL methods gives `raw_confidence`.
      - Only methods that individually fire (`detected=True`) are included
        in the weighted vote; methods that do NOT fire contribute 0.
      - If the weighted confidence exceeds `FACE_AI_SPOOF_THRESHOLD` (0.65),
        spoof_detected=True is returned together with the winning detection_type.
      - `individual_scores` (all methods) are always included so the backend
        can persist full telemetry to the database.
    """

    def __init__(self):
        # ── Texture analysis (LBP uniformity) ──────────────────────────
        self.texture_window_size = 32
        # Raised from 0.25 → 0.30 to reduce false positives on slightly
        # uniform backgrounds (e.g., plain office walls).
        self.texture_threshold = float(os.getenv("FACE_AI_TEXTURE_THRESHOLD", "0.30"))

        # ── Screen glare (specular highlights) ──────────────────────────
        self.glare_threshold = float(os.getenv("FACE_AI_GLARE_THRESHOLD", "0.85"))
        # Raised from 0.08 → 0.12: requires a larger bright area before firing.
        self.glare_area_ratio = float(os.getenv("FACE_AI_GLARE_AREA_RATIO", "0.12"))

        # ── Moire pattern (FFT mid-frequency energy) ────────────────────
        self.moire_frequency_range = (0.1, 0.35)
        # Raised from 0.45 → 0.55 to fix the chronic over-triggering observed
        # on high-contrast real faces photographed near monitors.
        self.moire_threshold = float(os.getenv("FACE_AI_MOIRE_THRESHOLD", "0.55"))

        # ── Color consistency (LAB variance drop) ───────────────────────
        # Lowered from 0.02 → 0.015: only fire on genuinely flat colour
        # (i.e., heavily compressed/printed images).
        self.color_variance_threshold = float(
            os.getenv("FACE_AI_COLOR_VARIANCE_THRESHOLD", "0.015")
        )

        # ── Pixel entropy (Sobel gradient distribution) ─────────────────
        # Lowered from 1.8 → 1.5: less aggressive; digital replay screens
        # are smoother than real faces but the old threshold fired on blurry
        # real-face frames taken in low light.
        self.pixel_entropy_threshold = float(
            os.getenv("FACE_AI_PIXEL_ENTROPY_THRESHOLD", "1.5")
        )

        # ── Overall spoof decision threshold ────────────────────────────
        # Weighted confidence must exceed this to declare spoof_detected=True.
        # Read at init so it matches the pipeline's FACE_AI_SPOOF_THRESHOLD.
        self.spoof_threshold = float(os.getenv("FACE_AI_SPOOF_THRESHOLD", "0.65"))

        logger.info(
            "SpoofDetector initialised | thresholds: texture=%.2f glare_area=%.2f "
            "moire=%.2f color_var=%.3f entropy=%.2f spoof=%.2f",
            self.texture_threshold,
            self.glare_area_ratio,
            self.moire_threshold,
            self.color_variance_threshold,
            self.pixel_entropy_threshold,
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

        Returns:
            {
              "spoof_detected":   bool,
              "spoof_confidence": float  [0.0, 1.0],
              "detection_type":   str    (primary firing method or "NONE"),
              "individual_scores": {method_name: float},
              "analysis_results": {frame metadata},
              "triggered_methods": [list of method names that individually fired]
            }

        NOTE: `spoof_confidence` and `individual_scores` are ALWAYS present
        so the backend-api can persist them to security_events / login_logs
        regardless of whether a spoof was detected.
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

        # Use the clearest (sharpest) frame for analysis
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
            detection_methods = [
                ("texture_analysis",  self._analyze_texture_patterns),
                ("screen_glare",      self._detect_screen_glare),
                ("moire_patterns",    self._detect_moire_patterns),
                ("color_consistency", self._analyze_color_consistency),
                ("pixel_patterns",    self._analyze_pixel_patterns),
            ]

            method_results: Dict[str, Dict] = {}

            for method_name, method_func in detection_methods:
                method_result = method_func(clearest_frame)
                results["individual_scores"][method_name] = round(
                    float(method_result.get("score", 0.0)), 4
                )
                method_results[method_name] = method_result

            # ── Weighted-average confidence fusion ──────────────────────
            # Only methods that individually fired contribute their raw score
            # to the weighted sum; silent methods contribute 0.
            weighted_numerator = 0.0
            triggered = []

            for method_name, mresult in method_results.items():
                weight = METHOD_WEIGHTS.get(method_name, 0.0)
                if mresult.get("detected", False):
                    weighted_numerator += weight * mresult.get("score", 0.0)
                    triggered.append(method_name)

            # Normalise against sum of weights of triggered methods only
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
                # Pick the highest-scoring triggered method as primary type
                best_method = max(
                    triggered,
                    key=lambda m: method_results[m].get("score", 0.0),
                )
                results["spoof_detected"] = True
                results["detection_type"] = method_results[best_method].get(
                    "type", best_method.upper()
                )

                logger.warning(
                    "SPOOF DETECTED | employee_frame_count=%d "
                    "confidence=%.4f type=%s triggered=%s individual_scores=%s",
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
                    "No spoof detected | confidence=%.4f triggered=%s",
                    weighted_confidence,
                    triggered,
                )

            # ── Frame metadata (always present for DB persistence) ──────
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
            # Ensure safe values so backend-api never gets missing keys
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
        """
        Analyse LBP texture uniformity.
        Printed photos exhibit abnormally uniform micro-texture.
        Score = (uniformity / normalisation_cap), clamped to [0, 1].
        """
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

            h, w = gray.shape
            if h > 256 or w > 256:
                gray = cv2.resize(gray, (256, 256))

            lbp_image = self._calculate_lbp(gray)
            hist, _ = np.histogram(lbp_image.ravel(), bins=256, range=(0, 256))
            hist = hist.astype("float")
            hist /= hist.sum() + 1e-7

            uniformity = float(np.sum(hist ** 2))

            # Cap normalisation at 0.35 (raised from 0.30) to spread the score
            # more evenly and reduce cliff-edge triggering.
            score = min(uniformity / 0.35, 1.0)
            detected = uniformity > self.texture_threshold

            return {
                "detected": detected,
                "score": score,
                "type": "PRINTED_TEXTURE",
                "uniformity": uniformity,
            }

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
        """
        Detect specular highlights characteristic of phone/monitor replay.
        Uses HSV value channel; looks for clusters of very bright pixels.
        Additionally checks for rectangular structure in bright regions —
        screen reflections tend to have straighter edges than natural skin
        highlights.
        """
        try:
            if len(image.shape) == 3:
                hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
                value_channel = hsv[:, :, 2]
            else:
                value_channel = image

            _, bright_mask = cv2.threshold(
                value_channel,
                int(self.glare_threshold * 255),
                255,
                cv2.THRESH_BINARY,
            )

            bright_pixels = int(np.sum(bright_mask > 0))
            total_pixels = value_channel.size
            bright_ratio = bright_pixels / total_pixels

            # Secondary check: aspect-ratio regularity of the largest bright blob
            structure_score = 0.0
            contours, _ = cv2.findContours(
                bright_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if contours:
                largest = max(contours, key=cv2.contourArea)
                area = cv2.contourArea(largest)
                if area > 0:
                    hull_area = cv2.contourArea(cv2.convexHull(largest))
                    solidity = area / (hull_area + 1e-7)
                    # High solidity → rectangle-like → more likely a screen reflection
                    structure_score = float(solidity) if solidity > 0.85 else 0.0

            # Combined score: area ratio + structure bonus
            combined = min((bright_ratio / (self.glare_area_ratio + 1e-7)) * 0.7
                           + structure_score * 0.3, 1.0)

            detected = bright_ratio > self.glare_area_ratio and combined > 0.5

            return {
                "detected": detected,
                "score": combined,
                "type": "SCREEN_GLARE",
                "bright_ratio": round(bright_ratio, 4),
                "structure_score": round(structure_score, 4),
            }

        except Exception as exc:
            logger.error("Screen glare detection error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "GLARE_DETECTION_ERROR", "error": str(exc)}

    # ── Method 3: Moire patterns (FFT) ────────────────────────────────

    def _detect_moire_patterns(self, image: np.ndarray) -> Dict:
        """
        Detect moire / pixel-grid patterns using 2-D Fourier Transform.
        Digital screens produce regular mid-frequency energy spikes that
        real human skin does not.
        """
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

            # Peak-to-mean ratio in the ring catches sharp spikes from pixel grids
            peak_magnitude = float(np.max(magnitude_norm[ring_mask]))
            peak_ratio = peak_magnitude / (avg_magnitude + 1e-7)
            peak_bonus = min((peak_ratio - 1.5) / 3.0, 0.2) if peak_ratio > 1.5 else 0.0

            raw_score = min(avg_magnitude / 0.4 + peak_bonus, 1.0)
            detected = avg_magnitude > self.moire_threshold

            return {
                "detected": detected,
                "score": raw_score,
                "type": "MOIRE_PATTERN",
                "avg_magnitude": round(avg_magnitude, 4),
                "peak_ratio": round(peak_ratio, 4),
            }

        except Exception as exc:
            logger.error("Moire pattern detection error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "MOIRE_DETECTION_ERROR", "error": str(exc)}

    # ── Method 4: Color consistency ────────────────────────────────────

    def _analyze_color_consistency(self, image: np.ndarray) -> Dict:
        """
        Detect abnormally flat colour distributions typical of printed photos.
        Uses CIE LAB space; printed media loses natural skin colour variance.
        """
        try:
            if len(image.shape) != 3:
                return {"detected": False, "score": 0.0, "type": "NOT_COLOR_IMAGE"}

            lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
            channel_variances = [
                float(np.var(lab[:, :, i]) / 255.0) for i in range(3)
            ]
            avg_variance = float(np.mean(channel_variances))

            # Score climbs as variance drops below threshold
            if avg_variance >= self.color_variance_threshold:
                score = 0.0
                detected = False
            else:
                score = min(
                    (self.color_variance_threshold - avg_variance)
                    / self.color_variance_threshold,
                    1.0,
                )
                detected = True

            return {
                "detected": detected,
                "score": max(score, 0.0),
                "type": "COLOR_CONSISTENCY",
                "avg_variance": round(avg_variance, 6),
            }

        except Exception as exc:
            logger.error("Color consistency analysis error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "COLOR_ANALYSIS_ERROR", "error": str(exc)}

    # ── Method 5: Pixel pattern (gradient entropy) ─────────────────────

    def _analyze_pixel_patterns(self, image: np.ndarray) -> Dict:
        """
        Detect digital screen replay via Sobel gradient entropy.
        Real faces have rich gradient distributions; smooth screen-displayed
        faces or photos tend toward lower entropy.
        Also checks gradient directionality: screens produce unnaturally
        directional gradients due to pixel rows/columns.
        """
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

            # Directionality ratio: strong horizontal OR vertical bias
            h_energy = float(np.mean(np.abs(grad_x)))
            v_energy = float(np.mean(np.abs(grad_y)))
            directionality = abs(h_energy - v_energy) / (h_energy + v_energy + 1e-7)
            dir_bonus = min(directionality * 0.2, 0.15)

            score = 0.0
            if entropy < self.pixel_entropy_threshold:
                base = min((self.pixel_entropy_threshold - entropy) / 1.0, 1.0)
                score = min(max(base, 0.0) + dir_bonus, 1.0)

            detected = entropy < self.pixel_entropy_threshold and score > 0.1

            return {
                "detected": detected,
                "score": score,
                "type": "PIXEL_PATTERN",
                "entropy": round(entropy, 4),
                "directionality": round(directionality, 4),
            }

        except Exception as exc:
            logger.error("Pixel pattern analysis error: %s", str(exc))
            return {"detected": False, "score": 0.0, "type": "PATTERN_ANALYSIS_ERROR", "error": str(exc)}


# ──────────────────────────────────────────────────────────────────
# Quick smoke-test (python spoof_detector.py)
# ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import json

    detector = SpoofDetector()

    # ── Test 1: random noise (should NOT trigger spoof) ────────────
    test_image_real = np.random.randint(50, 200, (120, 120, 3), dtype=np.uint8)
    results = detector.detect_spoof([test_image_real])
    print("=== Test 1: Random-noise (real-like) ===")
    print(json.dumps({k: v for k, v in results.items() if k != "analysis_results"}, indent=2))

    # ── Test 2: uniform grey (simulates flat printed photo) ────────
    test_image_flat = np.full((120, 120, 3), 128, dtype=np.uint8)
    results2 = detector.detect_spoof([test_image_flat])
    print("\n=== Test 2: Flat uniform grey (printed-photo-like) ===")
    print(json.dumps({k: v for k, v in results2.items() if k != "analysis_results"}, indent=2))

    # ── Test 3: empty frame list ───────────────────────────────────
    results3 = detector.detect_spoof([])
    print("\n=== Test 3: Empty frame list ===")
    print(json.dumps(results3, indent=2))