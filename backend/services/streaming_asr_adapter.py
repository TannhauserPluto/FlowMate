"""
FlowMate-Echo streaming ASR adapter (WS test path).
Fallback implementation: buffer audio chunks and run non-streaming ASR on end.
"""

from __future__ import annotations

import time
from typing import Dict, Optional, List, Tuple
import threading
import struct
import base64
import inspect
import os
import json
import re

from .sensevoice_asr import sensevoice_service
from config import settings

try:
    import dashscope
    from dashscope.audio.asr import Recognition
    DASHSCOPE_STREAM_AVAILABLE = True
except Exception:
    dashscope = None
    Recognition = None
    DASHSCOPE_STREAM_AVAILABLE = False


VOICE_PARTIAL_FILLER_RE = re.compile(r"^(?:啊|嗯|哦|噢|诶|欸|唉|哎|哈|喂|呃|额|呢|啦|呀|嘛|吧|好的|好啊|好呀|好呢|嗯嗯|啊啊|哦哦|诶诶|欸欸|哎呀)+$")


_STREAM_REGION_ENDPOINT_CACHE: Optional[Tuple[str, str, str]] = None
_STREAM_REGION_ENDPOINT_CACHE_LOCK = threading.Lock()


def _is_usable_partial_text(text: Optional[str]) -> bool:
    cleaned = " ".join(str(text or "").split()).strip()
    if not cleaned:
        return False
    compact = re.sub(r"[\s，。！？、,.!?;；:：'\"“”‘’（）()【】\[\]<>《》]", "", cleaned)
    if not compact:
        return False
    if len(compact) < 2:
        return False
    if VOICE_PARTIAL_FILLER_RE.fullmatch(compact):
        return False
    return True


def _infer_extension(mime_type: Optional[str]) -> str:
    if not mime_type:
        return "webm"
    mime = mime_type.lower()
    if "pcm" in mime or "raw" in mime:
        return "pcm"
    if "wav" in mime:
        return "wav"
    if "mpeg" in mime or "mp3" in mime:
        return "mp3"
    if "webm" in mime:
        return "webm"
    if "ogg" in mime:
        return "ogg"
    return "webm"


def _resolve_stream_region_or_endpoint() -> Tuple[str, str, str]:
    global _STREAM_REGION_ENDPOINT_CACHE
    with _STREAM_REGION_ENDPOINT_CACHE_LOCK:
        if _STREAM_REGION_ENDPOINT_CACHE is not None:
            return _STREAM_REGION_ENDPOINT_CACHE

    explicit_endpoint = (
        (settings.ASR_STREAM_ENDPOINT or "").strip()
        or (os.getenv("DASHSCOPE_ENDPOINT") or "").strip()
        or (os.getenv("DASHSCOPE_API_BASE") or "").strip()
        or str(getattr(dashscope, "api_base", "") or "").strip()
        or str(getattr(dashscope, "base_url", "") or "").strip()
        or str(getattr(dashscope, "endpoint", "") or "").strip()
    )

    def infer_region(candidate: str) -> Optional[str]:
        lower = (candidate or "").strip().lower()
        if lower in ("cn", "china", "mainland"):
            return "cn"
        if lower in ("intl", "international", "overseas", "sg", "singapore"):
            return "intl"
        if any(token in lower for token in ("intl", "international", "overseas", "ap-southeast", "singapore", "sg")):
            return "intl"
        if any(token in lower for token in ("aliyuncs.com", "cn-", "china", "hangzhou")):
            return "cn"
        return None
    
    if explicit_endpoint:
        inferred = infer_region(explicit_endpoint) or (settings.ASR_STREAM_DEFAULT_REGION or "intl").strip().lower() or "intl"
        resolved = (inferred, explicit_endpoint, "endpoint")
        with _STREAM_REGION_ENDPOINT_CACHE_LOCK:
            _STREAM_REGION_ENDPOINT_CACHE = resolved
        return resolved

    explicit_region = (settings.ASR_STREAM_REGION or "").strip().lower()
    if explicit_region and explicit_region != "auto":
        inferred = infer_region(explicit_region)
        if inferred:
            resolved = (inferred, f"sdk_default:{inferred}", "config")
            with _STREAM_REGION_ENDPOINT_CACHE_LOCK:
                _STREAM_REGION_ENDPOINT_CACHE = resolved
            return resolved

    env_region = (
        os.getenv("DASHSCOPE_REGION")
        or os.getenv("DASHSCOPE_API_REGION")
        or ""
    ).strip().lower()
    inferred_env = infer_region(env_region)
    if inferred_env:
        resolved = (inferred_env, f"sdk_default:{inferred_env}", "env")
        with _STREAM_REGION_ENDPOINT_CACHE_LOCK:
            _STREAM_REGION_ENDPOINT_CACHE = resolved
        return resolved

    default_region = infer_region(settings.ASR_STREAM_DEFAULT_REGION) or "intl"
    resolved = (default_region, f"sdk_default:{default_region}", "default")
    with _STREAM_REGION_ENDPOINT_CACHE_LOCK:
        _STREAM_REGION_ENDPOINT_CACHE = resolved
    return resolved


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int, channels: int = 1, sample_width: int = 2) -> bytes:
    byte_rate = sample_rate * channels * sample_width
    block_align = channels * sample_width
    data_size = len(pcm_bytes)
    riff_size = 36 + data_size
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        riff_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        sample_width * 8,
        b"data",
        data_size,
    )
    return header + pcm_bytes


