"""
FlowMate-Echo SenseVoice ASR Service
Recorded file recognition via OSS + DashScope Transcription
"""

import asyncio
import os
import re
import traceback
from typing import Dict, Optional

import httpx

from config import settings
from services.oss_uploader import oss_uploader

try:
    import dashscope
    from dashscope.audio.asr import Transcription
    DASHSCOPE_ASR_AVAILABLE = True
except Exception:
    dashscope = None
    Transcription = None
    DASHSCOPE_ASR_AVAILABLE = False


class SenseVoiceService:
    """SenseVoice ASR wrapper with recorded file recognition."""

    DEFAULT_MODEL = os.getenv("SENSEVOICE_MODEL", "sensevoice-v1")
    DEFAULT_SAMPLE_RATE = int(os.getenv("SENSEVOICE_SAMPLE_RATE", "16000"))
    DEFAULT_FORMAT = os.getenv("SENSEVOICE_AUDIO_FORMAT", "wav")
    TIMEOUT_SECONDS = int(os.getenv("SENSEVOICE_TIMEOUT_SECONDS", "20"))
    MOCK_MODE = os.getenv("SENSEVOICE_MOCK_MODE", "false").lower() == "true" or settings.DEBUG_MODE
    CLEANUP_AFTER_ASR = os.getenv("OSS_CLEANUP_AFTER_ASR", "false").lower() == "true"
    LANGUAGE_HINT = os.getenv("SENSEVOICE_LANGUAGE_HINT", "").strip()

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.model = self.DEFAULT_MODEL
        self.sample_rate = self.DEFAULT_SAMPLE_RATE

    async def transcribe(
        self,
        audio_bytes: bytes,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> Dict:
        """Return ASR result with text/emotion (best-effort)."""
        if not audio_bytes:
            return {
                "status": "error",
                "text": "",
                "emotion": "neutral",
                "error": {"code": "empty_audio", "message": "Audio payload is empty"},
            }

        audio_format = self._infer_format(filename, content_type) or self.DEFAULT_FORMAT
        print(
            "[ASR] transcribe_start "
            f"bytes={len(audio_bytes)} content_type={content_type} format={audio_format}"
        )
        if audio_format == "webm":
            print("[ASR] format_maybe_unsupported format=webm")

        if self.MOCK_MODE or not self.api_key or not DASHSCOPE_ASR_AVAILABLE:
            reasons = []
            if self.MOCK_MODE:
                reasons.append("mock_mode")
            if not self.api_key:
                reasons.append("missing_api_key")
            if not DASHSCOPE_ASR_AVAILABLE:
                reasons.append("dashscope_sdk_unavailable")
            reason = ",".join(reasons) or "unknown"
            print(
                "[ASR] mock_return "
                f"reason={reason} api_key_set={bool(self.api_key)} sdk_available={DASHSCOPE_ASR_AVAILABLE}"
            )
            return {
                "status": "mock",
                "text": "",
                "emotion": "neutral",
                "mock_reason": reason,
            }

        loop = asyncio.get_event_loop()
        try:
            response = await asyncio.wait_for(
                loop.run_in_executor(None, self._request, audio_bytes, audio_format, filename, content_type),
                timeout=self.TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            return {
                "status": "error",
                "text": "",
                "emotion": "neutral",
                "error": {
                    "code": "asr_timeout",
                    "message": f"ASR timed out after {self.TIMEOUT_SECONDS}s",
                },
            }
        except Exception as e:
            return {
                "status": "error",
                "text": "",
                "emotion": "neutral",
                "error": {"code": "asr_exception", "message": str(e)},
            }

        try:
            text = self._sanitize_text(self._extract_text(response))
            emotion = self._extract_emotion(response)
            if text:
                return {
                    "status": "success",
                    "text": text,
                    "emotion": emotion or "neutral",
                }

            error_code, error_message = self._extract_error_info(response)
            return {
                "status": "error",
                "text": "",
                "emotion": emotion or "neutral",
                "error": {
                    "code": error_code or "asr_no_text",
                    "message": error_message or "ASR returned empty text",
                },
            }
        except Exception as e:
            print(f"[ASR] parse error:\n{traceback.format_exc()}")
            return {
                "status": "error",
                "text": "",
                "emotion": "neutral",
                "error": {"code": "asr_parse_error", "message": str(e)},
            }

    def _request(
        self,
        audio_bytes: bytes,
        audio_format: str,
        filename: Optional[str],
        content_type: Optional[str],
    ):
        """Recorded file recognition via OSS + Transcription async task."""
        if dashscope:
            dashscope.api_key = self.api_key

        if Transcription is None:
            return None

        url, error = oss_uploader.upload_bytes(audio_bytes, filename, content_type)
        if not url:
            return {"error": {"code": "oss_upload_failed", "message": error or "OSS upload failed"}}

        response = None
        try:
            kwargs = {
                "model": self.model,
                "file_urls": [url],
                "format": audio_format,
                "sample_rate": self.sample_rate,
            }
            if self.LANGUAGE_HINT:
                kwargs["language_hints"] = [self.LANGUAGE_HINT]

            response = Transcription.async_call(**kwargs)
            print(f"[ASR] async_call response type: {type(response)}")
            raw_async = self._safe_as_dict(response)
            if raw_async:
                print(f"[ASR] async_call raw: {raw_async}")
            task_id = self._extract_task_id(response)
            if not task_id:
                return response

            response = Transcription.wait(task=task_id)
            print(f"[ASR] wait response type: {type(response)}")
            raw_wait = self._safe_as_dict(response)
            if raw_wait:
                print(f"[ASR] wait raw: {raw_wait}")
        finally:
            if self.CLEANUP_AFTER_ASR:
                object_key = self._extract_object_key(url)
                if object_key:
                    oss_uploader.delete_object(object_key)

        return response

    def _infer_format(self, filename: Optional[str], content_type: Optional[str]) -> Optional[str]:
        if content_type:
            if "wav" in content_type:
                return "wav"
            if "mp3" in content_type or "mpeg" in content_type:
                return "mp3"
            if "webm" in content_type:
                return "webm"
            if "ogg" in content_type:
                return "ogg"

        if filename and "." in filename:
            return filename.rsplit(".", 1)[-1].lower()

        return None

    def _extract_text(self, response) -> str:
        payload = self._resolve_transcription_payload(response)
        if not payload:
            return ""

        if isinstance(payload, dict):
            if payload.get("text"):
                return payload.get("text")
            if payload.get("transcript"):
                return payload.get("transcript")

            transcripts = payload.get("transcripts") or payload.get("results") or []
            if isinstance(transcripts, list) and transcripts:
                first = transcripts[0]
                if isinstance(first, dict):
                    return first.get("text") or first.get("transcript") or ""

        return ""

    def _sanitize_text(self, text: str) -> str:
        if not text:
            return ""
        # Remove ASR control tokens like <|Speech|> or <|/Speech|>.
        cleaned = re.sub(r"<\|.*?\|>", "", text)
        return cleaned.strip()

    def _extract_emotion(self, response) -> str:
        payload = self._resolve_transcription_payload(response)
        if not payload:
            return "neutral"

        if isinstance(payload, dict):
            if payload.get("emotion"):
                return payload.get("emotion")
            if payload.get("sentiment"):
                return payload.get("sentiment")

            transcripts = payload.get("transcripts") or payload.get("results") or []
            if isinstance(transcripts, list) and transcripts:
                first = transcripts[0]
                if isinstance(first, dict):
                    return first.get("emotion") or first.get("sentiment") or "neutral"

        return "neutral"

    def _extract_error_info(self, response):
        if response is None:
            return ("asr_no_response", "No response from ASR SDK")

        if isinstance(response, dict):
            if response.get("error"):
                err = response.get("error") or {}
                return (err.get("code") or "asr_error", err.get("message") or "ASR error")
            code = response.get("code") or response.get("error_code")
            message = response.get("message") or response.get("error_message")
            if code or message:
                return (code or "asr_error", message or "ASR error")
        else:
            response_dict = self._safe_as_dict(response)
            if response_dict:
                if response_dict.get("error"):
                    err = response_dict.get("error") or {}
                    return (err.get("code") or "asr_error", err.get("message") or "ASR error")
                code = response_dict.get("code") or response_dict.get("error_code")
                message = response_dict.get("message") or response_dict.get("error_message")
                if code or message:
                    return (code or "asr_error", message or "ASR error")

        get_response = self._safe_get_attr(response, "get_response")
        if callable(get_response):
            try:
                raw = get_response()
                if isinstance(raw, dict):
                    code = raw.get("code") or raw.get("error_code")
                    message = raw.get("message") or raw.get("error_message")
                    if code or message:
                        return (code or "asr_error", message or "ASR error")
            except Exception:
                pass

        code = getattr(response, "code", None)
        message = getattr(response, "message", None)
        if code or message:
            return (code or "asr_error", message or "ASR error")

        return ("asr_no_text", "ASR returned empty text")

    def _extract_task_id(self, response) -> Optional[str]:
        if response is None:
            return None

        output = self._safe_get_attr(response, "output")
        if output is None:
            output = self._safe_get_item(response, "output")
        if isinstance(output, dict) and output.get("task_id"):
            return output.get("task_id")

        get_response = self._safe_get_attr(response, "get_response")
        if callable(get_response):
            try:
                raw = get_response()
                if isinstance(raw, dict):
                    output = raw.get("output") or {}
                    if isinstance(output, dict) and output.get("task_id"):
                        return output.get("task_id")
            except Exception:
                pass

        task_id = getattr(response, "task_id", None)
        if isinstance(task_id, str):
            return task_id

        return None

    def _resolve_transcription_payload(self, response) -> Optional[Dict]:
        if response is None:
            return None

        if isinstance(response, dict) and response.get("error"):
            return None

        try:
            output = self._safe_get_attr(response, "output")
            if output is None:
                output = self._safe_get_item(response, "output")
            if isinstance(output, dict):
                results = output.get("results") or []
                if isinstance(results, list) and results:
                    first = results[0]
                    if isinstance(first, dict) and first.get("transcription_url"):
                        transcription_url = first.get("transcription_url")
                        print(f"[ASR] transcription_url (results): {transcription_url}")
                        return self._fetch_transcription_url(transcription_url)
                transcription_url = output.get("transcription_url")
                if transcription_url:
                    print(f"[ASR] transcription_url: {transcription_url}")
                    return self._fetch_transcription_url(transcription_url)
                return output

            get_response = self._safe_get_attr(response, "get_response")
            if callable(get_response):
                try:
                    raw = get_response()
                    if isinstance(raw, dict):
                        output = raw.get("output") or {}
                        results = output.get("results") or []
                        if isinstance(results, list) and results:
                            first = results[0]
                            if isinstance(first, dict) and first.get("transcription_url"):
                                transcription_url = first.get("transcription_url")
                                print(f"[ASR] transcription_url (results): {transcription_url}")
                                return self._fetch_transcription_url(transcription_url)
                        if isinstance(output, dict) and output.get("transcription_url"):
                            transcription_url = output.get("transcription_url")
                            print(f"[ASR] transcription_url: {transcription_url}")
                            return self._fetch_transcription_url(transcription_url)
                        return output
                except Exception:
                    pass
        except Exception:
            return None

        return None

    def _fetch_transcription_url(self, url: str) -> Optional[Dict]:
        try:
            with httpx.Client(timeout=20.0) as client:
                resp = client.get(url)
                resp.raise_for_status()
                data = resp.json()
                print(f"[ASR] transcription_url json: {data}")
                return data
        except Exception:
            return None

    def _safe_get_attr(self, obj, name: str):
        try:
            return getattr(obj, name)
        except Exception:
            return None

    def _safe_get_item(self, obj, key: str):
        try:
            if isinstance(obj, dict):
                return obj.get(key)
            return obj[key]
        except Exception:
            return None

    def _safe_as_dict(self, obj):
        try:
            if isinstance(obj, dict):
                return obj
            if hasattr(obj, "items"):
                return dict(obj.items())
            if hasattr(obj, "__getitem__"):
                return dict(obj)
        except Exception:
            return None
        return None

    def _extract_object_key(self, url: str) -> Optional[str]:
        if not url:
            return None
        parts = url.split("/", 3)
        if len(parts) >= 4:
            return parts[3]
        return None


sensevoice_service = SenseVoiceService()
