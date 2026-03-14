"""
FlowMate-Echo streaming ASR adapter (WS test path).
Fallback implementation: buffer audio chunks and run non-streaming ASR on end.
"""

from __future__ import annotations

import time
from typing import Dict, Optional

from .sensevoice_asr import sensevoice_service


def _infer_extension(mime_type: Optional[str]) -> str:
    if not mime_type:
        return "webm"
    mime = mime_type.lower()
    if "wav" in mime:
        return "wav"
    if "mpeg" in mime or "mp3" in mime:
        return "mp3"
    if "webm" in mime:
        return "webm"
    if "ogg" in mime:
        return "ogg"
    return "webm"


class StreamingAsrSession:
    def __init__(self, turn_id: str):
        self.turn_id = turn_id
        self.start_at = time.perf_counter()
        self.first_chunk_at: Optional[float] = None
        self.total_bytes = 0
        self.count = 0
        self.last_seq = -1
        self.mime_type: Optional[str] = None
        self.buffer = bytearray()

    def add_chunk(self, chunk: bytes, seq: Optional[int], mime_type: Optional[str]) -> None:
        if self.first_chunk_at is None:
            self.first_chunk_at = time.perf_counter()
        if mime_type and not self.mime_type:
            self.mime_type = mime_type
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
    ) -> bool:
        session = self.sessions.get(turn_id)
        if not session:
            return False
        session.add_chunk(chunk, seq, mime_type)
        return True

    async def finalize(self, turn_id: str) -> Dict:
        session = self.sessions.pop(turn_id, None)
        if not session:
            return {"status": "error", "error": {"code": "unknown_turn", "message": "Unknown turn"}}
        if session.count == 0:
            print(f"[ws] asr_session_end turn_id={turn_id} reason=empty_audio")
            return {"status": "empty", "text": ""}

        inferred_ext = _infer_extension(session.mime_type)
        filename = f"{turn_id}.{inferred_ext}"
        content_type = session.mime_type or "audio/webm"
        print(
            "[ws] asr_finalize_start "
            f"turn_id={turn_id} bytes={session.total_bytes} chunks={session.count} "
            f"mime={content_type} ext={inferred_ext}"
        )
        start = time.perf_counter()
        print(f"[ws] asr_finalize_calling service=SenseVoice turn_id={turn_id}")
        result = await sensevoice_service.transcribe(
            bytes(session.buffer),
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
            }

        print(f"[ws] final_asr_ms={final_elapsed} turn_id={turn_id}")
        print(f"[ws] asr_session_end turn_id={turn_id} status={status}")
        return {
            "status": status,
            "text": "",
            "error": result.get("error") or {"code": "asr_empty", "message": "ASR returned empty text"},
            "source": "asr_fallback",
        }

    def close_session(self, turn_id: Optional[str], reason: str = "cancel") -> None:
        if not turn_id:
            return
        if self.sessions.pop(turn_id, None):
            print(f"[ws] asr_session_end turn_id={turn_id} reason={reason}")