def _payload_preview(value, depth: int = 0, max_depth: int = 2):
    if depth >= max_depth:
        return "<max_depth>"
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        preview = {}
        for key in list(value.keys())[:8]:
            preview[key] = _payload_preview(value.get(key), depth + 1, max_depth)
        return preview
    if isinstance(value, (list, tuple)):
        return [_payload_preview(item, depth + 1, max_depth) for item in list(value)[:3]]
    if hasattr(value, "__dict__"):
        return _payload_preview(vars(value), depth + 1, max_depth)
    return str(value)[:200]


def _normalize_payload(payload, depth: int = 0, max_depth: int = 4, seen=None):
    if seen is None:
        seen = set()
    if payload is None:
        return None
    if isinstance(payload, (str, int, float, bool)):
        return payload
    if isinstance(payload, (bytes, bytearray, memoryview)):
        return f"<bytes:{len(payload)}>"
    if id(payload) in seen:
        return "<cycle>"
    seen.add(id(payload))
    if depth >= max_depth:
        return "<max_depth>"
    if isinstance(payload, dict):
        prioritized = [
            "output",
            "sentence",
            "text",
            "result",
            "transcript",
            "content",
            "utterance",
            "hypothesis",
        ]
        keys = list(payload.keys())
        ordered: List[str] = [k for k in prioritized if k in payload]
        ordered.extend([k for k in keys if k not in ordered])
        normalized = {}
        for key in ordered[:50]:
            normalized[key] = _normalize_payload(payload.get(key), depth + 1, max_depth, seen)
        return normalized
    if isinstance(payload, (list, tuple)):
        return [_normalize_payload(item, depth + 1, max_depth, seen) for item in list(payload)[:20]]
    if hasattr(payload, "__dict__"):
        data = vars(payload)
        if data:
            return _normalize_payload(data, depth + 1, max_depth, seen)
    for method_name in ("model_dump", "dict", "to_dict"):
        method = getattr(payload, method_name, None)
        if callable(method):
            try:
                signature = inspect.signature(method)
                if len(signature.parameters) == 0:
                    data = method()
                    return _normalize_payload(data, depth + 1, max_depth, seen)
            except Exception:
                continue
    attrs = {}
    for name in (
        "output",
        "sentence",
        "text",
        "result",
        "transcript",
        "content",
        "utterance",
        "hypothesis",
        "results",
        "sentences",
        "status",
        "code",
        "message",
    ):
        if hasattr(payload, name):
            try:
                value = getattr(payload, name)
            except Exception:
                continue
            if callable(value):
                continue
            attrs[name] = _normalize_payload(value, depth + 1, max_depth, seen)
    if attrs:
        return attrs
    return str(payload)[:200]


