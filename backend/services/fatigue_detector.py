'''
FlowMate-Echo Fatigue Detector
Simple fatigue detection based on OpenCV (Haar cascades)
'''

import time
from typing import Optional, Tuple
from dataclasses import dataclass
from config import settings

# Try importing OpenCV
try:
    import cv2
    import numpy as np
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False
    print('OpenCV not available, using mock fatigue detection')


@dataclass
class FatigueMetrics:
    '''Fatigue metrics'''
    blink_rate: float = 0.0      # blinks per minute
    yawn_count: int = 0
    head_pose: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    fatigue_level: int = 0       # 0-100


class FatigueDetector:
    '''Fatigue detector'''

    def __init__(self):
        self.camera: Optional[cv2.VideoCapture] = None
        self.face_cascade = None
        self.eye_cascade = None
        self.is_running = False

        # Detection state
        self.blink_threshold = 0.25
        self.blink_count = 0
        self.last_blink_time = time.time()
        self.yawn_count = 0

        if OPENCV_AVAILABLE and settings.ENABLE_CAMERA:
            self._init_cascades()

    def _init_cascades(self):
        '''Init Haar cascades.'''
        try:
            self.face_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            )
            self.eye_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_eye.xml'
            )
        except Exception as e:
            print(f'Failed to load cascades: {e}')

    def start(self) -> bool:
        '''Start camera.'''
        if not OPENCV_AVAILABLE or not settings.ENABLE_CAMERA:
            return False

        try:
            self.camera = cv2.VideoCapture(0)
            if self.camera.isOpened():
                self.is_running = True
                return True
        except Exception as e:
            print(f'Failed to open camera: {e}')

        return False

    def stop(self):
        '''Stop camera.'''
        self.is_running = False
        if self.camera:
            self.camera.release()
            self.camera = None

    def detect(self) -> FatigueMetrics:
        '''Run one fatigue detection pass.'''
        if not self.is_running or not self.camera:
            if OPENCV_AVAILABLE and settings.ENABLE_CAMERA:
                self.start()
            if not self.is_running or not self.camera:
                return self._mock_detection()

        try:
            ret, frame = self.camera.read()
            if not ret:
                return self._mock_detection()

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(gray, 1.3, 5)

            eyes_detected = 0
            for (x, y, w, h) in faces:
                roi_gray = gray[y:y + h, x:x + w]
                eyes = self.eye_cascade.detectMultiScale(roi_gray)
                eyes_detected = len(eyes)
                if eyes_detected < 2:
                    self.blink_count += 1

            elapsed = time.time() - self.last_blink_time
            if elapsed >= 60:
                blink_rate = self.blink_count
                self.blink_count = 0
                self.last_blink_time = time.time()
            else:
                blink_rate = (self.blink_count / elapsed) * 60 if elapsed > 0 else 0

            fatigue_level = self._calculate_fatigue_level(blink_rate, eyes_detected)

            return FatigueMetrics(
                blink_rate=blink_rate,
                yawn_count=self.yawn_count,
                head_pose=(0.0, 0.0, 0.0),
                fatigue_level=fatigue_level,
            )

        except Exception as e:
            print(f'Detection error: {e}')
            return self._mock_detection()

    def _calculate_fatigue_level(self, blink_rate: float, eyes_detected: int) -> int:
        '''Calculate fatigue level (0-100).'''
        level = 0

        # High blink rate can indicate fatigue; very low may indicate zoning out.
        if blink_rate > 25:
            level += 25
        elif blink_rate > 18:
            level += 15
        elif 0 < blink_rate < 8.5:
            level = max(level, 82)

        # Eyes not detected suggests closed eyes / strong fatigue.
        if eyes_detected == 0:
            level = max(level, 70)
        elif eyes_detected == 1:
            level = max(level, 55)

        return min(level, 100)

    def _mock_detection(self) -> FatigueMetrics:
        '''Mock detection for environments without camera.'''
        import random
        return FatigueMetrics(
            blink_rate=random.uniform(10, 20),
            yawn_count=random.randint(0, 2),
            head_pose=(0.0, 0.0, 0.0),
            fatigue_level=random.randint(10, 40),
        )

    def get_fatigue_level(self) -> int:
        '''Get current fatigue level.'''
        metrics = self.detect()
        return metrics.fatigue_level


# Global instance
fatigue_detector = FatigueDetector()
