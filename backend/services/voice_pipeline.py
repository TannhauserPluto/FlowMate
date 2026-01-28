"""
FlowMate-Echo Voice Pipeline Service
ASR (SenseVoice) -> LLM (Qwen-Max) -> TTS (CosyVoice)
"""

import asyncio
import time
from typing import Dict, Optional

from .modelscope_audio import audio_service
from .dashscope_service import dashscope_service
from .sensevoice_asr import sensevoice_service


class VoicePipelineService:
    """End-to-end voice pipeline with emotion arbitration."""

    def __init__(self):
        self.asr = sensevoice_service
        self.llm = dashscope_service
        self.tts = audio_service

    async def handle(
        self,
        audio_bytes: bytes,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> Dict:
        start = time.perf_counter()

        asr_start = time.perf_counter()
        asr_result = await self.asr.transcribe(audio_bytes, filename, content_type)
        asr_ms = int((time.perf_counter() - asr_start) * 1000)

        user_text = (asr_result.get("text") or "").strip()
        user_emotion = (asr_result.get("emotion") or "neutral").strip().lower()

        llm_start = time.perf_counter()
        if user_text:
            reply_text = await self._call_llm(user_text, user_emotion)
        else:
            reply_text = "刚才没听清楚，可以再说一遍吗？"
        llm_ms = int((time.perf_counter() - llm_start) * 1000)

        tts_emotion = self._map_emotion(user_emotion)

        tts_start = time.perf_counter()
        tts_result = await self.tts.speak(reply_text, tts_emotion)
        tts_ms = int((time.perf_counter() - tts_start) * 1000)

        total_ms = int((time.perf_counter() - start) * 1000)
        print(
            f"[VoicePipeline] asr_ms={asr_ms} llm_ms={llm_ms} "
            f"tts_ms={tts_ms} total_ms={total_ms}"
        )

        status = tts_result.get("status", "success")
        if asr_result.get("status") == "error":
            status = "error"

        response = {
            "status": status,
            "data": {
                "user": {
                    "text": user_text,
                    "emotion": user_emotion,
                },
                "assistant": {
                    "text": reply_text,
                    "emotion": tts_emotion,
                },
                "audio": {
                    "base64": tts_result.get("audio_data", ""),
                    "format": tts_result.get("format", "mp3"),
                    "sample_rate": tts_result.get("sample_rate", 24000),
                    "estimated_duration_ms": tts_result.get("estimated_duration_ms", 0),
                },
                "driver": {
                    "motion_trigger": tts_result.get("motion_trigger", "idle_breathing"),
                    "expression_trigger": tts_result.get("expression_trigger", "neutral"),
                    "subtitle": tts_result.get("subtitle", reply_text),
                },
            },
            "timings": {
                "asr_ms": asr_ms,
                "llm_ms": llm_ms,
                "tts_ms": tts_ms,
                "total_ms": total_ms,
            },
        }

        error_payload = self._merge_errors(asr_result, tts_result)
        if error_payload:
            response["error"] = error_payload

        return response

    async def _call_llm(self, user_text: str, user_emotion: str) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self.llm.generate_reply_from_asr, user_text, user_emotion
        )

    def _map_emotion(self, user_emotion: str) -> str:
        key = (user_emotion or "neutral").lower()
        if key in ("sad", "angry", "happy"):
            return "encouraging"
        return "neutral"

    def _merge_errors(self, asr_result: Dict, tts_result: Dict) -> Optional[Dict]:
        asr_error = asr_result.get("error")
        tts_error = tts_result.get("error")
        if not asr_error and not tts_error:
            return None
        return {
            "asr": asr_error,
            "tts": tts_error,
        }


voice_pipeline_service = VoicePipelineService()
