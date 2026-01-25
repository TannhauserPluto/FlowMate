"""
FlowMate-Echo Fatigue Detector
疲劳检测服务 - 基于 OpenCV 的简单实现
"""

import time
from typing import Optional, Tuple
from dataclasses import dataclass
from config import settings

# 尝试导入 OpenCV
try:
    import cv2
    import numpy as np
    OPENCV_AVAILABLE = True
except ImportError:
    OPENCV_AVAILABLE = False
    print("OpenCV not available, using mock fatigue detection")


@dataclass
class FatigueMetrics:
    """疲劳指标"""
    blink_rate: float = 0.0      # 眨眼频率 (次/分钟)
    yawn_count: int = 0          # 打哈欠次数
    head_pose: Tuple[float, float, float] = (0.0, 0.0, 0.0)  # 头部姿态
    fatigue_level: int = 0       # 疲劳等级 (0-100)


class FatigueDetector:
    """疲劳检测器"""

    def __init__(self):
        self.camera: Optional[cv2.VideoCapture] = None
        self.face_cascade = None
        self.eye_cascade = None
        self.is_running = False

        # 检测参数
        self.blink_threshold = 0.25
        self.blink_count = 0
        self.last_blink_time = time.time()
        self.yawn_count = 0

        # 初始化级联分类器
        if OPENCV_AVAILABLE and settings.ENABLE_CAMERA:
            self._init_cascades()

    def _init_cascades(self):
        """初始化 Haar 级联分类器"""
        try:
            self.face_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            )
            self.eye_cascade = cv2.CascadeClassifier(
                cv2.data.haarcascades + 'haarcascade_eye.xml'
            )
        except Exception as e:
            print(f"Failed to load cascades: {e}")

    def start(self) -> bool:
        """启动摄像头"""
        if not OPENCV_AVAILABLE or not settings.ENABLE_CAMERA:
            return False

        try:
            self.camera = cv2.VideoCapture(0)
            if self.camera.isOpened():
                self.is_running = True
                return True
        except Exception as e:
            print(f"Failed to open camera: {e}")

        return False

    def stop(self):
        """停止摄像头"""
        self.is_running = False
        if self.camera:
            self.camera.release()
            self.camera = None

    def detect(self) -> FatigueMetrics:
        """执行一次疲劳检测"""
        if not self.is_running or not self.camera:
            return self._mock_detection()

        try:
            ret, frame = self.camera.read()
            if not ret:
                return self._mock_detection()

            # 转为灰度图
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            # 检测人脸
            faces = self.face_cascade.detectMultiScale(gray, 1.3, 5)

            eyes_detected = 0
            for (x, y, w, h) in faces:
                roi_gray = gray[y:y + h, x:x + w]

                # 检测眼睛
                eyes = self.eye_cascade.detectMultiScale(roi_gray)
                eyes_detected = len(eyes)

                # 简单的眨眼检测：如果检测不到眼睛，可能是在眨眼
                if eyes_detected < 2:
                    self.blink_count += 1

            # 计算眨眼频率
            elapsed = time.time() - self.last_blink_time
            if elapsed >= 60:
                blink_rate = self.blink_count
                self.blink_count = 0
                self.last_blink_time = time.time()
            else:
                blink_rate = (self.blink_count / elapsed) * 60 if elapsed > 0 else 0

            # 计算疲劳等级
            fatigue_level = self._calculate_fatigue_level(blink_rate, eyes_detected)

            return FatigueMetrics(
                blink_rate=blink_rate,
                yawn_count=self.yawn_count,
                head_pose=(0.0, 0.0, 0.0),
                fatigue_level=fatigue_level,
            )

        except Exception as e:
            print(f"Detection error: {e}")
            return self._mock_detection()

    def _calculate_fatigue_level(self, blink_rate: float, eyes_detected: int) -> int:
        """计算疲劳等级 (0-100)"""
        level = 0

        # 高眨眼频率表示疲劳
        if blink_rate > 20:
            level += 30
        elif blink_rate > 15:
            level += 20
        elif blink_rate < 5:
            # 极低的眨眼频率也可能表示疲劳（发呆）
            level += 25

        # 检测不到眼睛可能是闭眼/打瞌睡
        if eyes_detected == 0:
            level += 40
        elif eyes_detected == 1:
            level += 20

        return min(level, 100)

    def _mock_detection(self) -> FatigueMetrics:
        """Mock 检测结果 (用于测试)"""
        import random
        return FatigueMetrics(
            blink_rate=random.uniform(10, 20),
            yawn_count=random.randint(0, 2),
            head_pose=(0.0, 0.0, 0.0),
            fatigue_level=random.randint(10, 40),
        )

    def get_fatigue_level(self) -> int:
        """获取当前疲劳等级"""
        metrics = self.detect()
        return metrics.fatigue_level


# 全局实例
fatigue_detector = FatigueDetector()
