"""
FlowMate-Echo ModelScope Audio Service
CosyVoice 语音合成封装
"""

import os
import uuid
import base64
from typing import Optional
from pathlib import Path
import httpx
from config import settings


class ModelScopeAudio:
    """CosyVoice 语音合成服务"""

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.model = settings.COSYVOICE_MODEL
        self.cache_dir = settings.AUDIO_CACHE_DIR
        self.base_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/synthesis"

    async def synthesize(self, text: str, voice: str = "longxiaochun") -> Optional[str]:
        """文本转语音
        
        Args:
            text: 要合成的文本
            voice: 音色选择 (longxiaochun, longxiaoxia, etc.)
            
        Returns:
            音频文件路径
        """
        if not self.api_key:
            return self._mock_audio(text)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": "cosyvoice-v1",
            "input": {
                "text": text,
                "voice": voice,
            },
            "parameters": {
                "format": "mp3",
                "sample_rate": 22050,
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

                # 保存音频文件
                audio_id = str(uuid.uuid4())[:8]
                audio_path = self.cache_dir / f"tts_{audio_id}.mp3"

                result = response.json()
                if "output" in result and "audio" in result["output"]:
                    audio_data = base64.b64decode(result["output"]["audio"])
                    with open(audio_path, "wb") as f:
                        f.write(audio_data)
                    return str(audio_path)

                return None

        except Exception as e:
            print(f"CosyVoice API error: {e}")
            return self._mock_audio(text)

    async def synthesize_encouragement(self, state: str, work_minutes: int) -> Optional[str]:
        """合成鼓励语音频"""
        encouragements = {
            "idle": "准备好了吗？我们开始吧",
            "working": f"你已经专注了{work_minutes}分钟，继续保持",
            "flow": "你正在专注状态，我不打扰你",
            "immunity": "检测到深度专注，已为你延长工作时间",
            "break": "休息一下吧，我在这里等你",
        }

        text = encouragements.get(state, "加油")
        return await self.synthesize(text)

    def _mock_audio(self, text: str) -> str:
        """Mock 音频生成 (用于测试)"""
        # 返回一个空的音频文件路径
        audio_id = str(uuid.uuid4())[:8]
        audio_path = self.cache_dir / f"mock_{audio_id}.mp3"

        # 创建空文件作为占位
        audio_path.touch()
        return str(audio_path)

    def cleanup_cache(self, max_files: int = 50):
        """清理缓存音频文件"""
        audio_files = list(self.cache_dir.glob("*.mp3"))
        if len(audio_files) > max_files:
            # 按修改时间排序，删除最旧的文件
            audio_files.sort(key=lambda x: x.stat().st_mtime)
            for f in audio_files[:-max_files]:
                f.unlink()


# 全局实例
audio_service = ModelScopeAudio()
