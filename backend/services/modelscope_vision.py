"""
FlowMate-Echo Vision Service
视觉感知模块 - MediaPipe Pose 在位检测 + Qwen-VL 截屏分析
"""

import base64
import cv2
import numpy as np
from typing import Optional, Dict
import httpx
import mediapipe as mp
from config import settings


class VisionService:
    """
    视觉服务 - 用户在位检测 (Presence Detection)
    使用 MediaPipe Pose 检测画面中是否有人
    """

    def __init__(self):
        # 初始化 MediaPipe Pose (只加载一次，避免内存泄漏)
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=True,  # 静态图片模式，适合单帧检测
            model_complexity=0,       # 0=Lite, 1=Full, 2=Heavy (0最快)
            enable_segmentation=False,
            min_detection_confidence=0.5,
        )
        self._initialized = True

    def detect_presence(self, image_bytes: bytes) -> Dict:
        """
        检测画面中是否有人
        
        Args:
            image_bytes: 图片的字节数据 (JPEG/PNG)
            
        Returns:
            {
                "presence": bool,      # 是否检测到人
                "confidence": float,   # 置信度 (0-1)
                "landmarks_count": int,# 检测到的骨骼点数量
                "debug_info": str      # 调试信息
            }
        """
        try:
            # 解码图片
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return {
                    "presence": False,
                    "confidence": 0.0,
                    "landmarks_count": 0,
                    "debug_info": "图片解码失败",
                }

            # 转换颜色空间 BGR -> RGB (MediaPipe 要求)
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

            # 执行姿态检测
            results = self.pose.process(image_rgb)

            # 判断是否检测到人
            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                landmarks_count = len(landmarks)
                
                # 计算平均可见度作为置信度
                visible_landmarks = [lm for lm in landmarks if lm.visibility > 0.5]
                confidence = len(visible_landmarks) / landmarks_count if landmarks_count > 0 else 0
                
                return {
                    "presence": True,
                    "confidence": round(confidence, 2),
                    "landmarks_count": landmarks_count,
                    "debug_info": f"检测到 {landmarks_count} 个骨骼点，{len(visible_landmarks)} 个高可见度",
                }
            else:
                return {
                    "presence": False,
                    "confidence": 0.0,
                    "landmarks_count": 0,
                    "debug_info": "未检测到人体姿态",
                }

        except Exception as e:
            return {
                "presence": False,
                "confidence": 0.0,
                "landmarks_count": 0,
                "debug_info": f"检测异常: {str(e)}",
            }

    def detect_presence_from_base64(self, image_base64: str) -> Dict:
        """
        从 Base64 字符串检测在位状态
        
        Args:
            image_base64: Base64 编码的图片 (可带或不带 data:image 前缀)
        """
        try:
            # 移除可能的 data URL 前缀
            if "," in image_base64:
                image_base64 = image_base64.split(",", 1)[1]
            
            # 解码 Base64
            image_bytes = base64.b64decode(image_base64)
            return self.detect_presence(image_bytes)
            
        except Exception as e:
            return {
                "presence": False,
                "confidence": 0.0,
                "landmarks_count": 0,
                "debug_info": f"Base64 解码失败: {str(e)}",
            }

    def __del__(self):
        """清理 MediaPipe 资源"""
        if hasattr(self, 'pose') and self.pose:
            self.pose.close()


# 全局实例 - 确保只初始化一次
presence_detector = VisionService()


class ModelScopeVision:
    """Qwen-VL 视觉模型服务"""

    def __init__(self):
        self.api_key = settings.DASHSCOPE_KEY
        self.model = settings.QWEN_VL_MODEL
        self.base_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

    async def analyze_image(self, image_base64: str, prompt: str = "描述这张图片中的内容") -> Optional[str]:
        """分析图像内容"""
        if not self.api_key:
            raise RuntimeError("DASHSCOPE_KEY is required for Qwen-VL. Set env DASHSCOPE_KEY.")

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        # 构建多模态消息
        payload = {
            "model": self.model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"image": image_base64},
                            {"text": prompt},
                        ],
                    }
                ]
            },
            "parameters": {
                "max_tokens": 500,
            },
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.base_url,
                    headers=headers,
                    json=payload,
                    timeout=30.0,
                )
                response.raise_for_status()
                result = response.json()
                return result["output"]["choices"][0]["message"]["content"][0]["text"]
        except Exception as e:
            print(f"Qwen-VL API error: {e}")
            return self._mock_analysis()

    async def analyze_screen(self, screenshot_base64: str) -> dict:
        """分析屏幕截图，判断用户工作状态"""
        prompt = """分析这张屏幕截图，判断用户的工作状态：
1. 用户正在使用什么应用/网站？
2. 用户是否在工作/学习？
3. 是否有分心的迹象（如社交媒体、视频网站）？
4. 给出专注度评分（1-10）

请用简洁的 JSON 格式回答：
{"app": "应用名", "is_working": true/false, "distraction": true/false, "focus_score": 数字}"""

        analysis = await self.analyze_image(screenshot_base64, prompt)

        # 尝试解析 JSON，失败则返回默认值
        try:
            import json
            return json.loads(analysis)
        except:
            return {
                "app": "unknown",
                "is_working": True,
                "distraction": False,
                "focus_score": 7,
                "raw_analysis": analysis,
            }

    def _mock_analysis(self) -> str:
        """Mock 分析结果 (用于测试)"""
        return '{"app": "IDE", "is_working": true, "distraction": false, "focus_score": 8}'


# 全局实例
vision_service = ModelScopeVision()
