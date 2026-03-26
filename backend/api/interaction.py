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
import re

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
from services.interaction_service import (
    process_user_intent,
    resolve_focus_route,
    should_use_llm_for_focus,
    stream_breakdown_reply,
    stream_chat_reply,
    stream_focus_reply,
)
from services.streaming_asr_adapter import StreamingAsrAdapter

router = APIRouter()

VOICE_TRANSCRIPT_FILLER_RE = re.compile(
    r"^(?:啊|嗯|哦|噢|诶|欸|唉|哎|哈|喂|呃|额|呢|啦|呀|嘛|吧|好的|好啊|好呀|好呢|嗯嗯|啊啊|哦哦|诶诶|欸欸|哎呀)+$"
)
VOICE_TRANSCRIPT_PUNCTUATION_RE = re.compile(r"[\s，。！？、,.!?;；:：'\"“”‘’（）()【】\[\]<>《》]+")
VOICE_STREAM_SPLIT_PUNCTUATION = set("。！？!?")
VOICE_STREAM_FAST_SPLIT_PUNCTUATION = set("。！？!?；;：:")
VOICE_STREAM_FIRST_SENTENCE_MIN_CHARS = 8
VOICE_STREAM_FAST_SENTENCE_MIN_CHARS = 12
VOICE_STREAM_FIRST_SENTENCE_COMPLETE_SUFFIXES = set("了吗呢吧呀啊哦喔哈")


def _normalize_guard_text(text: Optional[str]) -> str:
    return " ".join(str(text or "").split()).strip()


def _compact_guard_text(text: Optional[str]) -> str:
    cleaned = _normalize_guard_text(text)
    return VOICE_TRANSCRIPT_PUNCTUATION_RE.sub("", cleaned)


def _sanitize_focus_context_text(text: Optional[str], max_len: int = 120) -> str:
    cleaned = _normalize_guard_text(text)
    if not cleaned:
        return ""
    return cleaned[:max_len]


def _sanitize_focus_todo_snapshot(value: Any, limit: int = 3) -> List[str]:
    if not isinstance(value, list):
        return []
    items: List[str] = []
    for raw in value:
        cleaned = _sanitize_focus_context_text(str(raw or ""), max_len=60)
        if not cleaned:
            continue
        items.append(cleaned)
        if len(items) >= limit:
            break
    return items


def _assess_voice_transcript(text: Optional[str]) -> Dict[str, Any]:
    cleaned = _normalize_guard_text(text)
    compact = _compact_guard_text(text)
    if not cleaned:
        return {"usable": False, "reason": "empty", "cleaned": cleaned, "normalized": compact}
    if not compact:
        return {"usable": False, "reason": "punctuation_only", "cleaned": cleaned, "normalized": compact}
    if len(compact) < 2:
        return {"usable": False, "reason": "too_short", "cleaned": cleaned, "normalized": compact}
    if VOICE_TRANSCRIPT_FILLER_RE.fullmatch(compact):
        return {"usable": False, "reason": "filler_only", "cleaned": cleaned, "normalized": compact}
    return {"usable": True, "reason": "ok", "cleaned": cleaned, "normalized": compact}


def _assess_task_description(text: Optional[str]) -> Dict[str, Any]:
    cleaned = _normalize_guard_text(text)
    compact = _compact_guard_text(text)
    if not cleaned:
        return {"usable": False, "reason": "empty", "cleaned": cleaned, "normalized": compact}
    if not compact:
        return {"usable": False, "reason": "punctuation_only", "cleaned": cleaned, "normalized": compact}
    if len(compact) < 2:
        return {"usable": False, "reason": "too_short", "cleaned": cleaned, "normalized": compact}
    return {"usable": True, "reason": "ok", "cleaned": cleaned, "normalized": compact}

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
    page: Optional[str] = None


class FocusTextRequest(BaseModel):
    """Focus text routing request."""
    text: str
    emotion: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


def parse_focus_rest_decision(text: str) -> Optional[bool]:
    normalized = "".join(str(text or "").split())
    if not normalized:
        return None
    if any(token in normalized for token in ("不用", "不想", "继续", "不休息", "先不")):
        return False
    if any(token in normalized for token in ("好", "休息", "可以", "行", "嗯", "要", "好的")):
        return True
    return None


