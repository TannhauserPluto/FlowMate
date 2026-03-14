"""
FlowMate-Echo Focus API
Focus session + flow detection orchestration.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import random

from core import agent_brain, focus_session_manager
from services import screen_agent, fatigue_detector, audio_service

router = APIRouter()


class FocusPromptResponse(BaseModel):
    prompt: str
    audio: Optional[dict] = None


class FocusStartRequest(BaseModel):
    task_text: str
    duration_seconds: int


class FocusStartResponse(BaseModel):
    session_id: str
    reply: str
    audio: Optional[dict] = None


class ScreenCheckRequest(BaseModel):
    session_id: str
    image: str
    task_text: Optional[str] = None


class ScreenCheckResponse(BaseModel):
    is_focused: bool
    score: int
    analysis: str
    suggestion: str
    next_interval_seconds: int
    consecutive_distract: int
    reply: Optional[str] = None
    audio: Optional[dict] = None


class ScreenCheckOverrideRequest(BaseModel):
    mode: str  # related | unrelated | none


class FatigueCheckRequest(BaseModel):
    session_id: str
    remaining_seconds: int


class FatigueCheckResponse(BaseModel):
    fatigue_level: int
    action: str  # ok | ask_rest | shorten
    reply: Optional[str] = None
    audio: Optional[dict] = None
    new_remaining_seconds: Optional[int] = None
    consecutive_fatigue: int = 0


class FatigueResponseRequest(BaseModel):
    session_id: str
    accept_rest: bool
    user_text: Optional[str] = None


class FocusFinishRequest(BaseModel):
    session_id: str


_SCREEN_CHECK_OVERRIDE: Optional[str] = None


def _set_screen_check_override(mode: Optional[str]) -> None:
    global _SCREEN_CHECK_OVERRIDE
    _SCREEN_CHECK_OVERRIDE = mode
    if mode:
        print(f"[screen-check] override_set mode={mode}")


def _consume_screen_check_override() -> Optional[str]:
    global _SCREEN_CHECK_OVERRIDE
    mode = _SCREEN_CHECK_OVERRIDE
    if mode:
        print(f"[screen-check] override_consumed mode={mode}")
    _SCREEN_CHECK_OVERRIDE = None
    return mode


def _build_demo_override_result(mode: str, task_text: str) -> dict:
    safe_task = task_text.strip() if task_text else "当前专注任务"
    if mode == "related":
        analysis = random.choice([
            f"检测到与“{safe_task}”相关的编辑器/文档界面",
            f"屏幕内容与“{safe_task}”高度相关，正在处理专注任务",
            f"当前界面显示与“{safe_task}”相关的信息与工作流",
        ])
        suggestion = "继续保持专注"
        score = random.randint(75, 92)
        is_focused = True
    else:
        analysis = random.choice([
            "检测到社交媒体/聊天窗口，与当前任务无关",
            "检测到购物/视频娱乐页面，注意力偏离任务",
            "检测到与任务无关的新闻/娱乐内容",
        ])
        suggestion = "建议关闭分心页面，回到当前任务"
        score = random.randint(18, 45)
        is_focused = False
    return {
        "is_focused": is_focused,
        "score": score,
        "analysis": analysis,
        "suggestion": suggestion,
        "source": "demo_override",
        "mode": mode,
    }


@router.post("/prompt", response_model=FocusPromptResponse)
async def focus_prompt():
    """Ask user what they want to focus on (friend tone)."""
    print("[Focus] prompt requested")
    prompt = await agent_brain.generate_focus_message("ask_task")
    snippet = (prompt or "").replace("\n", " ").strip()
    if len(snippet) > 80:
        snippet = f"{snippet[:80]}..."
    print(f"[Focus] prompt text={snippet}")
    print(f"[Focus] tts requested text={snippet}")
    audio = await audio_service.speak(prompt, "neutral")
    audio_len = len(audio.get("audio_data", "") or "")
    print(f"[Focus] tts result status={audio.get('status')} audio_len={audio_len}")
    print("[Focus] prompt generated")
    response = FocusPromptResponse(
        prompt=prompt,
        audio={
            "base64": audio.get("audio_data", ""),
            "format": audio.get("format", "mp3"),
        },
    )
    payload = response.dict() if hasattr(response, "dict") else response.model_dump()
    print(f"[Focus] response payload keys={list(payload.keys())}")
    return response


@router.post("/start", response_model=FocusStartResponse)
async def focus_start(request: FocusStartRequest):
    """Start a focus session with task text."""
    if not request.task_text or not request.task_text.strip():
        raise HTTPException(status_code=400, detail="task_text cannot be empty")
    print(f"[Focus] start session task='{request.task_text.strip()}' duration={request.duration_seconds}s")
    session = focus_session_manager.create_session(
        request.task_text.strip(),
        request.duration_seconds,
    )
    focus_session_manager.record_message(session.id, "user", request.task_text.strip())
    reply = await agent_brain.generate_focus_message(
        "encourage",
        task_text=session.task_text,
        history=session.memory,
    )
    focus_session_manager.record_message(session.id, "assistant", reply)
    audio = await audio_service.speak(reply, "encouraging")
    print(f"[Focus] session started id={session.id}")
    return FocusStartResponse(
        session_id=session.id,
        reply=reply,
        audio={
            "base64": audio.get("audio_data", ""),
            "format": audio.get("format", "mp3"),
        },
    )


@router.post("/screen-check", response_model=ScreenCheckResponse)
async def screen_check(request: ScreenCheckRequest):
    """Screen relevance check. Adjust next interval based on result."""
    session = focus_session_manager.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    task_text = request.task_text.strip() if request.task_text else session.task_text
    if not task_text:
        raise HTTPException(status_code=400, detail="task_text cannot be empty")

    print(f"[Focus] screen-check session={request.session_id} task='{task_text}'")
    override_mode = _consume_screen_check_override()
    if override_mode:
        result = _build_demo_override_result(override_mode, task_text)
        print(
            "[screen-check] result source=demo_override "
            f"related={result.get('is_focused')} score={result.get('score')}"
        )
    else:
        result = await screen_agent.audit_screen(request.image, task_text, cooldown_seconds=0)
    is_focused = bool(result.get("is_focused", True))
    next_interval = focus_session_manager.set_screen_result(session.id, is_focused) or 8 * 60
    print(
        f"[Focus] screen-check result focused={is_focused} score={result.get('score')} "
        f"next={next_interval}s consecutive_distract={session.consecutive_distract}"
    )
    reply = None
    audio_payload = None
    if not is_focused and session.consecutive_distract >= 2:
        reply = await agent_brain.generate_focus_message(
            "distracted",
            task_text=task_text,
            history=session.memory,
        )
        focus_session_manager.record_message(session.id, "assistant", reply)
        audio = await audio_service.speak(reply, "neutral")
        audio_payload = {
            "base64": audio.get("audio_data", ""),
            "format": audio.get("format", "mp3"),
        }

    return ScreenCheckResponse(
        is_focused=is_focused,
        score=int(result.get("score", 50)),
        analysis=result.get("analysis", ""),
        suggestion=result.get("suggestion", ""),
        next_interval_seconds=next_interval,
        consecutive_distract=session.consecutive_distract,
        reply=reply,
        audio=audio_payload,
    )


@router.post("/screen-check-override")
async def screen_check_override(request: ScreenCheckOverrideRequest):
    mode = (request.mode or "").strip().lower()
    if mode in ("", "none"):
        _set_screen_check_override(None)
        return {"status": "ok", "pending_override": None}
    if mode not in ("related", "unrelated"):
        raise HTTPException(status_code=400, detail="mode must be related|unrelated|none")
    _set_screen_check_override(mode)
    return {"status": "ok", "pending_override": mode}


@router.post("/fatigue-check", response_model=FatigueCheckResponse)
async def fatigue_check(request: FatigueCheckRequest):
    """Check fatigue based on blink rate (6-min interval suggested on client)."""
    session = focus_session_manager.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    focus_session_manager.update_remaining(session.id, request.remaining_seconds)

    metrics = fatigue_detector.detect()
    fatigue_level = int(metrics.fatigue_level)
    fatigue_ok = fatigue_level < 80
    focus_session_manager.set_fatigue_result(session.id, fatigue_ok)
    print(
        f"[Focus] fatigue-check session={request.session_id} level={fatigue_level} "
        f"blink_rate={getattr(metrics, 'blink_rate', None)} ok={fatigue_ok} "
        f"consecutive={session.consecutive_fatigue}"
    )

    action = "ok"
    reply = None
    audio_payload = None
    new_remaining_seconds = None

    if not fatigue_ok:
        if session.consecutive_fatigue == 1:
            action = "ask_rest"
            reply = await agent_brain.generate_focus_message(
                "ask_rest",
                task_text=session.task_text,
                history=session.memory,
            )
            focus_session_manager.record_message(session.id, "assistant", reply)
            audio = await audio_service.speak(reply, "neutral")
            audio_payload = {
                "base64": audio.get("audio_data", ""),
                "format": audio.get("format", "mp3"),
            }
            session.awaiting_rest_response = True
        elif session.consecutive_fatigue >= 2:
            action = "shorten"
            remaining_minutes = max(0, session.remaining_seconds // 60)
            shortened_minutes = int(remaining_minutes * 0.35)
            new_remaining_seconds = max(0, shortened_minutes * 60)
            session.remaining_seconds = new_remaining_seconds
            reply = await agent_brain.generate_focus_message(
                "shorten",
                task_text=session.task_text,
                history=session.memory,
            )
            focus_session_manager.record_message(session.id, "assistant", reply)
            audio = await audio_service.speak(reply, "neutral")
            audio_payload = {
                "base64": audio.get("audio_data", ""),
                "format": audio.get("format", "mp3"),
            }

    return FatigueCheckResponse(
        fatigue_level=fatigue_level,
        action=action,
        reply=reply,
        audio=audio_payload,
        new_remaining_seconds=new_remaining_seconds,
        consecutive_fatigue=session.consecutive_fatigue,
    )


@router.post("/fatigue-response")
async def fatigue_response(request: FatigueResponseRequest):
    """Handle user response to rest suggestion."""
    session = focus_session_manager.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")

    print(f"[Focus] fatigue-response session={request.session_id} accept={request.accept_rest}")
    user_text = request.user_text or ("休息" if request.accept_rest else "继续")
    focus_session_manager.record_message(session.id, "user", user_text)

    if request.accept_rest:
        reply = await agent_brain.generate_focus_message(
            "end_focus",
            task_text=session.task_text,
            user_reply=user_text,
            history=session.memory,
        )
        focus_session_manager.record_message(session.id, "assistant", reply)
        audio = await audio_service.speak(reply, "neutral")
        return {
            "action": "end_focus",
            "reply": reply,
            "audio": {
                "base64": audio.get("audio_data", ""),
                "format": audio.get("format", "mp3"),
            },
        }

    reply = await agent_brain.generate_focus_message(
        "continue",
        task_text=session.task_text,
        user_reply=user_text,
        history=session.memory,
    )
    focus_session_manager.record_message(session.id, "assistant", reply)
    audio = await audio_service.speak(reply, "neutral")
    session.awaiting_rest_response = False
    return {
        "action": "continue",
        "reply": reply,
        "audio": {
            "base64": audio.get("audio_data", ""),
            "format": audio.get("format", "mp3"),
        },
    }


@router.post("/finish")
async def finish_focus(request: FocusFinishRequest):
    """Check whether to start positive timer after focus ends."""
    session = focus_session_manager.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    print(
        f"[Focus] finish session={request.session_id} "
        f"last_screen={session.last_screen_focused} last_fatigue={session.last_fatigue_ok}"
    )
    return {
        "start_positive_timer": focus_session_manager.should_start_positive_timer(session.id)
    }