def _collect_text_candidates(payload, max_items: int = 6, depth: int = 0, max_depth: int = 4) -> List[str]:
    if payload is None or depth > max_depth or max_items <= 0:
        return []
    text_keys = {
        "text",
        "sentence",
        "transcript",
        "result",
        "content",
        "utterance",
        "hypothesis",
    }
    list_keys = {
        "sentences",
        "sentence_list",
        "results",
        "alternatives",
        "utterances",
    }
    results: List[str] = []

    def _add_text(value):
        if isinstance(value, str) and value.strip():
            results.append(value.strip())

    if isinstance(payload, dict):
        for key in list(payload.keys())[:30]:
            value = payload.get(key)
            if key in text_keys:
                if isinstance(value, str):
                    _add_text(value)
                elif isinstance(value, (dict, list, tuple)):
                    results.extend(_collect_text_candidates(value, max_items - len(results), depth + 1, max_depth))
            elif key in list_keys:
                results.extend(_collect_text_candidates(value, max_items - len(results), depth + 1, max_depth))
            elif isinstance(value, (dict, list, tuple)):
                results.extend(_collect_text_candidates(value, max_items - len(results), depth + 1, max_depth))
            if len(results) >= max_items:
                break
        return results[:max_items]

    if isinstance(payload, (list, tuple)):
        for item in list(payload)[:10]:
            results.extend(_collect_text_candidates(item, max_items - len(results), depth + 1, max_depth))
            if len(results) >= max_items:
                break
        return results[:max_items]

    for attr in ("text", "sentence", "transcript", "result", "content", "output"):
        value = getattr(payload, attr, None)
        if isinstance(value, (dict, list, tuple)):
            results.extend(_collect_text_candidates(value, max_items - len(results), depth + 1, max_depth))
        else:
            _add_text(value)
        if len(results) >= max_items:
            break
    return results[:max_items]


def _summarize_payload(payload) -> Dict[str, object]:
    normalized = _normalize_payload(payload)
    info: Dict[str, object] = {"type": type(payload).__name__}
    if isinstance(normalized, dict):
        info["keys"] = list(normalized.keys())[:20]
        info["sample"] = _payload_preview(normalized)
    elif isinstance(normalized, (list, tuple)):
        info["len"] = len(normalized)
        info["sample"] = _payload_preview(normalized)
    else:
        info["sample"] = _payload_preview(normalized)
    candidates = _collect_text_candidates(normalized, max_items=4)
    if candidates:
        info["text_candidates"] = candidates
    return info