async def build_focus_turn(
    transcript: str,
    emotion: str,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    normalized_text = (transcript or "").strip()
    compact_transcript = _normalize_guard_text(normalized_text)
    if len(compact_transcript) > 120:
        compact_transcript = f"{compact_transcript[:120]}..."
    print(f"[FocusRoute] page=focus transcript={compact_transcript}")
    if any(keyword in normalized_text for keyword in ("闪念", "闪电", "提醒")):
        interaction = await process_user_intent(normalized_text, emotion, page="focus")
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
    context_focus_goal = _sanitize_focus_context_text(
        focus_context.get("focus_goal") or focus_context.get("task_title")
    )
    context_todo_snapshot = _sanitize_focus_todo_snapshot(focus_context.get("todo_snapshot"))
    focus_route = resolve_focus_route(normalized_text)
    print(f"[FocusRoute] page=focus category={focus_route.get('category')}")
    llm_decision = should_use_llm_for_focus(normalized_text, focus_route)
    print(
        f"[FocusRoute] should_use_llm={llm_decision.get('use_llm')} "
        f"reason={llm_decision.get('reason')}"
    )
    log_focus_goal = context_focus_goal or (session.task_text if session else normalized_text)
    log_todo_snapshot = " | ".join(context_todo_snapshot) if context_todo_snapshot else "-"
    print(f"[FocusRoute] focus_goal={(log_focus_goal or '-')[:120]}")
    print(f"[FocusRoute] todo_snapshot={log_todo_snapshot[:160]}")

    purpose = "continue"
    tts_emotion = "neutral"
    start_focus_monitors = False
    end_focus_after_reply = False
    reply_text = ""
    route_task_text = (session.task_text if session else "") or context_focus_goal
    route_focus_goal = context_focus_goal or route_task_text
    route_todo_snapshot = context_todo_snapshot
    reply_task_type = "stream_focus_voice"
    llm_path = "fast_template"

    if not session:
        if focus_route.get("category") in ("filler_confirm", "greeting", "simple_focus_support"):
            purpose = focus_route.get("purpose") or "continue"
            reply_text = focus_route.get("template") or "我们继续吧。"
            print(f"[FocusRoute] using_fast_template={focus_route.get('template_key')}")
        elif llm_decision.get("use_llm") == "true":
            purpose = "focus_question"
            reply_task_type = "stream_focus_llm_answer"
            llm_path = "focus_llm"
            print("[FocusRoute] using_focus_llm_answer")
        else:
            session = focus_session_manager.create_session(normalized_text, remaining_seconds)
            focus_session_manager.record_message(session.id, "user", normalized_text)
            purpose = "encourage"
            tts_emotion = "encouraging"
            start_focus_monitors = True
            route_task_text = session.task_text if session else normalized_text
            route_focus_goal = session.task_text if session else (context_focus_goal or normalized_text)
            print("[FocusRoute] using_fast_template=encourage_start")
    elif session.awaiting_rest_response:
        if session.demo_force_rest_flow:
            accept_rest = True
        else:
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
            reply_text = "我们继续吧。"
            print("[FocusRoute] using_fast_template=continue_default")
    else:
        focus_session_manager.record_message(session.id, "user", normalized_text)
        route_task_text = session.task_text
        route_focus_goal = context_focus_goal or session.task_text
        if llm_decision.get("use_llm") == "true":
            purpose = "focus_question"
            reply_task_type = "stream_focus_llm_answer"
            llm_path = "focus_llm"
            print("[FocusRoute] using_focus_llm_answer")
        else:
            purpose = focus_route.get("purpose") or "continue"
            reply_text = focus_route.get("template") or "我们继续吧。"
        if focus_route.get("purpose") == "focus_meaningful" and llm_path != "focus_llm":
            print("[FocusRoute] using_meaningful_focus_reply")
        elif llm_path != "focus_llm":
            print(f"[FocusRoute] using_fast_template={focus_route.get('template_key')}")

    async def on_complete_text(reply_text_value: str) -> None:
        cleaned = (reply_text_value or "").strip()
        if cleaned and session:
            focus_session_manager.record_message(session.id, "assistant", cleaned)

    if session and purpose == "end_focus" and session.demo_force_rest_flow:
        async def on_complete_demo_text(reply_text_value: str) -> None:
            cleaned = (reply_text_value or "").strip()
            if cleaned and session:
                focus_session_manager.record_message(session.id, "assistant", cleaned)
                session.demo_force_rest_flow = False

        return {
            "mode": "focus_stream",
            "purpose": purpose,
            "task_text": route_task_text,
            "user_text": normalized_text,
            "history": list(session.memory[-6:]) if session else [],
            "tts_emotion": "neutral",
            "chunk_stream": iter(["休息是为了接下来更好的继续哦。"]),
            "focus_state": {
                "action": "end_focus",
                "session_id": session.id if session else None,
                "task_text": session.task_text if session else normalized_text,
                "awaiting_rest_response": False,
                "start_focus_monitors": False,
                "end_focus_after_reply": True,
            },
            "on_complete_text": on_complete_demo_text,
        }

    return {
        "mode": "focus_stream",
        "purpose": purpose,
        "task_text": route_task_text,
        "user_text": normalized_text,
        "reply_text": reply_text,
        "focus_route_category": focus_route.get("category"),
        "reply_task_type": reply_task_type,
        "llm_path": llm_path,
        "focus_goal": route_focus_goal,
        "todo_snapshot": route_todo_snapshot,
        "history": list(session.memory[-6:]) if session else [],
        "tts_emotion": tts_emotion,
        "focus_state": {
            "action": "end_focus" if end_focus_after_reply else ("start_session" if start_focus_monitors else purpose),
            "session_id": session.id if session else None,
            "task_text": route_task_text,
            "awaiting_rest_response": bool(session.awaiting_rest_response) if session else False,
            "start_focus_monitors": start_focus_monitors,
            "end_focus_after_reply": end_focus_after_reply,
        },
        "on_complete_text": on_complete_text,
    }


@router.post("/generate-tasks", response_model=TaskGenerationResponse)
async def generate_tasks(request: TaskGenerationRequest):
    """Generate task breakdown."""
    task_description = _normalize_guard_text(request.task_description)
    print(f"[GenerateTasks] input_task={task_description[:120]}")
    task_check = _assess_task_description(task_description)
    if not task_check["usable"]:
        print(
            f"[GenerateTasks] invalid_task_rejected reason={task_check['reason']} "
            f"input_task={task_description[:120]}"
        )
        print("[GenerateTasks] returning_controlled_error status=422")
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_task_description",
                "message": "task_description must be a meaningful non-empty string",
                "reason": task_check["reason"],
            },
        )
    try:
        if get_demo_task_breakdown(task_description):
            await asyncio.sleep(DEMO_TASK_BREAKDOWN_DELAY_SECONDS)
        tasks = await agent_brain.generate_task_breakdown(task_description)
        topic = await agent_brain.generate_task_topic(task_description, tasks)
        return TaskGenerationResponse(
            tasks=tasks,
            original_description=task_description,
            topic=topic or None,
        )
    except ValueError as e:
        print(f"[GenerateTasks] returning_controlled_error status=422 error={e}")
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_task_description",
                "message": "task_description must be a meaningful non-empty string",
                "reason": str(e),
            },
        )
    except Exception as e:
        print(f"[GenerateTasks] returning_controlled_error status=503 error={e}")
        raise HTTPException(
            status_code=503,
            detail={
                "code": "task_generation_unavailable",
                "message": "task breakdown unavailable, please retry",
            },
        )


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
    punctuation = VOICE_STREAM_SPLIT_PUNCTUATION
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


