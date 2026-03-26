"""
FlowMate-Echo ModelScope Audio Service
CosyVoice TTS and motion driver
"""

import asyncio
import base64
import json
import os
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from config import settings

try:
    import dashscope
    from dashscope.audio.tts_v2 import AudioFormat, SpeechSynthesizer
    DASHSCOPE_AVAILABLE = True
except Exception:
    dashscope = None
    SpeechSynthesizer = None
    AudioFormat = None
    DASHSCOPE_AVAILABLE = False


class ModelScopeAudio:
    """CosyVoice TTS + virtual avatar driver."""

    DEFAULT_VOICE = os.getenv("COSYVOICE_VOICE", "longanyang")
    FALLBACK_VOICE = os.getenv("COSYVOICE_FALLBACK_VOICE", "longanyang")
    AUDIO_FORMAT = "mp3"
    SAMPLE_RATE = 24000
    MAX_ESTIMATED_DURATION_MS = 20000
    TTS_TIMEOUT_SECONDS = int(os.getenv("TTS_TIMEOUT_SECONDS", "20"))
    TTS_CACHE_MAX_ITEMS = int(os.getenv("TTS_CACHE_MAX_ITEMS", "1024"))
    TTS_CACHEABLE_TEXT_MAX_CHARS = int(os.getenv("TTS_CACHEABLE_TEXT_MAX_CHARS", "120"))
    TTS_USE_INSTRUCTION = os.getenv("TTS_USE_INSTRUCTION", "false").lower() == "true"
    TTS_REUSE_SYNTH_SESSION = os.getenv("TTS_REUSE_SYNTH_SESSION", "false").lower() == "true"

    MOCK_MODE = os.getenv("AUDIO_MOCK_MODE", "false").lower() == "true" or settings.DEBUG_MODE

    EMOTION_CONFIG = {
        "neutral": {
            "voice": None,
            "rate": 1.0,
            "instruction": None,
            "motion": "idle_breathing",
            "expression": "neutral",
        },
        "strict": {
            "voice": None,
            "rate": 0.92,
            "instruction": None,
            "motion": "explain",
            "expression": "serious",
        },
        "encouraging": {
            "voice": None,
            "rate": 1.05,
            "instruction": None,
            "motion": "clapping",
            "expression": "smile",
        },
        "shush": {
            "voice": None,
            "rate": 0.85,
            "instruction": None,
            "motion": "shush_gesture",
            "expression": "worry",
        },
    }

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.model = settings.COSYVOICE_MODEL
        self.cache_dir = settings.AUDIO_CACHE_DIR
        self.mock_dir = Path(__file__).resolve().parent.parent / "assets" / "mock_audio"
        self._last_tts_error_code = None
        self._last_tts_error_message = None
        self._last_tts_error_details: Dict[str, Any] = {}
        self._tts_audio_cache: OrderedDict[str, str] = OrderedDict()
        self._synth_clients: Dict[str, SpeechSynthesizer] = {}
        self._synth_client_locks: Dict[str, threading.Lock] = {}
        self._synth_client_cache_lock = threading.Lock()
        self._warmup_started = False
        self._warmup_lock = threading.Lock()

    def _compact_log_text(self, text: Optional[str], limit: int = 160) -> str:
        cleaned = " ".join(str(text or "").replace("\r", " ").replace("\n", " ").split())
        if len(cleaned) > limit:
            return f"{cleaned[:limit]}..."
        return cleaned

    def _stringify_log_value(self, value: Any, limit: int = 400) -> Optional[str]:
        if value in (None, "", b""):
            return None
        try:
            if isinstance(value, (dict, list, tuple)):
                text = json.dumps(value, ensure_ascii=False, default=str)
            elif isinstance(value, (bytes, bytearray)):
                text = f"<bytes:{len(value)}>"
            else:
                text = str(value)
        except Exception as exc:
            text = f"<unserializable:{exc}>"
        text = " ".join(text.replace("\r", " ").replace("\n", " ").split())
        if len(text) > limit:
            return f"{text[:limit]}..."
        return text or None

    def _read_value(self, source: Any, *keys: str) -> Any:
        if source is None:
            return None
        if isinstance(source, dict):
            for key in keys:
                value = source.get(key)
                if value not in (None, ""):
                    return value
            return None
        for key in keys:
            value = getattr(source, key, None)
            if value not in (None, ""):
                return value
        return None

    def _build_tts_error_details(
        self,
        *,
        text: str,
        voice: str,
        rate: float,
        realtime_after_cache_miss: bool,
        response: Any = None,
        exc: Optional[Exception] = None,
    ) -> Dict[str, Any]:
        response_obj = response
        if exc is not None:
            response_obj = (
                getattr(exc, "response", None)
                or getattr(exc, "http_response", None)
                or getattr(exc, "raw_response", None)
                or response_obj
            )

        raw_response = None
        get_response = getattr(response_obj, "get_response", None)
        if callable(get_response):
            try:
                raw_response = get_response()
            except Exception as raw_exc:
                raw_response = {"get_response_error": str(raw_exc)}

        error_source = raw_response if raw_response is not None else response_obj
        http_status = self._read_value(error_source, "status_code", "http_status", "status")
        if http_status in (None, ""):
            http_status = self._read_value(response_obj, "status_code", "http_status", "status")

        code = self._read_value(error_source, "code", "error_code")
        if code in (None, ""):
            code = self._read_value(response_obj, "code", "error_code")

        message = self._read_value(error_source, "message", "error_message", "detail")
        if message in (None, ""):
            message = self._read_value(response_obj, "message", "error_message", "detail")

        error_type = self._read_value(error_source, "type", "error_type")
        if error_type in (None, ""):
            error_type = self._read_value(response_obj, "type", "error_type")

        sdk_error = self._read_value(error_source, "error", "sdk_error", "details")
        if sdk_error in (None, ""):
            sdk_error = self._read_value(response_obj, "error", "sdk_error", "details")

        if exc is not None:
            error_type = error_type or exc.__class__.__name__
            code = code or "tts_exception"
            message = self._stringify_log_value(str(exc), limit=240) or message or "TTS exception"
            sdk_error = sdk_error or repr(exc)
            if http_status in (None, ""):
                http_status = getattr(exc, "status_code", None)
        else:
            if http_status not in (None, "", 200) and not code:
                code = "tts_http_error"
            if http_status not in (None, "", 200) and not message:
                message = f"TTS HTTP {http_status}"
            code = code or "tts_no_audio"
            message = self._stringify_log_value(message, limit=240) or "TTS returned empty audio"
            error_type = error_type or code or "tts_error"

        return {
            "type": self._stringify_log_value(error_type, limit=120) or "tts_error",
            "code": self._stringify_log_value(code, limit=120) or "tts_error",
            "message": self._stringify_log_value(message, limit=240) or "TTS error",
            "http_status": http_status,
            "response_body": self._stringify_log_value(error_source),
            "sdk_error": self._stringify_log_value(sdk_error),
            "model": self.model,
            "voice": voice,
            "rate": rate,
            "text": self._compact_log_text(text),
            "text_length": len((text or "").strip()),
            "realtime_after_cache_miss": bool(realtime_after_cache_miss),
        }

    def _set_tts_error_details(self, details: Optional[Dict[str, Any]]) -> None:
        details = dict(details or {})
        self._last_tts_error_details = details
        self._last_tts_error_code = details.get("code")
        self._last_tts_error_message = details.get("message")

    def _log_tts_error(self, details: Optional[Dict[str, Any]]) -> None:
        payload = dict(details or {})
        print(
            "[TTS] error "
            f"type={payload.get('type') or '-'} "
            f"message={payload.get('message') or '-'} "
            f"http_status={payload.get('http_status')} "
            f"code={payload.get('code') or '-'} "
            f"model={payload.get('model') or self.model} "
            f"voice={payload.get('voice') or '-'} "
            f"rate={payload.get('rate')} "
            f"text={payload.get('text') or '-'} "
            f"len={payload.get('text_length') or 0} "
            f"realtime_after_cache_miss={payload.get('realtime_after_cache_miss')} "
            f"response_body={payload.get('response_body') or '-'} "
            f"sdk_error={payload.get('sdk_error') or '-'}"
        )

    def _build_tts_cache_key(
        self,
        text: str,
        emotion_key: str,
        voice: str,
        rate: float,
        instruction: str,
    ) -> str:
        return f"{emotion_key}|{voice}|{rate}|{instruction}|{text.strip()}"

    def _is_cacheable_text(self, text: str) -> bool:
        cleaned = (text or "").strip()
        return bool(cleaned) and len(cleaned) <= self.TTS_CACHEABLE_TEXT_MAX_CHARS

    def _get_cached_audio(self, key: str) -> Optional[str]:
        cached = self._tts_audio_cache.get(key)
        if not cached:
            return None
        self._tts_audio_cache.move_to_end(key)
        return cached

    def _store_cached_audio(self, key: str, audio_b64: str) -> None:
        if not key or not audio_b64:
            return
        self._tts_audio_cache[key] = audio_b64
        self._tts_audio_cache.move_to_end(key)
        print(f"[TTSCache] store key={key[:120]}")
        while len(self._tts_audio_cache) > self.TTS_CACHE_MAX_ITEMS:
            self._tts_audio_cache.popitem(last=False)

    def _build_tts_client_key(
        self,
        voice: str,
        rate: float,
        instruction: Optional[str],
        with_rate: bool,
        with_instruction: bool,
    ) -> str:
        safe_instruction = (instruction or "") if with_instruction else ""
        safe_rate = f"{max(0.5, min(2.0, rate)):.2f}" if with_rate else "default"
        return f"{self.model}|{voice}|{safe_rate}|{bool(with_instruction and safe_instruction)}|{safe_instruction}"

    def _build_synth_client_kwargs(
        self,
        voice: str,
        rate: float,
        instruction: Optional[str],
        with_rate: bool,
        with_instruction: bool,
    ) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "voice": voice,
            "format": AudioFormat.MP3_24000HZ_MONO_256KBPS,
        }
        if with_rate:
            kwargs["speech_rate"] = max(0.5, min(2.0, rate))
        if with_instruction and instruction:
            kwargs["instruction"] = instruction
        return kwargs

    def _safe_close_synth_client(self, client) -> None:
        if client is None:
            return
        for method_name in ("close", "shutdown", "disconnect"):
            method = getattr(client, method_name, None)
            if callable(method):
                try:
                    method()
                except Exception:
                    pass
                return

    def _remove_synth_client_locked(self, client_key: str) -> None:
        client = self._synth_clients.pop(client_key, None)
        self._synth_client_locks.pop(client_key, None)
        self._safe_close_synth_client(client)

    def _discard_synth_client(self, client_key: str, reason: str) -> None:
        with self._synth_client_cache_lock:
            existed = client_key in self._synth_clients
            self._remove_synth_client_locked(client_key)
        if existed:
            print(f"[TTSClient] discard reason={reason} key={client_key[:120]}")

    def _cleanup_synth_client_after_request(self, client) -> None:
        if self.TTS_REUSE_SYNTH_SESSION:
            return
        self._safe_close_synth_client(client)

    def _check_closed_state(self, source: Any, label: str) -> Optional[str]:
        if source is None:
            return None
        for attr in ("closed", "is_closed", "_closed"):
            value = getattr(source, attr, None)
            if value is True:
                return f"{label}.{attr}=true"
        for attr in ("connected", "is_connected"):
            value = getattr(source, attr, None)
            if value is False:
                return f"{label}.{attr}=false"
        for attr in ("state", "ready_state", "status", "connection_state"):
            value = getattr(source, attr, None)
            if value is None:
                continue
            state_text = str(value).strip().lower()
            if any(token in state_text for token in ("closed", "closing", "disconnect", "terminated")):
                return f"{label}.{attr}={state_text}"
        sock = getattr(source, "sock", None)
        if sock is not None and getattr(sock, "connected", None) is False:
            return f"{label}.sock.connected=false"
        return None

    def _check_synth_client_reusable(self, client) -> Tuple[bool, str]:
        if client is None:
            return False, "missing_client"
        if not self.TTS_REUSE_SYNTH_SESSION:
            return False, "session_reuse_disabled"
        for attr in ("websocket", "ws", "_ws", "_websocket", "connection", "_connection", "socket", "_socket"):
            reason = self._check_closed_state(getattr(client, attr, None), attr)
            if reason:
                return False, reason
        reason = self._check_closed_state(client, "client")
        if reason:
            return False, reason
        worker = getattr(client, "thread", None) or getattr(client, "_thread", None)
        if worker is not None and hasattr(worker, "is_alive") and not worker.is_alive():
            return False, "client.thread_not_alive"
        return True, "state_not_exposed_assume_reusable"

    def _is_closed_connection_exception(self, exc: Exception) -> bool:
        exc_name = exc.__class__.__name__.lower()
        message = str(exc or "").lower()
        return (
            "websocketconnectionclosedexception" in exc_name
            or "connection is already closed" in message
            or ("websocket" in message and "closed" in message)
        )

    def _get_or_create_synth_client(
        self,
        voice: str,
        rate: float,
        instruction: Optional[str],
        with_rate: bool,
        with_instruction: bool,
        force_recreate: bool = False,
        recreate_reason: str = "manual",
    ):
        client_key = self._build_tts_client_key(voice, rate, instruction, with_rate, with_instruction)
        if not self.TTS_REUSE_SYNTH_SESSION:
            print(
                f"[TTSClient] health_check reusable=false reason=session_reuse_disabled key={client_key[:120]}"
            )
            if force_recreate:
                print(f"[TTSClient] recreate reason={recreate_reason} key={client_key[:120]}")
            kwargs = self._build_synth_client_kwargs(voice, rate, instruction, with_rate, with_instruction)
            recreated_success = False
            try:
                client = SpeechSynthesizer(**kwargs)
                recreated_success = True
            finally:
                if force_recreate:
                    print(f"[TTSClient] recreated success={'true' if recreated_success else 'false'} key={client_key[:120]}")
            lock = threading.Lock()
            print(f"[TTSClient] reused=false key={client_key[:120]}")
            return client, lock, False, client_key
        with self._synth_client_cache_lock:
            client = self._synth_clients.get(client_key)
            if client is not None and not force_recreate:
                reusable, reason = self._check_synth_client_reusable(client)
                print(
                    f"[TTSClient] health_check reusable={'true' if reusable else 'false'} "
                    f"reason={reason} key={client_key[:120]}"
                )
                if reusable:
                    lock = self._synth_client_locks.get(client_key)
                    if lock is None:
                        lock = threading.Lock()
                        self._synth_client_locks[client_key] = lock
                    print(f"[TTSClient] reused=true key={client_key[:120]}")
                    return client, lock, True, client_key
                self._remove_synth_client_locked(client_key)
            elif client is not None and force_recreate:
                self._remove_synth_client_locked(client_key)
            if force_recreate:
                print(f"[TTSClient] recreate reason={recreate_reason} key={client_key[:120]}")
            kwargs = self._build_synth_client_kwargs(voice, rate, instruction, with_rate, with_instruction)
            recreated_success = False
            try:
                client = SpeechSynthesizer(**kwargs)
                recreated_success = True
            finally:
                if force_recreate:
                    print(f"[TTSClient] recreated success={'true' if recreated_success else 'false'} key={client_key[:120]}")
            lock = threading.Lock()
            self._synth_clients[client_key] = client
            self._synth_client_locks[client_key] = lock
        print(f"[TTSClient] reused=false key={client_key[:120]}")
        return client, lock, False, client_key

    def _get_preload_texts_legacy(self) -> List[str]:
        return [
            "我刚刚没听清，我们再说一次就好。",
            "好，我们先看第一步。",
            "好，先把这一步做完。",
            "好，我来帮你拆一下。",
            "别急，我们先找个方向。",
            "你好啊，我现在充满动力和你一起学习，你今天准备干什么呢",
            "不客气，我们继续。",
        ]

    def _get_preload_texts(self) -> List[str]:
        return [
            "\u521a\u624d\u6ca1\u542c\u6e05\uff0c\u53ef\u4ee5\u518d\u8bf4\u4e00\u904d\u5417\uff1f",
            "\u597d\uff0c\u6211\u4eec\u5148\u770b\u7b2c\u4e00\u6b65\u3002",
            "\u597d\uff0c\u5148\u628a\u8fd9\u4e00\u6b65\u505a\u5b8c\u3002",
            "\u597d\uff0c\u6211\u6765\u5e2e\u4f60\u62c6\u4e00\u4e0b\u3002",
            "\u522b\u6025\uff0c\u6211\u4eec\u5148\u627e\u4e2a\u65b9\u5411\u3002",
            "\u4f60\u597d\u5440\uff0c\u4eca\u5929\u60f3\u505a\u4ec0\u4e48\uff1f",
            "\u55e8\uff0c\u4eca\u5929\u51c6\u5907\u5fd9\u4ec0\u4e48\uff1f",
            "\u4e0d\u5ba2\u6c14\uff0c\u6211\u4eec\u7ee7\u7eed\u3002",
            "\u597d\uff0c\u6211\u77e5\u9053\u4e86\u3002",
            "\u597d\uff0c\u6211\u4eec\u7ee7\u7eed\u3002",
            "\u53ef\u4ee5\uff0c\u6211\u6309\u8fd9\u4e2a\u7ee7\u7eed\u3002",
            "\u6ca1\u4e8b\uff0c\u6211\u4eec\u628a\u5b83\u518d\u62c6\u5c0f\u4e00\u70b9\u3002",
            "\u5148\u505a\u773c\u524d\u8fd9\u4e00\u6b65\u3002",
            "\u7ee7\u7eed\uff0c\u6211\u966a\u7740\u4f60\u3002",
            "\u6211\u5728\uff0c\u7ee7\u7eed\u8bf4\u3002",
            "\u518d\u8bf4\u4e00\u904d\u4e5f\u53ef\u4ee5\u3002",
        ]

    def ensure_warmup_started(self) -> None:
        if not settings.TTS_WARMUP_ENABLED or self.MOCK_MODE or not self.api_key or not DASHSCOPE_AVAILABLE:
            return
        with self._warmup_lock:
            if self._warmup_started:
                return
            self._warmup_started = True
        threading.Thread(target=self._run_warmup, name="flowmate-tts-warmup", daemon=True).start()

    def _run_warmup(self) -> None:
        start = time.perf_counter()
        print("[TTSWarmup] start")
        try:
            if dashscope:
                dashscope.api_key = self.api_key
            if SpeechSynthesizer is None or AudioFormat is None:
                raise RuntimeError("dashscope_tts_unavailable")
            self._get_or_create_synth_client(self.DEFAULT_VOICE, 1.0, None, True, False)
            if self.FALLBACK_VOICE and self.FALLBACK_VOICE != self.DEFAULT_VOICE:
                self._get_or_create_synth_client(self.FALLBACK_VOICE, 1.0, None, True, False)
            preload_count = 0
            if settings.TTS_PRELOAD_COMMON_TEXTS:
                print("[TTSCache] preload_start")
                for text in self._get_preload_texts():
                    try:
                        result = asyncio.run(self.speak(text, "neutral"))
                        if result.get("audio_data"):
                            preload_count += 1
                    except Exception:
                        continue
                print(f"[TTSCache] preload_done count={preload_count}")
            print(f"[TTSWarmup] success ms={int((time.perf_counter() - start) * 1000)}")
        except Exception as exc:
            print(f"[TTSWarmup] failed reason={exc}")

    async def speak(self, text: str, emotion: str) -> Dict:
        """Generate Base64 audio and motion/expression signals."""
        emotion_key = self._normalize_emotion(emotion)
        config = self.EMOTION_CONFIG.get(emotion_key, self.EMOTION_CONFIG["neutral"])

        voice = config.get("voice") or self.DEFAULT_VOICE
        rate = config.get("rate", 1.0)
        instruction = config.get("instruction") if self.TTS_USE_INSTRUCTION else None
        synth_text = (text or "").strip()
        cache_key = self._build_tts_cache_key(synth_text, emotion_key, voice, rate, instruction or "")
        cacheable = self._is_cacheable_text(synth_text)
        cache_hit = False
        cache_fallback_used = False
        realtime_after_cache_miss = False
        tts_source = "none"

        error_code = None
        error_message = None
        error_details: Dict[str, Any] = {}

        cached_audio_b64 = None
        if not self.MOCK_MODE and cacheable:
            cached_audio_b64 = self._get_cached_audio(cache_key)

        if cached_audio_b64:
            print(f"[TTSCache] hit key={cache_key[:120]}")
            audio_b64 = cached_audio_b64
            status = "cached"
            cache_hit = True
            tts_source = "cache"
        elif self.MOCK_MODE or not self.api_key or not DASHSCOPE_AVAILABLE:
            reasons = []
            if self.MOCK_MODE:
                reasons.append("mock_mode")
            if not self.api_key:
                reasons.append("missing_api_key")
            if not DASHSCOPE_AVAILABLE:
                reasons.append("dashscope_sdk_unavailable")
            reason = ",".join(reasons) or "unknown"
            snippet = synth_text.replace("\n", " ").strip()
            if len(snippet) > 80:
                snippet = f"{snippet[:80]}..."
            print(
                "[TTS] mock_return "
                f"reason={reason} api_key_set={bool(self.api_key)} sdk_available={DASHSCOPE_AVAILABLE} "
                f"text={snippet}"
            )
            audio_b64 = self._load_mock_audio(emotion_key)
            status = "mock"
            tts_source = "mock"
        else:
            realtime_after_cache_miss = True
            if cacheable:
                print(f"[TTSCache] miss key={cache_key[:120]}")
            try:
                audio_b64 = await self._call_cosyvoice(synth_text, voice, rate, instruction)
            except asyncio.TimeoutError as exc:
                audio_b64 = None
                error_code = "tts_timeout"
                error_message = f"TTS request timed out after {self.TTS_TIMEOUT_SECONDS}s"
                error_details = self._build_tts_error_details(
                    text=synth_text,
                    voice=voice,
                    rate=rate,
                    realtime_after_cache_miss=realtime_after_cache_miss,
                    exc=exc,
                )
                error_details["code"] = error_code
                error_details["message"] = error_message
                self._set_tts_error_details(error_details)
            except Exception as exc:
                audio_b64 = None
                error_code = "tts_exception"
                error_message = str(exc)
                error_details = self._build_tts_error_details(
                    text=synth_text,
                    voice=voice,
                    rate=rate,
                    realtime_after_cache_miss=realtime_after_cache_miss,
                    exc=exc,
                )
                error_details["code"] = error_code
                error_details["message"] = self._stringify_log_value(error_message, limit=240) or error_message
                self._set_tts_error_details(error_details)

            if audio_b64:
                status = "success"
                tts_source = "realtime"
                if cacheable:
                    self._store_cached_audio(cache_key, audio_b64)
            else:
                error_details = dict(error_details or self._last_tts_error_details or {})
                error_code = error_code or error_details.get("code") or self._last_tts_error_code or "tts_failed"
                error_message = error_message or error_details.get("message") or self._last_tts_error_message or "TTS returned empty audio"
                if cacheable:
                    fallback_audio_b64 = self._get_cached_audio(cache_key)
                    if fallback_audio_b64:
                        print(f"[TTSCache] fallback_hit key={cache_key[:120]}")
                        audio_b64 = fallback_audio_b64
                        status = "cached_fallback"
                        tts_source = "cache_fallback"
                        cache_fallback_used = True
                    else:
                        status = "error"
                else:
                    status = "error"

        estimated_duration_ms = self._estimate_duration_ms(synth_text)
        result = {
            "status": status,
            "audio_data": audio_b64 or "",
            "format": self.AUDIO_FORMAT,
            "sample_rate": self.SAMPLE_RATE,
            "estimated_duration_ms": estimated_duration_ms,
            "motion_trigger": config.get("motion", "idle_breathing"),
            "expression_trigger": config.get("expression", "neutral"),
            "subtitle": synth_text,
            "emotion": emotion_key,
            "voice": voice,
            "model": self.model,
            "rate": rate,
            "tts_source": tts_source,
            "cache_hit": cache_hit,
            "cache_fallback_used": cache_fallback_used,
            "realtime_after_cache_miss": realtime_after_cache_miss,
        }
        if error_code or error_message:
            error_payload = dict(error_details or self._last_tts_error_details or {})
            error_payload["code"] = error_code or error_payload.get("code") or "tts_failed"
            error_payload["message"] = error_message or error_payload.get("message") or "TTS returned empty audio"
            error_payload.setdefault("type", error_payload.get("code") or "tts_error")
            error_payload.setdefault("model", self.model)
            error_payload.setdefault("voice", voice)
            error_payload.setdefault("rate", rate)
            error_payload.setdefault("text", self._compact_log_text(synth_text))
            error_payload.setdefault("text_length", len(synth_text))
            error_payload.setdefault("realtime_after_cache_miss", realtime_after_cache_miss)
            result["error"] = error_payload
            if status == "error":
                self._log_tts_error(error_payload)
            elif cache_fallback_used:
                print(
                    "[TTS] cache_fallback "
                    f"code={error_payload.get('code')} message={error_payload.get('message')} "
                    f"model={self.model} voice={voice} rate={rate} text={self._compact_log_text(synth_text)}"
                )
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
        with open(audio_path, "wb") as file_obj:
            file_obj.write(audio_bytes)
        return str(audio_path)

    async def speak_chunks(self, chunks: List[str], emotion: str) -> List[Dict]:
        """Generate TTS audio for each chunk in order."""
        results: List[Dict] = []
        for chunk in chunks:
            start = time.perf_counter()
            result = await self.speak(chunk, emotion)
            result["_tts_ms"] = int((time.perf_counter() - start) * 1000)
            results.append(result)
        return results

    async def _call_cosyvoice(
        self,
        text: str,
        voice: str,
        rate: float,
        instruction: Optional[str],
    ) -> Optional[str]:
        """Call DashScope SDK and return Base64 audio."""
        self._last_tts_error_code = None
        self._last_tts_error_message = None
        self._last_tts_error_details = {}

        def _request(
            with_rate: bool = True,
            with_default_voice: bool = False,
            with_instruction: bool = False,
            force_recreate: bool = False,
            recreate_reason: str = "manual",
        ):
            if dashscope:
                dashscope.api_key = self.api_key
            if SpeechSynthesizer is None or AudioFormat is None:
                return None
            resolved_voice = self.DEFAULT_VOICE if with_default_voice else voice
            synth, synth_lock, _, client_key = self._get_or_create_synth_client(
                resolved_voice,
                rate,
                instruction,
                with_rate,
                with_instruction,
                force_recreate=force_recreate,
                recreate_reason=recreate_reason,
            )
            try:
                with synth_lock:
                    try:
                        return synth.call(text)
                    except Exception as exc:
                        if self._is_closed_connection_exception(exc):
                            self._discard_synth_client(client_key, "closed_connection")
                        raise
            finally:
                self._cleanup_synth_client_after_request(synth)

        loop = asyncio.get_event_loop()
        request_variants = [
            (True, False, False),
            (False, False, False),
            (False, True, False),
            (True, False, True),
            (False, False, True),
        ]
        last_response = None
        for with_rate, with_default_voice, with_instruction in request_variants:
            resolved_voice = self.DEFAULT_VOICE if with_default_voice else voice
            print(
                "[TTS] request_variant "
                f"with_rate={with_rate} with_default_voice={with_default_voice} "
                f"with_instruction={with_instruction and bool(instruction)}"
            )
            try:
                response = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda: _request(with_rate, with_default_voice, with_instruction),
                    ),
                    timeout=self.TTS_TIMEOUT_SECONDS,
                )
            except Exception as exc:
                error_details = self._build_tts_error_details(
                    text=text,
                    voice=resolved_voice,
                    rate=rate,
                    realtime_after_cache_miss=True,
                    exc=exc,
                )
                self._set_tts_error_details(error_details)
                print(
                    "[TTS] request_variant_error "
                    f"with_rate={with_rate} with_default_voice={with_default_voice} "
                    f"with_instruction={with_instruction and bool(instruction)} "
                    f"type={error_details.get('type')} message={error_details.get('message')} "
                    f"http_status={error_details.get('http_status')}"
                )
                if self._is_closed_connection_exception(exc):
                    retry_voice = resolved_voice
                    print("[TTSRetry] retry_after_recreate=true")
                    try:
                        retry_response = await asyncio.wait_for(
                            loop.run_in_executor(
                                None,
                                lambda: _request(
                                    False,
                                    with_default_voice,
                                    False,
                                    True,
                                    "closed_connection",
                                ),
                            ),
                            timeout=self.TTS_TIMEOUT_SECONDS,
                        )
                    except Exception as retry_exc:
                        retry_error_details = self._build_tts_error_details(
                            text=text,
                            voice=retry_voice,
                            rate=rate,
                            realtime_after_cache_miss=True,
                            exc=retry_exc,
                        )
                        self._set_tts_error_details(retry_error_details)
                        print("[TTSRetry] retry_result status=error")
                        break
                    retry_audio_b64 = self._extract_audio_base64(retry_response)
                    if retry_audio_b64:
                        print("[TTSRetry] retry_result status=success")
                        return retry_audio_b64
                    self._set_tts_error_from_response(
                        retry_response,
                        text=text,
                        voice=retry_voice,
                        rate=rate,
                        realtime_after_cache_miss=True,
                    )
                    last_response = retry_response
                    print("[TTSRetry] retry_result status=error")
                    break
                continue
            last_response = response
            audio_b64 = self._extract_audio_base64(response)
            if audio_b64:
                return audio_b64
            self._set_tts_error_from_response(
                response,
                text=text,
                voice=resolved_voice,
                rate=rate,
                realtime_after_cache_miss=True,
            )

        if last_response is not None:
            self._set_tts_error_from_response(
                last_response,
                text=text,
                voice=voice,
                rate=rate,
                realtime_after_cache_miss=True,
            )
        return None

    def _set_tts_error_from_response(
        self,
        response,
        *,
        text: str,
        voice: str,
        rate: float,
        realtime_after_cache_miss: bool,
    ) -> None:
        details = self._build_tts_error_details(
            text=text,
            voice=voice,
            rate=rate,
            realtime_after_cache_miss=realtime_after_cache_miss,
            response=response,
        )
        self._set_tts_error_details(details)

    def _extract_error_info(self, response):
        details = self._build_tts_error_details(
            text="",
            voice=self.DEFAULT_VOICE,
            rate=1.0,
            realtime_after_cache_miss=False,
            response=response,
        )
        return (
            details.get("code") or "tts_error",
            details.get("message") or "TTS error",
        )

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
        duration = len((text or "").strip()) * 250
        return min(duration, self.MAX_ESTIMATED_DURATION_MS)


audio_service = ModelScopeAudio()
