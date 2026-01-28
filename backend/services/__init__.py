"""
backend/services 模块初始化
"""

from .modelscope_vision import ModelScopeVision, vision_service, VisionService, presence_detector
from .modelscope_audio import ModelScopeAudio, audio_service
from .fatigue_detector import FatigueDetector, FatigueMetrics, fatigue_detector
from .dashscope_service import DashScopeService, dashscope_service
from .screen_agent import ScreenAgentService, screen_agent

__all__ = [
    "ModelScopeVision",
    "vision_service",
    "VisionService",
    "presence_detector",
    "ModelScopeAudio",
    "audio_service",
    "FatigueDetector",
    "FatigueMetrics",
    "fatigue_detector",
    "DashScopeService",
    "dashscope_service",
    "ScreenAgentService",
    "screen_agent",
]