class StreamingAsrSession:
    def __init__(self, turn_id: str):
        self.turn_id = turn_id
        self.start_at = time.perf_counter()
        self.first_chunk_at: Optional[float] = None
        self.first_partial_at: Optional[float] = None
        self.total_bytes = 0
        self.count = 0
        self.last_seq = -1
        self.mime_type: Optional[str] = None
        self.sample_rate: Optional[int] = None
        self.buffer = bytearray()
        self.stream_backend: Optional[DashscopeStreamingBackend] = None
        self.stream_failed = False
        self.stream_attempted = False
        self.last_partial_text = ""
        self.last_usable_partial_text = ""
        self.final_text: Optional[str] = None
        self.final_sent = False
        self._partial_results: List[Dict[str, str]] = []
        self._partial_lock = threading.Lock()

    def add_chunk(
        self,
        chunk: bytes,
        seq: Optional[int],
        mime_type: Optional[str],
        sample_rate: Optional[int],
    ) -> None:
        if self.first_chunk_at is None:
            self.first_chunk_at = time.perf_counter()
            first_audio_ms = int((self.first_chunk_at - self.start_at) * 1000)
            print(f"[ws] first_audio_chunk_ms={first_audio_ms} turn_id={self.turn_id}")
        if mime_type and not self.mime_type:
            self.mime_type = mime_type
        if sample_rate and not self.sample_rate:
            self.sample_rate = sample_rate
        if isinstance(seq, int):
            expected = self.last_seq + 1
            if self.last_seq >= 0 and seq != expected:
                print(
                    "[ws] asr_chunk_seq_gap "
                    f"expected={expected} got={seq} turn_id={self.turn_id}"
                )
            self.last_seq = seq
        self.buffer.extend(chunk)
        self.total_bytes += len(chunk)
        self.count += 1

    def ensure_streaming(self) -> None:
        if self.stream_backend or self.stream_failed:
            return
        self.stream_attempted = True
        if not DASHSCOPE_STREAM_AVAILABLE or not settings.DASHSCOPE_API_KEY:
            print(f"[ws] asr_stream_unavailable turn_id={self.turn_id} reason=missing_sdk_or_key")
            self.stream_failed = True
            return
        if self.mime_type and "webm" in self.mime_type.lower():
            print(
                "[ws] asr_stream_mime_maybe_unsupported "
                f"turn_id={self.turn_id} mime={self.mime_type} transcode=none"
            )
        stream_format = _infer_extension(self.mime_type)
        stream_sample_rate = self.sample_rate or settings.SENSEVOICE_SAMPLE_RATE
        print(
            "[ws] asr_stream_input "
            f"turn_id={self.turn_id} mime={self.mime_type} format={stream_format} "
            f"sample_rate={stream_sample_rate} transcode=none"
        )
        region, endpoint, source = _resolve_stream_region_or_endpoint()
        print(f"[ASRConfig] resolved_region={region} source={source} turn_id={self.turn_id}")
        print(f"[ASRConfig] resolved_endpoint={endpoint} turn_id={self.turn_id}")
        if region == "intl":
            stream_model = settings.ASR_STREAM_MODEL_INTL
        else:
            stream_model = settings.ASR_STREAM_MODEL
        print(
            "[ws] asr_stream_model="
            f"{stream_model} turn_id={self.turn_id} region={region}"
        )
        self.stream_backend = DashscopeStreamingBackend(
            turn_id=self.turn_id,
            model=stream_model,
            sample_rate=stream_sample_rate,
            audio_format=stream_format,
            on_result=self._on_stream_result,
            endpoint=None if endpoint.startswith("sdk_default:") else endpoint,
        )
        if not self.stream_backend.active:
            print(
                "[ws] asr_stream_init_failed "
                f"turn_id={self.turn_id} error={self.stream_backend.last_error}"
            )
            self.stream_backend = None
            self.stream_failed = True

    def push_stream(self, chunk: bytes) -> None:
        if not self.stream_backend or self.stream_failed:
            return
        try:
            if not self.stream_backend.send_audio(chunk):
                print(
                    "[ws] asr_stream_send_failed "
                    f"turn_id={self.turn_id} error={self.stream_backend.last_error}"
                )
                self.stream_failed = True
                self.stream_backend = None
        except Exception as exc:
            print(f"[ws] asr_stream_send_error turn_id={self.turn_id} error={exc}")
            self.stream_failed = True
            self.stream_backend = None

    def stop_stream(self) -> None:
        if not self.stream_backend:
            return
        try:
            print(f"[ws] asr_stream_stop_called turn_id={self.turn_id}")
            self.stream_backend.stop()
        except Exception as exc:
            print(f"[ws] asr_stream_stop_error turn_id={self.turn_id} error={exc}")
        finally:
            self.stream_backend = None

    def _on_stream_result(
        self,
        payload,
        is_final: Optional[bool] = None,
        label: Optional[str] = None,
    ) -> None:
        text, final_flag, output_no_text, source, output_keys = _extract_stream_text(payload)
        if output_no_text:
            output_keys_label = ",".join(output_keys) if output_keys else "none"
            print(
                "[ws] asr_stream_output_no_text "
                f"label={label or 'unknown'} turn_id={self.turn_id} output_keys={output_keys_label}"
            )
        if is_final is not None:
            final_flag = is_final
        if not text:
            return
        if text == self.last_partial_text:
            return
        print(
            "[ws] asr_stream_text_extracted "
            f"label={label or 'unknown'} source={source} text={text[:200]}"
        )
        self.last_partial_text = text
        if _is_usable_partial_text(text):
            self.last_usable_partial_text = text
        if self.first_partial_at is None:
            self.first_partial_at = time.perf_counter()
            first_partial_ms = int((self.first_partial_at - self.start_at) * 1000)
            print(f"[ws] first_partial_asr_ms={first_partial_ms} turn_id={self.turn_id}")
        with self._partial_lock:
            self._partial_results.append({"text": text, "phase": "partial"})
            if final_flag:
                self.final_text = text
                final_ms = int((time.perf_counter() - self.start_at) * 1000)
                print(f"[ws] final_asr_ms={final_ms} turn_id={self.turn_id}")

    def drain_partials(self) -> List[Dict[str, str]]:
        with self._partial_lock:
            if not self._partial_results:
                return []
            results = list(self._partial_results)
            self._partial_results.clear()
            return results


