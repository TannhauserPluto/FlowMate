"""
FlowMate-Echo ModelScope Vision Service
Qwen-VL 视觉模型封装 - 截屏分析
"""

import base64
from typing import Optional
import httpx
from config import settings


class ModelScopeVision:
    """Qwen-VL 视觉模型服务"""

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.model = settings.QWEN_VL_MODEL
        self.base_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

    async def analyze_image(self, image_base64: str, prompt: str = "描述这张图片中的内容") -> Optional[str]:
        """分析图像内容"""
        if not self.api_key:
            return self._mock_analysis()

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