def _should_flush_fast_sentence(
    page: str,
    task_type: str,
    text: str,
    first_sentence_pending: bool = False,
) -> bool:
    if page not in ("task", "focus") and task_type not in (
        "stream_breakdown_voice",
        "stream_focus_voice",
        "stream_chat_voice_task",
        "stream_chat_voice_fast",
    ):
        return False
    trimmed = (text or "").rstrip()
    if not trimmed:
        return False
    if trimmed[-1] in VOICE_STREAM_FAST_SPLIT_PUNCTUATION:
        return True
    compact = _compact_guard_text(trimmed)
    if first_sentence_pending:
        if len(compact) >= VOICE_STREAM_FIRST_SENTENCE_MIN_CHARS and compact[-1] in VOICE_STREAM_FIRST_SENTENCE_COMPLETE_SUFFIXES:
            return True
        return len(compact) >= 10
    return len(compact) >= VOICE_STREAM_FAST_SENTENCE_MIN_CHARS


async def _iter_text_chunks(text: str, chunk_size: int = 5) -> AsyncIterator[str]:
    cleaned = (text or "").strip()
    if not cleaned:
        return
    for index in range(0, len(cleaned), chunk_size):
        yield cleaned[index:index + chunk_size]


def _compact_tts_log_text(text: Optional[str], limit: int = 160) -> str:
    cleaned = " ".join(str(text or "").replace("\r", " ").replace("\n", " ").split())
    if len(cleaned) > limit:
        return f"{cleaned[:limit]}..."
    return cleaned