def _extract_stream_text(payload) -> Tuple[str, bool, bool, str, List[str]]:
    if payload is None:
        return "", False, False, "", []

    normalized = _normalize_payload(payload)
    output_value = normalized.get("output") if isinstance(normalized, dict) else None
    output_keys: List[str] = []
    if isinstance(output_value, dict):
        output_keys = list(output_value.keys())[:20]
    elif output_value is not None:
        output_keys = [f"<{type(output_value).__name__}>"]

    def first_text(value) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip() if value.strip() else ""
        candidates = _collect_text_candidates(_normalize_payload(value), max_items=1)
        return candidates[0] if candidates else ""

    def pick_from_output() -> Tuple[str, str]:
        if not isinstance(output_value, dict):
            return "", ""
        for key in ("sentence", "text", "result"):
            if key in output_value:
                text = first_text(output_value.get(key))
                if text:
                    return text, f"output.{key}"
        return "", ""

    def pick_from_top() -> Tuple[str, str]:
        if not isinstance(normalized, dict):
            return "", ""
        for key in ("sentence", "text", "result"):
            if key in normalized:
                text = first_text(normalized.get(key))
                if text:
                    return text, key
        return "", ""

    def pick_final(obj) -> bool:
        if obj is None:
            return False
        if isinstance(obj, (list, tuple)):
            return any(pick_final(item) for item in obj)
        if isinstance(obj, dict):
            for key in ("is_final", "final", "sentence_end", "end", "finished"):
                if obj.get(key) is True:
                    return True
            output = obj.get("output")
            if output is not None:
                return pick_final(output)
        return False

    text, source = pick_from_output()
    if not text:
        text, source = pick_from_top()
    if not text:
        candidates = _collect_text_candidates(normalized, max_items=1)
        if candidates:
            text = candidates[0]
            source = "fallback_scan"
    output_no_text = isinstance(normalized, dict) and "output" in normalized and not text
    return text, pick_final(normalized), output_no_text, source, output_keys


