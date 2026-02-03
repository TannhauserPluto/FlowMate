"""
FlowMate-Echo ModelScope Audio Service
CosyVoice TTS and motion driver
"""

import asyncio
import base64
import os
import uuid
from pathlib import Path
from typing import Dict, Optional

from config import settings

# Attempt to import DashScope SDK (tts_v2 for CosyVoice v3)
try:
    import dashscope
    from dashscope.audio.tts_v2 import SpeechSynthesizer, AudioFormat
    DASHSCOPE_AVAILABLE = True
except Exception:
    dashscope = None
    SpeechSynthesizer = None
    AudioFormat = None
    DASHSCOPE_AVAILABLE = False


class ModelScopeAudio:
    """CosyVoice TTS + virtual avatar driver"""

    DEFAULT_VOICE = os.getenv("COSYVOICE_VOICE", "longanyang")
    FALLBACK_VOICE = os.getenv("COSYVOICE_FALLBACK_VOICE", "longanyang")
    AUDIO_FORMAT = "mp3"
    SAMPLE_RATE = 24000
    MAX_ESTIMATED_DURATION_MS = 20000
    TTS_TIMEOUT_SECONDS = int(os.getenv("TTS_TIMEOUT_SECONDS", "20"))

    # Mock switch (env or DEBUG)
    MOCK_MODE = os.getenv("AUDIO_MOCK_MODE", "false").lower() == "true" or settings.DEBUG_MODE

    # Emotion mapping: business emotion -> voice params + motion/expression
    EMOTION_CONFIG = {
        "neutral": {
            "voice": None,
            "rate": 1.0,
            "instruction": "你正在进行闲聊互动，你说话的情感是neutral。",
            "motion": "idle_breathing",
            "expression": "neutral",
        },
        "strict": {
            "voice": None,
            "rate": 0.9,
            "instruction": "你正在进行新闻播报，你说话的情感是neutral。",
            "motion": "explain",
            "expression": "serious",
        },
        "encouraging": {
            "voice": None,
            "rate": 1.1,
            "instruction": "你正在进行闲聊互动，你说话的情感是happy。",
            "motion": "clapping",
            "expression": "smile",
        },
        "shush": {
            "voice": None,
            "rate": 0.8,
            "instruction": "你正在以一个故事机的身份说话，你说话的情感是neutral。",
            "motion": "shush_gesture",
            "expression": "worry",
        },
    }

    def __init__(self):
        self.api_key = settings.DASHSCOPE_KEY
        self.model = settings.COSYVOICE_MODEL
        self.cache_dir = settings.AUDIO_CACHE_DIR
        self.mock_dir = Path(__file__).resolve().parent.parent / "assets" / "mock_audio"
        self._last_tts_error_code = None
        self._last_tts_error_message = None

    async def speak(self, text: str, emotion: str) -> Dict:
        """Generate Base64 audio and motion/expression signals."""
        emotion_key = self._normalize_emotion(emotion)
        config = self.EMOTION_CONFIG.get(emotion_key, self.EMOTION_CONFIG["neutral"])

        voice = config.get("voice") or self.DEFAULT_VOICE
        rate = config.get("rate", 1.0)
        instruction = config.get("instruction", "你说话的情感是neutral。")
        synth_text = text

        error_code = None
        error_message = None

        if self.MOCK_MODE:
            audio_b64 = self._load_mock_audio(emotion_key)
            status = "mock"
        elif not self.api_key:
            audio_b64 = ""
            status = "error"
            error_code = "missing_dashscope_key"
            error_message = "DASHSCOPE_KEY is required for TTS. Set env DASHSCOPE_KEY."
        elif not DASHSCOPE_AVAILABLE:
            audio_b64 = ""
            status = "error"
            error_code = "dashscope_unavailable"
            error_message = "DashScope SDK is unavailable. Install dashscope to enable TTS."
        else:
            try:
                audio_b64 = await self._call_cosyvoice(synth_text, voice, rate, instruction)
            except asyncio.TimeoutError:
                audio_b64 = None
                error_code = "tts_timeout"
                error_message = f"TTS request timed out after {self.TTS_TIMEOUT_SECONDS}s"
                self._last_tts_error_code = error_code
                self._last_tts_error_message = error_message
            except Exception as e:
                audio_b64 = None
                error_code = "tts_exception"
                error_message = str(e)
                self._last_tts_error_code = error_code
                self._last_tts_error_message = error_message

            if audio_b64:
                status = "success"
            else:
                error_code = error_code or self._last_tts_error_code or "tts_failed"
                error_message = error_message or self._last_tts_error_message or "TTS returned empty audio"
                audio_b64 = self._load_mock_audio(emotion_key)
                status = "mock" if audio_b64 else "error"

        estimated_duration_ms = self._estimate_duration_ms(text)

        result = {
            "status": status,
            "audio_data": audio_b64 or "",
            "format": self.AUDIO_FORMAT,
            "sample_rate": self.SAMPLE_RATE,
            "estimated_duration_ms": estimated_duration_ms,
            "motion_trigger": config.get("motion", "idle_breathing"),
            "expression_trigger": config.get("expression", "neutral"),
            "subtitle": text,
            "emotion": emotion_key,
        }
        if error_code or error_message:
            result["error"] = {
                "code": error_code,
                "message": error_message,
            }
        return result

    async def synthesize(self, text: str, voice: str = "longxiaochun") -> Optional[str]:
        """Deprecated: file-based output for backward compatibility."""
        result = await self.speak(text, "neutral")
        audio_b64 = result.get("audio_data")
        if not audio_b64:
            return None

        audio_bytes = base64.b64decode(audio_b64)
        audio_id = str(uuid.uuid4())[:8]
        audio_path = self.cache_dir / f"tts_{audio_id}.mp3"
        with open(audio_path, "wb") as f:
            f.write(audio_bytes)
        return str(audio_path)

    async def _call_cosyvoice(
        self,
        text: str,
        voice: str,
        rate: float,
        instruction: str,
    ) -> Optional[str]:
        """Call DashScope SDK and return Base64 audio."""
        self._last_tts_error_code = None
        self._last_tts_error_message = None
        last_response = None
        def _request():
            # tts_v2 SpeechSynthesizer returns bytes
            if dashscope:
                dashscope.api_key = self.api_key
            if SpeechSynthesizer is None or AudioFormat is None:
                return None
            safe_rate = max(0.5, min(2.0, rate))
            synth = SpeechSynthesizer(
                model=self.model,
                voice=voice,
                format=AudioFormat.MP3_24000HZ_MONO_256KBPS,
                speech_rate=safe_rate,
                instruction=instruction,
            )
            return synth.call(text)

        def _request_minimal():
            # Fallback: minimal parameters only
            if dashscope:
                dashscope.api_key = self.api_key
            if SpeechSynthesizer is None or AudioFormat is None:
                return None
            synth = SpeechSynthesizer(
                model=self.model,
                voice=voice,
                format=AudioFormat.MP3_24000HZ_MONO_256KBPS,
                instruction=instruction,
            )
            return synth.call(text)

        def _request_ultra_minimal():
            # Fallback: text only with default voice
            if dashscope:
                dashscope.api_key = self.api_key
            if SpeechSynthesizer is None or AudioFormat is None:
                return None
            synth = SpeechSynthesizer(
                model=self.model,
                voice=self.DEFAULT_VOICE,
                format=AudioFormat.MP3_24000HZ_MONO_256KBPS,
                instruction=instruction,
            )
            return synth.call(text)

        loop = asyncio.get_event_loop()
        response = await asyncio.wait_for(
            loop.run_in_executor(None, _request),
            timeout=self.TTS_TIMEOUT_SECONDS,
        )
        last_response = response
        audio_b64 = self._extract_audio_base64(response)
        if audio_b64:
            return audio_b64

        # Retry with minimal parameters
        response_min = await asyncio.wait_for(
            loop.run_in_executor(None, _request_minimal),
            timeout=self.TTS_TIMEOUT_SECONDS,
        )
        last_response = response_min
        audio_b64_min = self._extract_audio_base64(response_min)
        if audio_b64_min:
            return audio_b64_min

        response_ultra = await asyncio.wait_for(
            loop.run_in_executor(None, _request_ultra_minimal),
            timeout=self.TTS_TIMEOUT_SECONDS,
        )
        last_response = response_ultra
        audio_b64_ultra = self._extract_audio_base64(response_ultra)
        if audio_b64_ultra:
            return audio_b64_ultra

        self._set_tts_error_from_response(last_response)
        return None

    def _set_tts_error_from_response(self, response) -> None:
        code, message = self._extract_error_info(response)
        self._last_tts_error_code = code
        self._last_tts_error_message = message

    def _extract_error_info(self, response):
        if response is None:
            return ("tts_no_response", "No response from TTS SDK")

        get_response = getattr(response, "get_response", None)
        if callable(get_response):
            try:
                raw = get_response()
                if isinstance(raw, dict):
                    code = raw.get("code") or raw.get("error_code")
                    message = raw.get("message") or raw.get("error_message")
                    if code or message:
                        return (code or "tts_error", message or "TTS error")
                else:
                    code = getattr(raw, "code", None) or getattr(raw, "error_code", None)
                    message = getattr(raw, "message", None) or getattr(raw, "error_message", None)
                    if code or message:
                        return (code or "tts_error", message or "TTS error")
            except Exception:
                pass

        code = getattr(response, "code", None)
        message = getattr(response, "message", None)
        if code or message:
            return (code or "tts_error", message or "TTS error")

        return ("tts_no_audio", "TTS returned empty audio")

    def _extract_audio_base64(self, response) -> Optional[str]:
        """Extract Base64 audio from SDK response."""
        if response is None:
            return None

        if isinstance(response, (bytes, bytearray)):
            return base64.b64encode(bytes(response)).decode("utf-8")

        if isinstance(response, dict):
            output = response.get("output") or {}
            if isinstance(output, dict):
                if output.get("audio"):
                    return output.get("audio")
                data = output.get("data") or {}
                if isinstance(data, dict) and data.get("audio"):
                    return data.get("audio")

        status_code = getattr(response, "status_code", None)
        if status_code not in (None, 200):
            return None

        output = getattr(response, "output", None)
        if isinstance(output, dict):
            if output.get("audio"):
                return output.get("audio")
            data = output.get("data") or {}
            if isinstance(data, dict) and data.get("audio"):
                return data.get("audio")
        elif output is not None:
            audio = getattr(output, "audio", None)
            if audio:
                return audio
            data = getattr(output, "data", None)
            if isinstance(data, dict) and data.get("audio"):
                return data.get("audio")

        audio_attr = getattr(response, "audio", None)
        if isinstance(audio_attr, bytes):
            return base64.b64encode(audio_attr).decode("utf-8")
        if isinstance(audio_attr, str) and audio_attr:
            return audio_attr

        # SpeechSynthesizer returns SpeechSynthesisResult with get_audio_data()
        get_audio_data = getattr(response, "get_audio_data", None)
        if callable(get_audio_data):
            try:
                audio_val = get_audio_data()
                if isinstance(audio_val, bytes):
                    return base64.b64encode(audio_val).decode("utf-8")
                if isinstance(audio_val, (list, tuple)):
                    chunks = []
                    for item in audio_val:
                        if isinstance(item, (bytes, bytearray)):
                            chunks.append(bytes(item))
                    if chunks:
                        return base64.b64encode(b"".join(chunks)).decode("utf-8")
                if isinstance(audio_val, str) and audio_val:
                    return audio_val
            except Exception:
                pass

        get_audio = getattr(response, "get_audio", None)
        if callable(get_audio):
            try:
                audio_val = get_audio()
                if isinstance(audio_val, bytes):
                    return base64.b64encode(audio_val).decode("utf-8")
                if isinstance(audio_val, str) and audio_val:
                    return audio_val
            except Exception:
                pass

        # Fallback: try get_response() to inspect raw payload
        get_response = getattr(response, "get_response", None)
        if callable(get_response):
            try:
                raw = get_response()
                if isinstance(raw, dict):
                    output = raw.get("output") or {}
                    if isinstance(output, dict) and output.get("audio"):
                        return output.get("audio")
            except Exception:
                pass

        return None

    def _load_mock_audio(self, emotion: str) -> str:
        """Mock mode: load local audio and return Base64."""
        if not self.mock_dir.exists():
            return ""

        filename = f"{emotion}.mp3"
        path = self.mock_dir / filename
        if not path.exists():
            path = self.mock_dir / "neutral.mp3"
        if not path.exists():
            return ""

        data = path.read_bytes()
        return base64.b64encode(data).decode("utf-8")

    def _normalize_emotion(self, emotion: str) -> str:
        if not emotion:
            return "neutral"
        emotion_key = emotion.strip().lower()
        return emotion_key if emotion_key in self.EMOTION_CONFIG else "neutral"

    def _estimate_duration_ms(self, text: str) -> int:
        # MVP: estimate by char count to avoid heavy deps
        duration = len(text.strip()) * 250
        return min(duration, self.MAX_ESTIMATED_DURATION_MS)


# Global instance
audio_service = ModelScopeAudio()
