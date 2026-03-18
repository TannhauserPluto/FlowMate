"""
FlowMate-Echo Interaction API
Interaction-related routes
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, AsyncIterator, Callable, Dict, Any
from pathlib import Path
from datetime import datetime
import base64
import random
import time
import json
import asyncio

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover - fallback for older environments
    ZoneInfo = None

from core import agent_brain, flow_manager, focus_session_manager
from demo_task_breakdown import (
    DEMO_TASK_BREAKDOWN_DELAY_SECONDS,
    get_demo_task_breakdown,
)
from services import audio_service, voice_pipeline_service
from services.interaction_service import process_user_intent, stream_chat_reply, stream_focus_reply
from services.streaming_asr_adapter import StreamingAsrAdapter

router = APIRouter()

def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=True)}\n\n"


class TaskGenerationRequest(BaseModel):
    """Task generation request."""
    task_description: str


class TaskGenerationResponse(BaseModel):
    """Task generation response."""
    tasks: List[str]
    original_description: str
    topic: Optional[str] = None


class AIResponseRequest(BaseModel):
    """AI response request."""
    flow_state: str
    work_duration: int  # seconds
    fatigue_level: int  # 0-100


class AIResponseResult(BaseModel):
    """AI response result."""
    action: str  # speak, animate, task, break
    content: str
    audio_url: Optional[str] = None


class SpeechSynthesisRequest(BaseModel):
    """Speech synthesis request."""
    text: str
    voice: str = "longxiaochun"


class SpeakRequest(BaseModel):
    """Voice + motion driver request."""
    text: str
    emotion: str  # strict / encouraging / neutral / shush


class SpeakChunksRequest(BaseModel):
    """Chunked TTS test request."""
    text: str
    emotion: Optional[str] = "neutral"


class VoicePipelineResponse(BaseModel):
    """Voice pipeline response (ASR -> LLM -> TTS)."""
    status: str


class ChatRequest(BaseModel):
    """Chat request."""
    message: str
    context: Optional[str] = None


class ChatResponse(BaseModel):
    """Chat response."""
    reply: str
    audio_url: Optional[str] = None


class IntentRequest(BaseModel):
    """Text intent routing request."""
    text: str
    emotion: Optional[str] = None


@router.post("/generate-tasks", response_model=TaskGenerationResponse)
async def generate_tasks(request: TaskGenerationRequest):
    """Generate task breakdown."""
    try:
        if get_demo_task_breakdown(request.task_description):
            await asyncio.sleep(DEMO_TASK_BREAKDOWN_DELAY_SECONDS)
        tasks = await agent_brain.generate_task_breakdown(request.task_description)
        topic = await agent_brain.generate_task_topic(request.task_description, tasks)
        return TaskGenerationResponse(
            tasks=tasks,
            original_description=request.task_description,
            topic=topic or None,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/get-response", response_model=AIResponseResult)
async def get_ai_response(request: AIResponseRequest):
    """Get AI response (encouragement/reminder)."""
    try:
        content = await agent_brain.generate_encouragement(
            flow_state=request.flow_state,
            work_duration=request.work_duration,
            fatigue_level=request.fatigue_level,
        )

        if request.fatigue_level >= 70:
            action = "break"
        elif request.flow_state == "flow":
            action = "animate"  # animation only
        else:
            action = "speak"

        audio_url = None
        if action == "speak":
            audio_path = await audio_service.synthesize(content)
            if audio_path:
                audio_url = f"/api/interaction/audio/{Path(audio_path).name}"

        return AIResponseResult(
            action=action,
            content=content,
            audio_url=audio_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/synthesize-speech")
async def synthesize_speech(request: SpeechSynthesisRequest):
    """Speech synthesis (Deprecated: use /speak)."""
    try:
        audio_path = await audio_service.synthesize(request.text, request.voice)
        if audio_path:
            return {
                "audio_url": f"/api/interaction/audio/{Path(audio_path).name}",
                "text": request.text,
            }
        raise HTTPException(status_code=500, detail="Speech synthesis failed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/speak")
async def speak(request: SpeakRequest):
    """Voice synthesis + motion driver (primary endpoint)."""
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    result = await audio_service.speak(request.text.strip(), request.emotion)

    payload = {
        "status": result.get("status", "success"),
        "data": {
            "audio": {
                "base64": result.get("audio_data", ""),
                "format": result.get("format", "mp3"),
                "sample_rate": result.get("sample_rate", 24000),
                "estimated_duration_ms": result.get("estimated_duration_ms", 0),
            },
            "driver": {
                "motion_trigger": result.get("motion_trigger", "idle_breathing"),
                "expression_trigger": result.get("expression_trigger", "neutral"),
                "subtitle": result.get("subtitle", request.text.strip()),
            },
        },
    }
    error = result.get("error")
    if error:
        payload["error"] = error
    return payload


def _split_text_into_sentences(text: str, max_len: int = 80) -> List[str]:
    punctuation = set("。！？!?")
    cleaned = (text or "").strip()
    if not cleaned:
        return []
    sentences: List[str] = []
    current = ""
    for ch in cleaned:
        current += ch
        if ch in punctuation:
            if current.strip():
                sentences.append(current.strip())
            current = ""
    if current.strip():
        sentences.append(current.strip())

    chunks: List[str] = []
    for sentence in sentences:
        if len(sentence) <= max_len:
            chunks.append(sentence)
        else:
            start = 0
            while start < len(sentence):
                part = sentence[start:start + max_len].strip()
                if part:
                    chunks.append(part)
                start += max_len
    return chunks


@router.post("/speak-chunks")
async def speak_chunks(request: SpeakChunksRequest):
    """Chunked TTS test endpoint (text only)."""
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    emotion = (request.emotion or "neutral").strip()
    sentences = _split_text_into_sentences(request.text)
    if not sentences:
        raise HTTPException(status_code=400, detail="No valid sentence chunks")

    start = time.perf_counter()
    results = await audio_service.speak_chunks(sentences, emotion)
    chunks = []
    timings = {"chunk_tts_ms": [], "total_ms": 0}

    for index, (sentence, result) in enumerate(zip(sentences, results)):
        status = result.get("status")
        audio_b64 = result.get("audio_data") or ""
        if status == "error" or not audio_b64:
            error_payload = result.get("error") or {}
            raise HTTPException(
                status_code=500,
                detail={
                    "error": error_payload.get("message") or "TTS failed",
                    "error_stage": "tts",
                    "index": index,
                    "text": sentence,
                },
            )
        chunks.append({
            "index": index,
            "text": sentence,
            "audio_base64": audio_b64,
            "format": result.get("format", "mp3"),
            "sample_rate": result.get("sample_rate", 24000),
            "estimated_duration_ms": result.get("estimated_duration_ms", 0),
        })
        timings["chunk_tts_ms"].append({
            "index": index,
            "tts_ms": result.get("_tts_ms", 0),
        })

    timings["total_ms"] = int((time.perf_counter() - start) * 1000)
    return {"chunks": chunks, "timings": timings}


@router.websocket("/ws")
async def interaction_ws(websocket: WebSocket):
    """WebSocket test path (LLM streaming + WS audio uplink + ASR fallback + TTS chunks)."""
    await websocket.accept()
    connection_start = time.perf_counter()
    current_turn_token = 0
    sequence_task: Optional[asyncio.Task] = None
    active_turn_id: Optional[str] = None
    asr_adapter = StreamingAsrAdapter()
    audio_buffers = {}
    turn_modes = {}
    turn_tokens = {}
    turn_pages = {}
    turn_contexts = {}
    ended_turns = set()

    async def send(payload: dict) -> None:
        await websocket.send_text(json.dumps(payload, ensure_ascii=True))

    def parse_focus_rest_decision(text: str) -> Optional[bool]:
        normalized = "".join(str(text or "").split())
        if not normalized:
            return None
        if any(token in normalized for token in ("不用", "不想", "继续", "不休息", "先不")):
            return False
        if any(token in normalized for token in ("好", "休息", "可以", "行", "嗯", "要", "好的")):
            return True
        return None

    async def build_focus_voice_turn(
        transcript: str,
        emotion: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        normalized_text = (transcript or "").strip()
        if any(keyword in normalized_text for keyword in ("闪念", "闪电")):
            interaction = await process_user_intent(normalized_text, emotion)
            if (
                interaction
                and interaction.get("type") == "command"
                and (interaction.get("ui_payload") or {}).get("command") == "save_memo"
            ):
                return {
                    "mode": "interaction",
                    "interaction": interaction,
                    "user_text": normalized_text,
                }

        focus_context = context or {}
        session_id = str(focus_context.get("focus_session_id") or "").strip()
        remaining_seconds = int(focus_context.get("remaining_seconds") or 0)
        session = focus_session_manager.get(session_id) if session_id else None

        purpose = "continue"
        tts_emotion = "neutral"
        start_focus_monitors = False
        end_focus_after_reply = False

        if not session:
            session = focus_session_manager.create_session(normalized_text, remaining_seconds)
            focus_session_manager.record_message(session.id, "user", normalized_text)
            purpose = "encourage"
            tts_emotion = "encouraging"
            start_focus_monitors = True
        elif session.awaiting_rest_response:
            decision = parse_focus_rest_decision(normalized_text)
            accept_rest = False if decision is None else decision
            user_text = normalized_text or ("休息" if accept_rest else "继续")
            focus_session_manager.record_message(session.id, "user", user_text)
            session.awaiting_rest_response = False
            if accept_rest:
                purpose = "end_focus"
                end_focus_after_reply = True
            else:
                purpose = "continue"
        else:
            focus_session_manager.record_message(session.id, "user", normalized_text)
            purpose = "continue"

        async def on_complete_text(reply_text: str) -> None:
            cleaned = (reply_text or "").strip()
            if cleaned and session:
                focus_session_manager.record_message(session.id, "assistant", cleaned)

        return {
            "mode": "focus_stream",
            "purpose": purpose,
            "task_text": session.task_text if session else normalized_text,
            "user_text": normalized_text,
            "history": list(session.memory[-6:]) if session else [],
            "tts_emotion": tts_emotion,
            "focus_state": {
                "action": "end_focus" if end_focus_after_reply else ("start_session" if start_focus_monitors else purpose),
                "session_id": session.id if session else None,
                "task_text": session.task_text if session else normalized_text,
                "awaiting_rest_response": bool(session.awaiting_rest_response) if session else False,
                "start_focus_monitors": start_focus_monitors,
                "end_focus_after_reply": end_focus_after_reply,
            },
            "on_complete_text": on_complete_text,
        }

    async def stream_llm_sequence(
        turn_token: int,
        turn_id: str,
        prompt_text: str,
        source_label: str,
        enable_tts: bool = False,
        tts_emotion: str = "neutral",
        task_type: str = "stream_chat",
        chunk_stream: Optional[AsyncIterator[str]] = None,
        on_complete_text: Optional[Callable[[str], Any]] = None,
    ) -> None:
        # WS early-audio incremental TTS path (sentence-buffered, post-LLM streaming)
        first_partial_logged = False
        start = time.perf_counter()
        has_any_text = False
        sentence_buffer = ""
        punctuation = set("。！？!?")
        tts_queue: Optional[asyncio.Queue] = None
        tts_task: Optional[asyncio.Task] = None
        tts_failed = False
        tts_seq = 0
        first_tts_logged = False
        first_tts_sentence_logged = False
        first_audio_sent_logged = False
        full_text = ""
        print(
            "[ws] llm_stream_start_ms="
            f"{int((start - connection_start) * 1000)} turn_id={turn_id} source={source_label}"
        )
        try:
            if turn_token != current_turn_token:
                return

            if enable_tts:
                tts_queue = asyncio.Queue()

                async def tts_worker() -> None:
                    nonlocal tts_seq, tts_failed, first_tts_logged, first_audio_sent_logged
                    while True:
                        sentence = await tts_queue.get()
                        if sentence is None:
                            return
                        if turn_token != current_turn_token:
                            return
                        if not first_tts_logged:
                            first_tts_logged = True
                            print(
                                "[ws] first_tts_chunk_start_ms="
                                f"{int((time.perf_counter() - connection_start) * 1000)} turn_id={turn_id}"
                            )
                        snippet = (sentence or "").replace("\n", " ").strip()
                        if len(snippet) > 80:
                            snippet = f"{snippet[:80]}..."
                        print(
                            "[ws] tts_chunk_request "
                            f"turn_id={turn_id} seq={tts_seq} source=llm_stream "
                            f"prompt_source={source_label} text={snippet}"
                        )
                        try:
                            results = await audio_service.speak_chunks([sentence], tts_emotion)
                        except Exception as exc:
                            tts_failed = True
                            await send({
                                "type": "error",
                                "turn_id": turn_id,
                                "message": str(exc),
                                "error_stage": "tts",
                            })
                            await send({
                                "type": "done",
                                "turn_id": turn_id,
                                "reason": "tts_error",
                            })
                            return
                        result = results[0] if results else {}
                        audio_b64 = result.get("audio_data") or ""
                        print(
                            "[ws] tts_chunk_result "
                            f"turn_id={turn_id} seq={tts_seq} status={result.get('status')} "
                            f"audio_len={len(audio_b64)}"
                        )
                        if result.get("status") == "error" or not audio_b64:
                            error_payload = result.get("error") or {}
                            tts_failed = True
                            await send({
                                "type": "error",
                                "turn_id": turn_id,
                                "message": error_payload.get("message") or "TTS failed",
                                "error_stage": "tts",
                            })
                            await send({
                                "type": "done",
                                "turn_id": turn_id,
                                "reason": "tts_error",
                            })
                            return
                        await send({
                            "type": "audio_chunk",
                            "turn_id": turn_id,
                            "seq": tts_seq,
                            "audio": audio_b64,
                            "format": result.get("format", "mp3"),
                            "text": sentence,
                            "mock": False,
                            "source": "tts_chunked",
                        })
                        print(
                            "[ws] audio_chunk_sent "
                            f"turn_id={turn_id} seq={tts_seq} audio_len={len(audio_b64)} text={snippet}"
                        )
                        if not first_audio_sent_logged:
                            first_audio_sent_logged = True
                            print(
                                "[ws] first_audio_chunk_sent_ms="
                                f"{int((time.perf_counter() - connection_start) * 1000)} turn_id={turn_id}"
                            )
                        tts_seq += 1

                tts_task = asyncio.create_task(tts_worker())

            text_stream = chunk_stream or stream_chat_reply(prompt_text, task_type=task_type)
            async for chunk in text_stream:
                if turn_token != current_turn_token:
                    return
                if chunk:
                    has_any_text = True
                    full_text += chunk
                    if not first_partial_logged:
                        first_partial_logged = True
                        elapsed = int((time.perf_counter() - start) * 1000)
                        print(f"[ws] first_partial_text_ms={elapsed} turn_id={turn_id}")
                    await send({
                        "type": "partial_text",
                        "turn_id": turn_id,
                        "text": chunk,
                        "mock": False,
                        "source": "llm",
                    })
                    if enable_tts and tts_queue is not None:
                        sentence_buffer += chunk
                        trimmed = sentence_buffer.rstrip()
                        if trimmed:
                            ends_with_punct = trimmed[-1] in punctuation
                        else:
                            ends_with_punct = False
                        pieces = _split_text_into_sentences(sentence_buffer)
                        if pieces:
                            if ends_with_punct:
                                complete = pieces
                                sentence_buffer = ""
                            else:
                                complete = pieces[:-1]
                                sentence_buffer = pieces[-1] if pieces else ""
                            for sentence in complete:
                                if sentence:
                                    if not first_tts_sentence_logged:
                                        first_tts_sentence_logged = True
                                        print(
                                            "[ws] first_tts_sentence_queued_ms="
                                            f"{int((time.perf_counter() - connection_start) * 1000)} turn_id={turn_id}"
                                        )
                                    await tts_queue.put(sentence)
                    if tts_failed:
                        return

            if turn_token != current_turn_token:
                return
            if enable_tts:
                if not has_any_text and not sentence_buffer.strip():
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "empty_llm_text",
                        "error_stage": "llm",
                    })
                    await send({
                        "type": "done",
                        "turn_id": turn_id,
                        "reason": "llm_empty",
                    })
                    if tts_task is not None:
                        tts_task.cancel()
                    return
                if sentence_buffer.strip() and tts_queue is not None:
                    await tts_queue.put(sentence_buffer.strip())
                    sentence_buffer = ""
                if tts_queue is not None:
                    await tts_queue.put(None)
                if tts_task is not None:
                    await tts_task
                if tts_failed:
                    return

            completed_text = full_text.strip()
            if completed_text and on_complete_text is not None:
                maybe_result = on_complete_text(completed_text)
                if asyncio.iscoroutine(maybe_result):
                    await maybe_result

            await send({
                "type": "done",
                "turn_id": turn_id,
            })
            print(
                "[ws] ws_turn_done_ms="
                f"{int((time.perf_counter() - connection_start) * 1000)} turn_id={turn_id}"
            )
            print(f"[ws] ws_turn_cleanup turn_id={turn_id} reason=done")
            audio_buffers.pop(turn_id, None)
            turn_modes.pop(turn_id, None)
            turn_tokens.pop(turn_id, None)
            turn_pages.pop(turn_id, None)
            turn_contexts.pop(turn_id, None)
            asr_adapter.close_session(turn_id, reason="llm_done")
        except asyncio.CancelledError:
            if tts_task is not None:
                tts_task.cancel()
            return
        except Exception as exc:
            if turn_token == current_turn_token:
                await send({
                    "type": "error",
                    "turn_id": turn_id,
                    "message": str(exc),
                })
                await send({
                    "type": "done",
                    "turn_id": turn_id,
                    "reason": "error",
                })
                print(f"[ws] ws_turn_cleanup turn_id={turn_id} reason=error")
                audio_buffers.pop(turn_id, None)
                turn_modes.pop(turn_id, None)
                turn_tokens.pop(turn_id, None)
                turn_pages.pop(turn_id, None)
                turn_contexts.pop(turn_id, None)
                asr_adapter.close_session(turn_id, reason="llm_error")

    def log_unknown_turn(stage: str, turn_id: Optional[str], reason: str) -> None:
        known_turns = list(audio_buffers.keys())
        print(
            "[ws] unknown_turn_emit "
            f"turn_id={turn_id} stage={stage} knownTurnIds={known_turns} reason={reason}"
        )

    try:
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                break

            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await send({"type": "error", "message": "invalid_json"})
                continue

            message_type = payload.get("type")
            if message_type == "start_turn":
                current_turn_token += 1
                turn_token = current_turn_token
                if sequence_task:
                    sequence_task.cancel()
                if active_turn_id:
                    print(f"[ws] ws_turn_cleanup turn_id={active_turn_id} reason=replaced")
                    audio_buffers.pop(active_turn_id, None)
                    turn_modes.pop(active_turn_id, None)
                    turn_tokens.pop(active_turn_id, None)
                    turn_pages.pop(active_turn_id, None)
                    turn_contexts.pop(active_turn_id, None)
                active_turn_id = payload.get("turn_id") or f"turn-{turn_token}"
                await send({
                    "type": "ack",
                    "turn_id": active_turn_id,
                    "message": "start_turn",
                })
                audio_buffers[active_turn_id] = {
                    "total_bytes": 0,
                    "count": 0,
                    "start": time.perf_counter(),
                    "first_chunk_at": None,
                    "last_seq": -1,
                    "mime_type": None,
                    "sample_rate": None,
                    "ended": False,
                }
                asr_adapter.start_session(active_turn_id)
                turn_tokens[active_turn_id] = turn_token
                mode = (payload.get("mode") or "text").strip().lower()
                page = (payload.get("page") or "home").strip().lower()
                context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
                turn_modes[active_turn_id] = mode
                turn_pages[active_turn_id] = page
                turn_contexts[active_turn_id] = context
                print(f"[ws] turn_start turn_id={active_turn_id} mode={mode} page={page}")
                prompt_text = (payload.get("text") or "").strip()
                if mode != "audio":
                    if not prompt_text:
                        await send({
                            "type": "error",
                            "turn_id": active_turn_id,
                            "message": "empty_text",
                        })
                        await send({
                            "type": "done",
                            "turn_id": active_turn_id,
                            "reason": "error",
                        })
                        audio_buffers.pop(active_turn_id, None)
                        asr_adapter.close_session(active_turn_id, reason="empty_text")
                        turn_modes.pop(active_turn_id, None)
                        turn_tokens.pop(active_turn_id, None)
                        turn_pages.pop(active_turn_id, None)
                        turn_contexts.pop(active_turn_id, None)
                        continue
                    sequence_task = asyncio.create_task(
                        stream_llm_sequence(
                            turn_token,
                            active_turn_id,
                            prompt_text,
                            "text_path",
                            task_type="stream_chat_text",
                        )
                    )
                continue

            if message_type == "cancel_turn":
                current_turn_token += 1
                if sequence_task:
                    sequence_task.cancel()
                    sequence_task = None
                turn_id = payload.get("turn_id") or active_turn_id
                if turn_id:
                    audio_buffers.pop(turn_id, None)
                asr_adapter.close_session(turn_id, reason="cancel")
                turn_modes.pop(turn_id, None)
                turn_tokens.pop(turn_id, None)
                turn_pages.pop(turn_id, None)
                turn_contexts.pop(turn_id, None)
                if turn_id:
                    print(f"[ws] ws_turn_cleanup turn_id={turn_id} reason=cancelled")
                await send({
                    "type": "ack",
                    "turn_id": turn_id,
                    "message": "cancel_turn",
                })
                await send({
                    "type": "done",
                    "turn_id": turn_id,
                    "reason": "cancelled",
                })
                continue

            if message_type == "audio_chunk":
                turn_id = payload.get("turn_id") or active_turn_id
                if not turn_id or turn_id not in audio_buffers:
                    log_unknown_turn("audio_chunk", turn_id, "missing_audio_buffer")
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "unknown_turn",
                    })
                    continue
                buffer = audio_buffers[turn_id]
                if buffer.get("ended"):
                    print(f"[ws] audio_chunk_ignored_after_end turn_id={turn_id}")
                    await send({
                        "type": "ack",
                        "turn_id": turn_id,
                        "message": "audio_chunk",
                    })
                    continue
                audio_b64 = (payload.get("audio") or "").strip()
                if not audio_b64:
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "empty_audio_chunk",
                    })
                    continue
                try:
                    audio_bytes = base64.b64decode(audio_b64)
                except Exception:
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "invalid_audio_base64",
                    })
                    continue
                if not audio_bytes:
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "empty_audio_bytes",
                    })
                    continue
                seq = payload.get("seq")
                if isinstance(seq, int):
                    expected = buffer["last_seq"] + 1
                    if buffer["last_seq"] >= 0 and seq != expected:
                        print(
                            "[ws] audio_chunk_seq_gap "
                            f"expected={expected} got={seq} turn_id={turn_id}"
                        )
                    buffer["last_seq"] = seq
                if buffer["first_chunk_at"] is None:
                    buffer["first_chunk_at"] = time.perf_counter()
                    ws_audio_start_ms = int((buffer["first_chunk_at"] - connection_start) * 1000)
                    first_chunk_ms = int((buffer["first_chunk_at"] - buffer["start"]) * 1000)
                    print(f"[ws] ws_audio_start_ms={ws_audio_start_ms} turn_id={turn_id}")
                    print(f"[ws] first_audio_chunk_ms={first_chunk_ms} turn_id={turn_id}")
                if not buffer["mime_type"]:
                    buffer["mime_type"] = payload.get("mime_type")
                    buffer["sample_rate"] = payload.get("sample_rate")
                    print(
                        "[ws] ws_audio_mime "
                        f"turn_id={turn_id} mime={buffer['mime_type']} sample_rate={buffer.get('sample_rate')}"
                    )
                buffer["total_bytes"] += len(audio_bytes)
                buffer["count"] += 1
                if not asr_adapter.push_chunk(
                    turn_id,
                    audio_bytes,
                    seq,
                    buffer["mime_type"],
                    buffer.get("sample_rate"),
                ):
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "asr_session_missing",
                    })
                    continue
                for partial in asr_adapter.drain_partials(turn_id):
                    text = (partial.get("text") or "").strip()
                    if not text:
                        continue
                    await send({
                        "type": "partial_asr",
                        "turn_id": turn_id,
                        "text": text,
                        "mock": False,
                        "source": "asr_stream",
                        "phase": partial.get("phase") or "partial",
                    })
                await send({
                    "type": "ack",
                    "turn_id": turn_id,
                    "message": "audio_chunk",
                })
                continue

            if message_type == "end_audio":
                turn_id = payload.get("turn_id") or active_turn_id
                if turn_id and turn_id in ended_turns:
                    print(f"[ws] end_audio_ignored_duplicate turn_id={turn_id} reason=ended_turns")
                    await send({
                        "type": "ack",
                        "turn_id": turn_id,
                        "message": "end_audio",
                    })
                    continue
                if not turn_id or turn_id not in audio_buffers:
                    log_unknown_turn("end_audio", turn_id, "missing_audio_buffer")
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "unknown_turn",
                    })
                    continue
                turn_token = turn_tokens.get(turn_id)
                if turn_token is None:
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "stale_turn",
                    })
                    continue
                mode = turn_modes.get(turn_id) or "text"
                buffer = audio_buffers[turn_id]
                if buffer.get("ended"):
                    print(f"[ws] end_audio_ignored_duplicate turn_id={turn_id}")
                    await send({
                        "type": "ack",
                        "turn_id": turn_id,
                        "message": "end_audio",
                    })
                    continue
                buffer["ended"] = True
                ended_turns.add(turn_id)
                if len(ended_turns) > 32:
                    ended_turns.clear()
                end_ms = int((time.perf_counter() - buffer["start"]) * 1000)
                print(
                    "[ws] end_audio_ms="
                    f"{end_ms} total_audio_chunks={buffer['count']} "
                    f"total_audio_bytes={buffer['total_bytes']} turn_id={turn_id}"
                )
                await send({
                    "type": "ack",
                    "turn_id": turn_id,
                    "message": "end_audio",
                })
                if mode != "audio":
                    audio_buffers.pop(turn_id, None)
                    turn_modes.pop(turn_id, None)
                    turn_tokens.pop(turn_id, None)
                    turn_pages.pop(turn_id, None)
                    turn_contexts.pop(turn_id, None)
                    asr_adapter.close_session(turn_id, reason="not_audio")
                    continue
                # WS streaming ASR test path (fallback on end_audio)
                asr_result = await asr_adapter.finalize(turn_id)
                if asr_result.get("status") == "success" and asr_result.get("text"):
                    if not asr_result.get("final_already_sent"):
                        await send({
                            "type": "partial_asr",
                            "turn_id": turn_id,
                            "text": asr_result.get("text"),
                            "mock": False,
                            "source": asr_result.get("source", "asr_fallback"),
                            "phase": "final",
                        })
                    page = (turn_pages.get(turn_id) or "home").strip().lower()
                    transcript = (asr_result.get("text") or "").strip()
                    if page in ("home", "task"):
                        interaction = await process_user_intent(
                            transcript,
                            asr_result.get("emotion", "neutral"),
                        )
                        if interaction and interaction.get("type") in ("command", "breakdown"):
                            await send({
                                "type": "interaction",
                                "turn_id": turn_id,
                                "user_text": transcript,
                                "interaction": interaction,
                            })
                            await send({
                                "type": "done",
                                "turn_id": turn_id,
                                "reason": "interaction",
                            })
                            print(
                                f"[ws] ws_turn_cleanup turn_id={turn_id} "
                                f"reason=interaction type={interaction.get('type')} page={page}"
                            )
                            audio_buffers.pop(turn_id, None)
                            turn_modes.pop(turn_id, None)
                            turn_tokens.pop(turn_id, None)
                            turn_pages.pop(turn_id, None)
                            turn_contexts.pop(turn_id, None)
                            asr_adapter.close_session(turn_id, reason="interaction_done")
                            continue
                    if page == "focus":
                        focus_turn = await build_focus_voice_turn(
                            transcript,
                            asr_result.get("emotion", "neutral"),
                            turn_contexts.get(turn_id),
                        )
                        if focus_turn.get("mode") == "interaction":
                            await send({
                                "type": "interaction",
                                "turn_id": turn_id,
                                "user_text": focus_turn.get("user_text") or transcript,
                                "interaction": focus_turn.get("interaction"),
                            })
                            await send({
                                "type": "done",
                                "turn_id": turn_id,
                                "reason": "interaction",
                            })
                            print(
                                f"[ws] ws_turn_cleanup turn_id={turn_id} "
                                "reason=interaction type=command page=focus"
                            )
                            audio_buffers.pop(turn_id, None)
                            turn_modes.pop(turn_id, None)
                            turn_tokens.pop(turn_id, None)
                            turn_pages.pop(turn_id, None)
                            turn_contexts.pop(turn_id, None)
                            asr_adapter.close_session(turn_id, reason="interaction_done")
                            continue
                        await send({
                            "type": "focus_state",
                            "turn_id": turn_id,
                            "state": focus_turn.get("focus_state") or {},
                        })
                        if sequence_task:
                            sequence_task.cancel()
                        sequence_task = asyncio.create_task(
                            stream_llm_sequence(
                                turn_token,
                                turn_id,
                                transcript,
                                "focus_voice",
                                enable_tts=True,
                                tts_emotion=focus_turn.get("tts_emotion", "neutral"),
                                task_type="stream_focus_voice",
                                chunk_stream=stream_focus_reply(
                                    focus_turn.get("purpose", "continue"),
                                    task_text=focus_turn.get("task_text", ""),
                                    user_reply=focus_turn.get("user_text", transcript),
                                    history=focus_turn.get("history") or [],
                                    task_type="stream_focus_voice",
                                ),
                                on_complete_text=focus_turn.get("on_complete_text"),
                            )
                        )
                        continue
                    if sequence_task:
                        sequence_task.cancel()
                    sequence_task = asyncio.create_task(
                        stream_llm_sequence(
                            turn_token,
                            turn_id,
                            asr_result.get("text") or "",
                            asr_result.get("source", "asr_fallback"),
                            enable_tts=True,
                            tts_emotion=asr_result.get("emotion", "neutral"),
                            task_type="stream_chat_voice",
                        )
                    )
                elif asr_result.get("status") not in ("empty", None):
                    error = asr_result.get("error") or {}
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": error.get("message") or "ASR failed",
                    })
                    await send({
                        "type": "done",
                        "turn_id": turn_id,
                        "reason": "asr_error",
                    })
                    print(f"[ws] ws_turn_cleanup turn_id={turn_id} reason=error stage=asr_error")
                else:
                    await send({
                        "type": "error",
                        "turn_id": turn_id,
                        "message": "empty_asr_text",
                    })
                    await send({
                        "type": "done",
                        "turn_id": turn_id,
                        "reason": "asr_empty",
                    })
                    print(f"[ws] ws_turn_cleanup turn_id={turn_id} reason=error stage=asr_empty")
                if asr_result.get("status") != "success" or not asr_result.get("text"):
                    audio_buffers.pop(turn_id, None)
                    turn_modes.pop(turn_id, None)
                    turn_tokens.pop(turn_id, None)
                    turn_pages.pop(turn_id, None)
                    turn_contexts.pop(turn_id, None)
                continue

            await send({
                "type": "error",
                "turn_id": payload.get("turn_id"),
                "message": "unknown_type",
            })
    finally:
        if sequence_task:
            sequence_task.cancel()
        audio_buffers.clear()
        turn_modes.clear()
        turn_tokens.clear()
        turn_pages.clear()
        turn_contexts.clear()
        for turn_id in list(asr_adapter.sessions.keys()):
            print(f"[ws] ws_turn_cleanup turn_id={turn_id} reason=disconnect")
            asr_adapter.close_session(turn_id, reason="disconnect")


@router.post("/voice")
async def voice_chat(
    audio: UploadFile = File(...),
    context: Optional[str] = Form(None),
):
    """Voice pipeline: ASR -> LLM -> TTS."""
    try:
        request_start = time.perf_counter()
        timings = {"stages_ms": {"request_received": 0}}
        audio_bytes = await audio.read()
        timings["stages_ms"]["audio_read_done"] = int((time.perf_counter() - request_start) * 1000)
        result = await voice_pipeline_service.handle(
            audio_bytes=audio_bytes,
            filename=audio.filename,
            content_type=audio.content_type,
            timings=timings,
            request_start=request_start,
        )
        # Context is reserved for future use (e.g., memory injection)
        _ = context
        return result
    except Exception as e:
        error_timings = locals().get("timings") or {}
        start_ref = locals().get("request_start")
        if error_timings and "total_ms" not in error_timings and start_ref is not None:
            error_timings["total_ms"] = int((time.perf_counter() - start_ref) * 1000)
        if error_timings and "error_stage" not in error_timings:
            error_timings["error_stage"] = "unknown"
        raise HTTPException(
            status_code=500,
            detail={
                "error": str(e),
                "error_stage": error_timings.get("error_stage"),
                "timings": error_timings,
            },
        )


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Chat endpoint."""
    try:
        reply = await agent_brain.chat(request.message, request.context)

        audio_url = None
        audio_path = await audio_service.synthesize(reply)
        if audio_path:
            audio_url = f"/api/interaction/audio/{Path(audio_path).name}"

        return ChatResponse(
            reply=reply,
            audio_url=audio_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat-stream")
async def chat_stream(request: ChatRequest):
    """Text-only SSE stream for assistant partial text."""
    async def event_stream():
        start = time.perf_counter()
        first_chunk_at = None

        if not request.message or not request.message.strip():
            yield _sse_event({"type": "error", "message": "message cannot be empty"})
            yield _sse_event({"type": "done"})
            return

        try:
            async for chunk in stream_chat_reply(
                request.message,
                task_type="stream_chat_text",
            ):
                if not chunk:
                    continue
                if first_chunk_at is None:
                    first_chunk_at = int((time.perf_counter() - start) * 1000)
                    print(f"[chat-stream] first_chunk_ms={first_chunk_at}")
                yield _sse_event({"type": "partial_text", "text": chunk})
            yield _sse_event({"type": "done"})
        except Exception as e:
            yield _sse_event({"type": "error", "message": str(e)})
            yield _sse_event({"type": "done"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.post("/intent")
async def intent(request: IntentRequest):
    """Text intent routing (no ASR)."""
    try:
        return await process_user_intent(request.text, request.emotion)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/audio/{filename}")
async def get_audio(filename: str):
    """Get audio file."""
    from config import settings

    audio_path = settings.AUDIO_CACHE_DIR / filename
    if audio_path.exists():
        return FileResponse(
            audio_path,
            media_type="audio/mpeg",
            filename=filename,
        )
    raise HTTPException(status_code=404, detail="Audio file not found")


@router.get("/encouragement")
async def get_encouragement():
    """Get encouragement for current state."""
    try:
        info = flow_manager.get_session_info()
        state = info.get("state", "idle")
        work_minutes = info.get("work_duration", 0) // 60

        from core.prompt_templates import PromptTemplates
        prompts = PromptTemplates()
        encouragement = prompts.get_encouragement_by_state(state, work_minutes)
        if state == "idle":
            now = datetime.now(ZoneInfo("Asia/Shanghai")) if ZoneInfo else datetime.now()
            hour = now.hour
            if 5 <= hour < 12:
                options = [
                    "早上好呀，今天准备学习什么呢？",
                    "早安，加油学习哦。",
                ]
            elif 12 <= hour < 18:
                options = [
                    "下午好呀，今天准备学习什么呢？",
                    "下午好，准备开始了吗？",
                ]
            else:
                options = [
                    "晚上好呀，今天准备学习什么呢？",
                    "晚上好，准备一起进入专注模式吗？",
                ]
            encouragement = random.choice(options)

        return {
            "state": state,
            "encouragement": encouragement,
            "work_minutes": work_minutes,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