class DashscopeStreamingBackend:
    class Callback:
        def __init__(self, backend: "DashscopeStreamingBackend") -> None:
            self._backend = backend

        def on_open(self) -> None:
            print(f"[ws] asr_stream_on_open turn_id={self._backend.turn_id}")
            self._backend._opened = True
            self._backend._flush_pending()

        def on_start(self) -> None:
            self.on_open()

        def on_event(self, event) -> None:
            self._backend._log_payload_once("event", event)
            self._backend.on_result(event, None, "event")

        def on_message(self, message) -> None:
            self._backend._log_payload_once("message", message)
            self._backend.on_result(message, None, "message")

        def on_result(self, result) -> None:
            self._backend._log_payload_once("result", result)
            self._backend.on_result(result, None, "result")

        def on_complete(self, payload=None) -> None:
            self._backend._log_payload_once("complete", payload)
            if payload is not None:
                self._backend.on_result(payload, True, "complete")
            print(f"[ws] asr_stream_on_complete turn_id={self._backend.turn_id}")

        def on_close(self) -> None:
            print(f"[ws] asr_stream_on_close turn_id={self._backend.turn_id}")

        def on_error(self, error) -> None:
            self._backend.last_error = str(error)
            self._backend.active = False
            print(
                "[ws] asr_stream_on_error "
                f"turn_id={self._backend.turn_id} error={self._backend.last_error}"
            )

    def __init__(
        self,
        turn_id: str,
        model: str,
        sample_rate: int,
        audio_format: str,
        on_result,
        endpoint: Optional[str] = None,
    ) -> None:
        self.turn_id = turn_id
        self.model = model
        self.sample_rate = sample_rate
        self.audio_format = audio_format
        self.on_result = on_result
        self.endpoint = endpoint
        self.active = False
        self.last_error: Optional[str] = None
        self._recognition = None
        self._callback = None
        self._opened = False
        self._pending_chunks: List[bytes] = []
        self._send_method = None
        self._send_method_name: Optional[str] = None
        self._methods_logged = False
        self._payload_log_counts: Dict[str, int] = {
            "event": 0,
            "message": 0,
            "result": 0,
            "complete": 0,
        }
        self._payload_no_text_counts: Dict[str, int] = {
            "event": 0,
            "message": 0,
            "result": 0,
            "complete": 0,
        }
        try:
            if dashscope:
                dashscope.api_key = settings.DASHSCOPE_API_KEY
                if self.endpoint:
                    try:
                        dashscope.api_base = self.endpoint
                    except Exception:
                        pass
            if Recognition is None:
                raise RuntimeError("Recognition unavailable")
            self._callback = DashscopeStreamingBackend.Callback(self)
            self._recognition = Recognition(
                model=self.model,
                format=self.audio_format,
                sample_rate=self.sample_rate,
                callback=self._callback,
            )
            if hasattr(self._recognition, "start"):
                self._recognition.start()
            else:
                raise RuntimeError("Recognition.start missing")
            self._resolve_send_method()
            self.active = True
            print(
                "[ws] asr_stream_init_ok "
                f"turn_id={self.turn_id} model={self.model} format={self.audio_format}"
            )
        except Exception as exc:
            self.last_error = str(exc)
            self.active = False

    def _log_payload_once(self, label: str, payload) -> None:
        count = self._payload_log_counts.get(label, 0)
        if count >= 2:
            return
        info = _summarize_payload(payload)
        try:
            detail = json.dumps(info, ensure_ascii=True)
        except Exception:
            detail = str(info)
        print(
            f"[ws] asr_stream_on_{label}_payload="
            f"{detail} turn_id={self.turn_id}"
        )
        self._payload_log_counts[label] = count + 1
        if not info.get("text_candidates"):
            no_text_count = self._payload_no_text_counts.get(label, 0)
            if no_text_count < 1:
                print(
                    "[ws] asr_stream_payload_no_text "
                    f"label={label} turn_id={self.turn_id}"
                )
            self._payload_no_text_counts[label] = no_text_count + 1

    def send_audio(self, audio_bytes: bytes) -> bool:
        if not self.active or not self._recognition:
            return False
        if not self._opened:
            if isinstance(audio_bytes, (bytes, bytearray, memoryview)):
                self._pending_chunks.append(bytes(audio_bytes))
                return True
        if self._send_method is None:
            self._resolve_send_method()
        send_fn = self._send_method
        if not callable(send_fn):
            self.last_error = "send_audio_missing"
            return False
        if isinstance(audio_bytes, str):
            try:
                audio_bytes = base64.b64decode(audio_bytes)
            except Exception:
                try:
                    audio_bytes = audio_bytes.encode("utf-8")
                except Exception as exc:
                    self.last_error = f"invalid_audio_string:{exc}"
                    return False
        if isinstance(audio_bytes, bytearray):
            audio_bytes = bytes(audio_bytes)
        if isinstance(audio_bytes, memoryview):
            audio_bytes = audio_bytes.tobytes()
        if not isinstance(audio_bytes, (bytes, bytearray)):
            self.last_error = f"invalid_audio_type:{type(audio_bytes)}"
            return False
        return self._send_audio_now(send_fn, audio_bytes)

    def _send_audio_now(self, send_fn, audio_bytes: bytes) -> bool:
        if len(audio_bytes) % 2 == 1:
            audio_bytes = audio_bytes[:-1]
        if not audio_bytes:
            self.last_error = "empty_audio_bytes"
            return False
        try:
            send_fn(audio_bytes)
            print(
                "[ws] asr_stream_send_ok "
                f"turn_id={self.turn_id} bytes={len(audio_bytes)}"
            )
        except Exception as exc:
            self.last_error = str(exc)
            return False
        return True

    def _flush_pending(self) -> None:
        if not self._pending_chunks:
            return
        if self._send_method is None:
            self._resolve_send_method()
        send_fn = self._send_method
        if not callable(send_fn):
            self.last_error = "send_audio_missing"
            return
        pending = list(self._pending_chunks)
        self._pending_chunks.clear()
        for chunk in pending:
            if not self._send_audio_now(send_fn, chunk):
                break

    def _log_session_methods(self) -> None:
        if self._methods_logged or not self._recognition:
            return
        names: List[str] = []
        try:
            for name in dir(self._recognition):
                if name.startswith("_"):
                    continue
                try:
                    attr = getattr(self._recognition, name)
                except Exception:
                    continue
                if not callable(attr):
                    continue
                lname = name.lower()
                if any(key in lname for key in ("send", "audio", "write", "feed", "push", "put")):
                    names.append(name)
        except Exception:
            names = []
        label = ",".join(names[:20]) if names else "none"
        print(f"[ws] asr_stream_session_methods={label} turn_id={self.turn_id}")
        if len(names) > 20:
            print(f"[ws] asr_stream_session_methods_more={len(names) - 20} turn_id={self.turn_id}")
        self._methods_logged = True

    def _resolve_send_method(self) -> None:
        if not self._recognition or self._send_method is not None:
            return
        self._log_session_methods()
        candidates: List[Tuple[str, object]] = []
        for name in dir(self._recognition):
            if name.startswith("_"):
                continue
            try:
                attr = getattr(self._recognition, name)
            except Exception:
                continue
            if not callable(attr):
                continue
            lname = name.lower()
            if any(key in lname for key in ("send", "audio", "write", "feed", "push", "put")):
                if self._accepts_single_arg(attr):
                    candidates.append((name, attr))
        if not candidates:
            self._send_method = None
            self._send_method_name = None
            return
        preferred = (
            "send_audio_frame",
            "send_audio",
            "send",
            "write",
            "put_audio",
            "put",
            "feed",
            "push",
            "write_audio",
        )
        chosen = None
        for key in preferred:
            for name, attr in candidates:
                if name == key:
                    chosen = (name, attr)
                    break
            if chosen:
                break
        if not chosen:
            chosen = candidates[0]
        self._send_method_name = chosen[0]
        self._send_method = chosen[1]
        print(
            "[ws] asr_stream_send_method="
            f"{self._send_method_name} turn_id={self.turn_id}"
        )

    def _accepts_single_arg(self, fn) -> bool:
        try:
            signature = inspect.signature(fn)
            params = [
                param for param in signature.parameters.values()
                if param.kind in (
                    inspect.Parameter.POSITIONAL_ONLY,
                    inspect.Parameter.POSITIONAL_OR_KEYWORD,
                )
            ]
            if not params:
                return False
            if len(params) == 1:
                return True
            return all(param.default is not inspect.Parameter.empty for param in params[1:])
        except Exception:
            return True

    def stop(self) -> None:
        if not self._recognition:
            return
        stop_fn = getattr(self._recognition, "stop", None)
        if callable(stop_fn):
            payload = stop_fn()
            if payload is not None:
                self.on_result(payload, True, "stop")
        close_fn = getattr(self._recognition, "close", None)
        if callable(close_fn):
            print(f"[ws] asr_stream_close_called turn_id={self.turn_id}")
            close_fn()