def _log_ws_tts_chunk_error(
    turn_id: str,
    seq: int,
    sentence: str,
    error_payload: Optional[Dict[str, Any]] = None,
    *,
    result: Optional[Dict[str, Any]] = None,
    exc: Optional[Exception] = None,
) -> None:
    payload = dict(error_payload or {})
    result = result or {}
    if exc is not None:
        payload.setdefault("type", exc.__class__.__name__)
        payload.setdefault("code", "tts_worker_exception")
        payload.setdefault("message", str(exc) or "TTS worker exception")
        payload.setdefault("sdk_error", repr(exc))
    model = payload.get("model") or result.get("model") or getattr(audio_service, "model", None) or "-"
    voice = payload.get("voice") or result.get("voice") or getattr(audio_service, "DEFAULT_VOICE", None) or "-"
    rate = payload.get("rate") if payload.get("rate") is not None else result.get("rate")
    text = payload.get("text") or _compact_tts_log_text(sentence)
    text_length = payload.get("text_length") or len((sentence or "").strip())
    print(
        "[TTS] error "
        f"turn_id={turn_id} seq={seq} "
        f"type={payload.get('type') or '-'} "
        f"message={payload.get('message') or '-'} "
        f"http_status={payload.get('http_status')} "
        f"code={payload.get('code') or '-'} "
        f"model={model} "
        f"voice={voice} "
        f"rate={rate} "
        f"text={text or '-'} "
        f"len={text_length} "
        f"realtime_after_cache_miss={payload.get('realtime_after_cache_miss')} "
        f"response_body={payload.get('response_body') or '-'} "
        f"sdk_error={payload.get('sdk_error') or '-'}"
    )


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
                    "tts_error": error_payload,
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
        compact_transcript = _normalize_guard_text(normalized_text)
        if len(compact_transcript) > 120:
            compact_transcript = f"{compact_transcript[:120]}..."
        print(f"[FocusRoute] page=focus transcript={compact_transcript}")
        if any(keyword in normalized_text for keyword in ("闪念", "闪电", "提醒")):
            interaction = await process_user_intent(normalized_text, emotion, page="focus")
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
        context_focus_goal = _sanitize_focus_context_text(
            focus_context.get("focus_goal") or focus_context.get("task_title")
        )
        context_todo_snapshot = _sanitize_focus_todo_snapshot(focus_context.get("todo_snapshot"))
        focus_route = resolve_focus_route(normalized_text)
        print(f"[FocusRoute] page=focus category={focus_route.get('category')}")
        llm_decision = should_use_llm_for_focus(normalized_text, focus_route)
        print(
            f"[FocusRoute] should_use_llm={llm_decision.get('use_llm')} "
            f"reason={llm_decision.get('reason')}"
        )
        log_focus_goal = context_focus_goal or (session.task_text if session else normalized_text)
        log_todo_snapshot = " | ".join(context_todo_snapshot) if context_todo_snapshot else "-"
        print(f"[FocusRoute] focus_goal={(log_focus_goal or '-')[:120]}")
        print(f"[FocusRoute] todo_snapshot={log_todo_snapshot[:160]}")

        purpose = "continue"
        tts_emotion = "neutral"
        start_focus_monitors = False
        end_focus_after_reply = False
        reply_text = ""
        route_task_text = (session.task_text if session else "") or context_focus_goal
        route_focus_goal = context_focus_goal or route_task_text
        route_todo_snapshot = context_todo_snapshot
        reply_task_type = "stream_focus_voice"
        llm_path = "fast_template"

        if not session:
            if focus_route.get("category") in ("filler_confirm", "greeting"):
                purpose = focus_route.get("purpose") or "continue"
                reply_text = focus_route.get("template") or "我们继续吧。"
                print(f"[FocusRoute] using_fast_template={focus_route.get('template_key')}")
            elif focus_route.get("purpose") in ("focus_distracted", "focus_next_step", "focus_too_hard", "focus_memo"):
                purpose = focus_route.get("purpose") or "continue"
                reply_text = focus_route.get("template") or "先抓住眼前这一步，我们慢慢来。"
                print(f"[FocusRoute] using_fast_template={focus_route.get('template_key')}")
            elif llm_decision.get("use_llm") == "true":
                purpose = "focus_question"
                reply_task_type = "stream_focus_llm_answer"
                llm_path = "focus_llm"
                print("[FocusRoute] using_focus_llm_answer")
            else:
                session = focus_session_manager.create_session(normalized_text, remaining_seconds)
                focus_session_manager.record_message(session.id, "user", normalized_text)
                purpose = "encourage"
                tts_emotion = "encouraging"
                start_focus_monitors = True
                route_task_text = session.task_text if session else normalized_text
                route_focus_goal = session.task_text if session else (context_focus_goal or normalized_text)
                print("[FocusRoute] using_fast_template=encourage_start")
        elif session.awaiting_rest_response:
            if session.demo_force_rest_flow:
                accept_rest = True
            else:
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
                reply_text = "我们继续吧。"
                print("[FocusRoute] using_fast_template=continue_default")
        else:
            focus_session_manager.record_message(session.id, "user", normalized_text)
            route_task_text = session.task_text
            route_focus_goal = context_focus_goal or session.task_text
            if llm_decision.get("use_llm") == "true":
                purpose = "focus_question"
                reply_task_type = "stream_focus_llm_answer"
                llm_path = "focus_llm"
                print("[FocusRoute] using_focus_llm_answer")
            else:
                purpose = focus_route.get("purpose") or "continue"
                reply_text = focus_route.get("template") or "我们继续吧。"
            if focus_route.get("purpose") == "focus_meaningful" and llm_path != "focus_llm":
                print("[FocusRoute] using_meaningful_focus_reply")
            elif llm_path != "focus_llm":
                print(f"[FocusRoute] using_fast_template={focus_route.get('template_key')}")

        async def on_complete_text(reply_text: str) -> None:
            cleaned = (reply_text or "").strip()
            if cleaned and session:
                focus_session_manager.record_message(session.id, "assistant", cleaned)

        if session and purpose == "end_focus" and session.demo_force_rest_flow:
            async def on_complete_demo_text(reply_text: str) -> None:
                cleaned = (reply_text or "").strip()
                if cleaned and session:
                    focus_session_manager.record_message(session.id, "assistant", cleaned)
                    session.demo_force_rest_flow = False

            return {
                "mode": "focus_stream",
                "purpose": purpose,
                "task_text": route_task_text,
                "user_text": normalized_text,
                "history": list(session.memory[-6:]) if session else [],
                "tts_emotion": "neutral",
                "chunk_stream": iter(["休息是为了接下来更好的继续哦。"]),
                "focus_state": {
                    "action": "end_focus",
                    "session_id": session.id if session else None,
                    "task_text": session.task_text if session else normalized_text,
                    "awaiting_rest_response": False,
                    "start_focus_monitors": False,
                    "end_focus_after_reply": True,
                },
                "on_complete_text": on_complete_demo_text,
            }

        return {
            "mode": "focus_stream",
            "purpose": purpose,
            "task_text": route_task_text,
            "user_text": normalized_text,
            "reply_text": reply_text,
            "focus_route_category": focus_route.get("category"),
            "reply_task_type": reply_task_type,
            "llm_path": llm_path,
            "focus_goal": route_focus_goal,
            "todo_snapshot": route_todo_snapshot,
            "history": list(session.memory[-6:]) if session else [],
            "tts_emotion": tts_emotion,
            "focus_state": {
                "action": "end_focus" if end_focus_after_reply else ("start_session" if start_focus_monitors else purpose),
                "session_id": session.id if session else None,
                "task_text": route_task_text,
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
        after_stream: Optional[Callable[[str], Any]] = None,
        text_source: str = "llm",
        done_reason: Optional[str] = None,
    ) -> None:
        # WS early-audio incremental TTS path (sentence-buffered, post-LLM streaming)
        first_partial_logged = False
        start = time.perf_counter()
        has_any_text = False
        sentence_buffer = ""
        punctuation = VOICE_STREAM_SPLIT_PUNCTUATION
        tts_queue: Optional[asyncio.Queue] = None
        tts_task: Optional[asyncio.Task] = None
        tts_failed = False
        tts_seq = 0
        first_tts_logged = False
        first_tts_sentence_logged = False
        first_complete_sentence_logged = False
        first_audio_sent_logged = False
        full_text = ""
        page = (turn_pages.get(turn_id) or "home").strip().lower()
        turn_start = (audio_buffers.get(turn_id) or {}).get("start", connection_start)
        print(
            "[ws] llm_stream_start_ms="
            f"{int((start - connection_start) * 1000)} turn_id={turn_id} source={source_label}"
        )
        print(f"[VoicePerf] page={page} turn_id={turn_id} llm_stream_start_ms={int((start - turn_start) * 1000)} source={source_label} task_type={task_type}")
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
                            print(f"[VoicePerf] page={page} turn_id={turn_id} first_tts_worker_ms={int((time.perf_counter() - turn_start) * 1000)}")
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
                            _log_ws_tts_chunk_error(turn_id, tts_seq, sentence, exc=exc)
                            print(
                                "[ws] tts_chunk_result "
                                f"turn_id={turn_id} seq={tts_seq} status=error audio_len=0"
                            )
                            print(
                                f"[TTSFallback] text_only turn_id={turn_id} reason=worker_exception"
                            )
                            print(
                                "[ws] tts_chunk_skip "
                                f"turn_id={turn_id} seq={tts_seq} reason=worker_exception text_only=true"
                            )
                            continue
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
                            _log_ws_tts_chunk_error(
                                turn_id,
                                tts_seq,
                                sentence,
                                error_payload,
                                result=result,
                            )
                            print(
                                f"[TTSFallback] text_only turn_id={turn_id} reason={error_payload.get('code') or 'tts_error'}"
                            )
                            print(
                                "[ws] tts_chunk_skip "
                                f"turn_id={turn_id} seq={tts_seq} "
                                f"reason={error_payload.get('code') or 'tts_error'} text_only=true"
                            )
                            continue
                        await send({
                            "type": "audio_chunk",
                            "turn_id": turn_id,
                            "seq": tts_seq,
                            "audio": audio_b64,
                            "format": result.get("format", "mp3"),
                            "text": sentence,
                            "mock": result.get("status") == "mock",
                            "source": result.get("tts_source") or "tts_chunked",
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
                            print(f"[VoicePerf] page={page} turn_id={turn_id} first_audio_chunk_sent_ms={int((time.perf_counter() - turn_start) * 1000)}")
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
                        "source": text_source,
                    })
                    if enable_tts and tts_queue is not None:
                        sentence_buffer += chunk
                        trimmed = sentence_buffer.rstrip()
                        ends_with_punct = bool(trimmed) and trimmed[-1] in punctuation
                        pieces = _split_text_into_sentences(sentence_buffer, max_len=24 if page in ("task", "focus") else 80)
                        complete = []
                        if pieces:
                            if ends_with_punct:
                                complete = pieces
                                sentence_buffer = ""
                            else:
                                complete = pieces[:-1]
                                sentence_buffer = pieces[-1] if pieces else ""
                        elif _should_flush_fast_sentence(
                            page,
                            task_type,
                            sentence_buffer,
                            first_sentence_pending=not first_tts_sentence_logged,
                        ):
                            complete = [sentence_buffer.strip()]
                            sentence_buffer = ""
                        for sentence in complete:
                            if sentence:
                                if not first_complete_sentence_logged:
                                    first_complete_sentence_logged = True
                                    print(f"[TTSQueue] first_sentence_detected text={sentence[:80]}")
                                    print(f"[VoicePerf] page={page} turn_id={turn_id} first_complete_sentence_ms={int((time.perf_counter() - turn_start) * 1000)}")
                                if not first_tts_sentence_logged:
                                    first_tts_sentence_logged = True
                                    print(
                                        "[ws] first_tts_sentence_queued_ms="
                                        f"{int((time.perf_counter() - connection_start) * 1000)} turn_id={turn_id}"
                                    )
                                    print(f"[TTSQueue] first_sentence_queued len={len(sentence)}")
                                    print(f"[VoicePerf] page={page} turn_id={turn_id} first_tts_sentence_queued_ms={int((time.perf_counter() - turn_start) * 1000)}")
                                await tts_queue.put(sentence)
                    if tts_failed:
                        print(f"[ws] tts_partial_failure turn_id={turn_id} stage=streaming text_only_continues=true")

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
                    if not first_complete_sentence_logged:
                        first_complete_sentence_logged = True
                        print(f"[TTSQueue] first_sentence_detected text={sentence_buffer.strip()[:80]}")
                        print(f"[VoicePerf] page={page} turn_id={turn_id} first_complete_sentence_ms={int((time.perf_counter() - turn_start) * 1000)}")
                    if not first_tts_sentence_logged:
                        first_tts_sentence_logged = True
                        print(
                            "[ws] first_tts_sentence_queued_ms="
                            f"{int((time.perf_counter() - connection_start) * 1000)} turn_id={turn_id}"
                        )
                        print(f"[TTSQueue] first_sentence_queued len={len(sentence_buffer.strip())}")
                        print(f"[VoicePerf] page={page} turn_id={turn_id} first_tts_sentence_queued_ms={int((time.perf_counter() - turn_start) * 1000)}")
                    await tts_queue.put(sentence_buffer.strip())
                    sentence_buffer = ""
                if tts_queue is not None:
                    await tts_queue.put(None)
                if tts_task is not None:
                    await tts_task
                if tts_failed:
                    print(f"[ws] tts_partial_failure turn_id={turn_id} stage=done text_only_continues=true")

            completed_text = full_text.strip()
            if completed_text and on_complete_text is not None:
                maybe_result = on_complete_text(completed_text)
                if asyncio.iscoroutine(maybe_result):
                    await maybe_result
            if after_stream is not None:
                maybe_result = after_stream(completed_text)
                if asyncio.iscoroutine(maybe_result):
                    await maybe_result

            done_payload = {
                "type": "done",
                "turn_id": turn_id,
            }
            if done_reason:
                done_payload["reason"] = done_reason
            await send(done_payload)
            print(
                "[ws] ws_turn_done_ms="
                f"{int((time.perf_counter() - connection_start) * 1000)} turn_id={turn_id}"
            )
            print(f"[VoicePerf] page={page} turn_id={turn_id} total_turn_ms={int((time.perf_counter() - turn_start) * 1000)}")
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
                    transcript_source = asr_result.get("transcript_source") or asr_result.get("source", "unknown")
                    if transcript_source == "stream_partial_fallback":
                        print(f"[VoiceTranscript] fallback_to_partial_final={transcript[:120]} turn_id={turn_id}")
                    else:
                        print(
                            f"[VoiceTranscript] final_from_complete={transcript[:120]} "
                            f"turn_id={turn_id} source={transcript_source}"
                        )
                    print(f"[VoicePerf] page={page} turn_id={turn_id} asr_final_ms={int((time.perf_counter() - buffer['start']) * 1000)} transcript_source={transcript_source}")
                    transcript_check = _assess_voice_transcript(transcript)
                    if page in ("home", "task") and not transcript_check["usable"]:
                        print(
                            f"[VoiceTranscript] final_invalid_skip_breakdown reason={transcript_check['reason']} "
                            f"turn_id={turn_id} transcript={transcript[:120]} page={page}"
                        )
                        await send({
                            "type": "error",
                            "turn_id": turn_id,
                            "message": "invalid_voice_transcript",
                            "reason": transcript_check["reason"],
                            "hint": "我刚刚没听清，我们再说一次就好。",
                        })
                        await send({
                            "type": "done",
                            "turn_id": turn_id,
                            "reason": "invalid_voice_transcript",
                        })
                        print(
                            f"[ws] ws_turn_cleanup turn_id={turn_id} "
                            f"reason=invalid_voice_transcript page={page}"
                        )
                        audio_buffers.pop(turn_id, None)
                        turn_modes.pop(turn_id, None)
                        turn_tokens.pop(turn_id, None)
                        turn_pages.pop(turn_id, None)
                        turn_contexts.pop(turn_id, None)
                        asr_adapter.close_session(turn_id, reason="invalid_voice_transcript")
                        continue
                    if page in ("home", "task"):
                        intent_start = time.perf_counter()
                        interaction = await process_user_intent(
                            transcript,
                            asr_result.get("emotion", "neutral"),
                            page=page,
                            fast_breakdown=(page == "home"),
                        )
                        print(f"[VoicePerf] page={page} turn_id={turn_id} intent_done_ms={int((time.perf_counter() - intent_start) * 1000)} intent={(interaction or {}).get('type', 'none')}")
                        if interaction and interaction.get("type") == "command":
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
                        if interaction and interaction.get("type") == "chat":
                            reply_text = str(interaction.get("audio_text") or "").strip()
                            use_fast_chat_stream = page == "task" or (page == "home" and 0 < len(reply_text) <= 28)
                            if use_fast_chat_stream:
                                if sequence_task:
                                    sequence_task.cancel()
                                sequence_task = asyncio.create_task(
                                    stream_llm_sequence(
                                        turn_token,
                                        turn_id,
                                        transcript,
                                        "task_chat_voice_fast" if page == "task" else "home_chat_voice_fast",
                                        enable_tts=bool(reply_text),
                                        tts_emotion=asr_result.get("emotion", "neutral"),
                                        task_type="stream_chat_voice_task" if page == "task" else "stream_chat_voice_fast",
                                        chunk_stream=_iter_text_chunks(reply_text, chunk_size=5),
                                        text_source="task_fast_reply" if page == "task" else "home_fast_reply",
                                        done_reason="interaction_chat",
                                    )
                                )
                                continue
                        if interaction and interaction.get("type") == "breakdown":
                            print(
                                f"[VoicePerf] page={page} turn_id={turn_id} "
                                f"breakdown_fastpath_start_ms={int((time.perf_counter() - buffer['start']) * 1000)}"
                            )
                            await send({
                                "type": "interaction",
                                "turn_id": turn_id,
                                "user_text": transcript,
                                "interaction": interaction,
                                "defer_apply": True,
                                "stream_kind": "breakdown",
                            })
                            print(f"[VoiceBreakdownStream] intent=breakdown turn_id={turn_id} page={page}")
                            print(
                                f"[VoicePerf] page={page} turn_id={turn_id} "
                                f"stream_breakdown_start_ms={int((time.perf_counter() - buffer['start']) * 1000)}"
                            )
                            if sequence_task:
                                sequence_task.cancel()
                            sequence_task = asyncio.create_task(
                                stream_llm_sequence(
                                    turn_token,
                                    turn_id,
                                    transcript,
                                    "breakdown_voice",
                                    enable_tts=True,
                                    task_type="stream_breakdown_voice",
                                    chunk_stream=stream_breakdown_reply(
                                        transcript,
                                        interaction,
                                        task_type="stream_breakdown_voice",
                                    ),
                                    text_source="breakdown_stream",
                                    done_reason="breakdown_stream",
                                )
                            )
                            continue
                    if page == "focus":
                        focus_route_start = time.perf_counter()
                        focus_turn = await build_focus_turn(
                            transcript,
                            asr_result.get("emotion", "neutral"),
                            turn_contexts.get(turn_id),
                        )
                        print(f"[VoicePerf] page=focus turn_id={turn_id} intent_done_ms={int((time.perf_counter() - focus_route_start) * 1000)} intent={focus_turn.get('mode', 'focus_stream')}")
                        print(
                            f"[VoicePerf] page=focus turn_id={turn_id} "
                            f"llm_path={focus_turn.get('llm_path', 'fast_template')}"
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
                                task_type=focus_turn.get("reply_task_type", "stream_focus_voice"),
                                chunk_stream=focus_turn.get("chunk_stream") or stream_focus_reply(
                                    focus_turn.get("purpose", "continue"),
                                    task_text=focus_turn.get("task_text", ""),
                                    user_reply=focus_turn.get("user_text", transcript),
                                    history=focus_turn.get("history") or [],
                                    reply_override=focus_turn.get("reply_text", ""),
                                    focus_goal=focus_turn.get("focus_goal", ""),
                                    todo_snapshot=focus_turn.get("todo_snapshot") or [],
                                    page="focus",
                                    task_type=focus_turn.get("reply_task_type", "stream_focus_voice"),
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
                context=request.context,
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
        return await process_user_intent(request.text, request.emotion, page=request.page)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/focus-text")
async def focus_text(request: FocusTextRequest):
    """Focus text routing using the same fast/llm focus path as voice."""
    try:
        focus_turn = await build_focus_turn(
            request.text,
            request.emotion or "neutral",
            request.context or {},
        )
        if focus_turn.get("mode") == "interaction":
            return {
                "type": "interaction",
                "user_text": focus_turn.get("user_text") or request.text,
                "interaction": focus_turn.get("interaction"),
            }

        reply_parts: List[str] = []
        chunk_stream = focus_turn.get("chunk_stream")
        if chunk_stream is None:
            chunk_stream = stream_focus_reply(
                focus_turn.get("purpose", "continue"),
                task_text=focus_turn.get("task_text", ""),
                user_reply=focus_turn.get("user_text", request.text),
                history=focus_turn.get("history") or [],
                reply_override=focus_turn.get("reply_text", ""),
                focus_goal=focus_turn.get("focus_goal", ""),
                todo_snapshot=focus_turn.get("todo_snapshot") or [],
                page="focus",
                task_type=focus_turn.get("reply_task_type", "stream_focus_voice"),
            )

        if hasattr(chunk_stream, "__aiter__"):
            async for chunk in chunk_stream:
                if chunk:
                    reply_parts.append(chunk)
        else:
            for chunk in chunk_stream:
                if chunk:
                    reply_parts.append(chunk)

        reply = "".join(reply_parts).strip()
        on_complete_text = focus_turn.get("on_complete_text")
        if reply and callable(on_complete_text):
            callback_result = on_complete_text(reply)
            if asyncio.iscoroutine(callback_result):
                await callback_result

        audio_payload = None
        if reply:
            audio = await audio_service.speak(reply, focus_turn.get("tts_emotion", "neutral"))
            audio_payload = {
                "base64": audio.get("audio_data", ""),
                "format": audio.get("format", "mp3"),
            }

        return {
            "type": "focus_reply",
            "user_text": focus_turn.get("user_text") or request.text,
            "reply": reply,
            "audio": audio_payload,
            "focus_state": focus_turn.get("focus_state") or {},
            "route_category": focus_turn.get("focus_route_category"),
            "llm_path": focus_turn.get("llm_path", "fast_template"),
        }
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
                    "早安，开始今天的学习吧。",
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