class StreamingAsrAdapter:
    """Session-based ASR adapter for WS audio uplink tests."""

    def __init__(self) -> None:
        self.sessions: Dict[str, StreamingAsrSession] = {}

    def start_session(self, turn_id: str) -> StreamingAsrSession:
        self.sessions.pop(turn_id, None)
        session = StreamingAsrSession(turn_id)
        self.sessions[turn_id] = session
        print(f"[ws] asr_session_start turn_id={turn_id}")
        return session

    def push_chunk(
        self,
        turn_id: str,
        chunk: bytes,
        seq: Optional[int],
        mime_type: Optional[str],
        sample_rate: Optional[int] = None,
    ) -> bool:
        session = self.sessions.get(turn_id)
        if not session:
            return False
        raw_type = type(chunk).__name__
        raw_len = len(chunk) if hasattr(chunk, "__len__") else -1
        print(
            "[ws] asr_stream_chunk_in "
            f"turn_id={turn_id} seq={seq} raw_type={raw_type} raw_len={raw_len}"
        )
        if isinstance(chunk, str):
            try:
                chunk = base64.b64decode(chunk.strip())
            except Exception:
                try:
                    chunk = chunk.encode("utf-8")
                except Exception:
                    print(f"[ws] asr_stream_chunk_decode_failed turn_id={turn_id} reason=string_decode")
                    return False
        if isinstance(chunk, memoryview):
            chunk = chunk.tobytes()
        if isinstance(chunk, bytearray):
            chunk = bytes(chunk)
        if not isinstance(chunk, (bytes, bytearray)):
            print(
                "[ws] asr_stream_chunk_decode_failed "
                f"turn_id={turn_id} reason=invalid_type type={type(chunk)}"
            )
            return False
        print(
            "[ws] asr_stream_chunk_decoded "
            f"turn_id={turn_id} pcm_len={len(chunk)}"
        )
        session.add_chunk(chunk, seq, mime_type, sample_rate)
        session.ensure_streaming()
        session.push_stream(chunk)
        return True

    def drain_partials(self, turn_id: str) -> List[Dict[str, str]]:
        session = self.sessions.get(turn_id)
        if not session:
            return []
        return session.drain_partials()

    async def finalize(self, turn_id: str) -> Dict:
        session = self.sessions.pop(turn_id, None)
        if not session:
            return {"status": "error", "error": {"code": "unknown_turn", "message": "Unknown turn"}}
        if session.count == 0:
            print(f"[ws] asr_session_end turn_id={turn_id} reason=empty_audio")
            return {"status": "empty", "text": ""}

        session.stop_stream()
        stream_final_text = (session.final_text or "").strip()
        usable_stream_final = stream_final_text if _is_usable_partial_text(stream_final_text) else ""
        usable_partial_text = (session.last_usable_partial_text or "").strip()
        last_partial_text = (session.last_partial_text or "").strip()
        if stream_final_text or usable_partial_text or last_partial_text:
            text = usable_stream_final or usable_partial_text or stream_final_text or last_partial_text
            if text:
                transcript_source = "stream_final"
                if text == usable_partial_text and usable_partial_text and text != usable_stream_final:
                    transcript_source = "stream_partial_fallback"
                    print(
                        f"[VoiceTranscript] fallback_to_partial_final={text[:120]} "
                        f"turn_id={turn_id}"
                    )
                elif text == last_partial_text and last_partial_text and text != usable_stream_final:
                    transcript_source = "stream_last_partial"
                print(f"[ws] asr_session_end turn_id={turn_id} status=stream_success")
                return {
                    "status": "success",
                    "text": text,
                    "emotion": "neutral",
                    "source": "asr_stream",
                    "transcript_source": transcript_source,
                    "final_already_sent": session.final_sent,
                }

        if session.stream_failed:
            print(f"[ws] asr_stream_fallback_triggered turn_id={turn_id}")
        elif session.stream_attempted:
            print(f"[ws] asr_stream_no_text_fallback turn_id={turn_id}")

        inferred_ext = _infer_extension(session.mime_type)
        content_type = session.mime_type or "audio/webm"
        sample_rate = session.sample_rate or settings.SENSEVOICE_SAMPLE_RATE
        transcode = "none"
        audio_bytes = bytes(session.buffer)

        if inferred_ext == "pcm":
            audio_bytes = _pcm_to_wav(audio_bytes, sample_rate)
            inferred_ext = "wav"
            content_type = "audio/wav"
            transcode = "pcm_to_wav"

        filename = f"{turn_id}.{inferred_ext}"
        print(
            "[ws] asr_finalize_start "
            f"turn_id={turn_id} bytes={session.total_bytes} chunks={session.count} "
            f"mime={content_type} ext={inferred_ext} "
            f"sample_rate={sample_rate} transcode={transcode}"
        )
        start = time.perf_counter()
        print(f"[ws] asr_finalize_calling service=SenseVoice turn_id={turn_id}")
        result = await sensevoice_service.transcribe(
            audio_bytes,
            filename=filename,
            content_type=content_type,
        )
        final_elapsed = int((time.perf_counter() - start) * 1000)
        first_partial_elapsed = int((time.perf_counter() - session.start_at) * 1000)

        text = (result.get("text") or "").strip()
        status = result.get("status") or "error"
        print(
            "[ws] asr_finalize_result "
            f"turn_id={turn_id} status={status} text_len={len(text)} "
            f"mock_reason={result.get('mock_reason')} error={result.get('error')}"
        )
        if text:
            print(f"[ws] first_partial_asr_ms={first_partial_elapsed} turn_id={turn_id}")
            print(f"[ws] final_asr_ms={final_elapsed} turn_id={turn_id}")
            print(f"[ws] asr_session_end turn_id={turn_id} status=success")
            return {
                "status": "success",
                "text": text,
                "emotion": result.get("emotion", "neutral"),
                "source": "asr_fallback",
                "transcript_source": "fallback_service",
                "final_already_sent": False,
            }

        print(f"[ws] final_asr_ms={final_elapsed} turn_id={turn_id}")
        print(f"[ws] asr_session_end turn_id={turn_id} status={status}")
        return {
            "status": status,
            "text": "",
            "error": result.get("error") or {"code": "asr_empty", "message": "ASR returned empty text"},
            "source": "asr_fallback",
            "transcript_source": "fallback_service_empty",
            "final_already_sent": False,
        }

    def close_session(self, turn_id: Optional[str], reason: str = "cancel") -> None:
        if not turn_id:
            return
        if self.sessions.pop(turn_id, None):
            print(f"[ws] asr_session_end turn_id={turn_id} reason={reason}")
