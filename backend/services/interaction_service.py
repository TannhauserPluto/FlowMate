"""
FlowMate-Echo interaction routing service.
Flash capture -> intent routing -> multi-modal response.
"""

from __future__ import annotations

import asyncio
import functools
from typing import Dict, List, Literal, Optional, Union, AsyncIterator

from pydantic import BaseModel

from .dashscope_service import dashscope_service

FLASH_KEYWORDS = ("闪念", "闪电")

ResponseType = Literal["command", "chat", "breakdown"]


class TaskBreakdown(BaseModel):
    """Structured task breakdown for UI rendering."""

    title: str
    steps: List[str]


class CommandPayload(BaseModel):
    """UI command payload for flash capture."""

    command: Literal["save_memo"]
    content: str
    display_text: str


class BreakdownPayload(BaseModel):
    """UI payload for task breakdown display."""

    content: TaskBreakdown
    display_text: str


class InteractionResponse(BaseModel):
    """Unified response schema for the frontend."""

    type: ResponseType
    audio_text: str
    ui_payload: Optional[Union[CommandPayload, BreakdownPayload]] = None


async def _run_sync(func, *args):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, functools.partial(func, *args))


def _extract_flash_content(text: str) -> Optional[str]:
    for keyword in FLASH_KEYWORDS:
        if keyword in text:
            content = text.replace(keyword, "", 1).strip()
            content = content.lstrip("，。,:：")
            if not content:
                content = text
            return content
    return None


async def process_user_intent(user_text: str, user_emotion: Optional[str] = None) -> Dict:
    """
    Process user ASR text with three-layer routing:
    1) Flash capture by keyword
    2) Intent routing (LLM)
    3) Multi-modal response construction
    """

    text = (user_text or "").strip()

    # Layer 1: flash capture (no backend storage)
    flash_content = _extract_flash_content(text)
    if flash_content is not None:
        summary = await _run_sync(dashscope_service.summarize_memo, flash_content)
        memo_text = (summary or flash_content).strip()
        payload = CommandPayload(
            command="save_memo",
            content=memo_text,
            display_text="已记录闪念",
        )
        response = InteractionResponse(
            type="command",
            audio_text="记下了",
            ui_payload=payload,
        )
        return response.model_dump()

    # Empty input fallback
    if not text:
        response = InteractionResponse(
            type="chat",
            audio_text="刚才没听清楚，可以再说一遍吗？",
            ui_payload=None,
        )
        return response.model_dump()

    # Layer 2: intent routing (LLM)
    intent = await _run_sync(dashscope_service.classify_intent, text)
    if intent not in ("chat", "breakdown"):
        intent = "chat"

    # Layer 3: multi-modal response building
    if intent == "breakdown":
        steps = await _run_sync(dashscope_service.decompose_task, text)
        summary = await _run_sync(dashscope_service.summarize_breakdown, text, steps)
        title = await _run_sync(dashscope_service.summarize_title, text, steps)
        if not title:
            title = text or "任务拆解"
        breakdown = TaskBreakdown(
            title=title,
            steps=steps,
        )
        payload = BreakdownPayload(
            content=breakdown,
            display_text="已为你生成任务拆解，查看侧边栏",
        )
        response = InteractionResponse(
            type="breakdown",
            audio_text=summary,
            ui_payload=payload,
        )
        return response.model_dump()

    emotion = (user_emotion or "neutral").strip().lower()
    reply = await _run_sync(dashscope_service.generate_reply_from_asr, text, emotion)
    if not reply:
        reply = "好的，我明白了，有需要随时告诉我。"

    response = InteractionResponse(
        type="chat",
        audio_text=reply,
        ui_payload=None,
    )
    return response.model_dump()


async def stream_chat_reply(
    user_text: str,
    history: Optional[List[Dict[str, str]]] = None,
    task_type: str = "stream_chat",
) -> AsyncIterator[str]:
    """Stream chat reply chunks for SSE test path."""
    text = (user_text or "").strip()
    if not text:
        return
    for chunk in dashscope_service.stream_chat(text, history, task_type=task_type):
        if chunk:
            yield chunk


def _build_focus_messages(
    purpose: str,
    task_text: str = "",
    user_reply: str = "",
    history: Optional[List[Dict[str, str]]] = None,
) -> List[Dict[str, str]]:
    system_prompt = (
        "你是一个专注引导助手，负责在番茄钟场景中用友好、简短的话语引导用户。"
        "回答控制在30字以内，语气自然，不要过度热情。"
    )
    user_content = (
        f"目的: {purpose}\n"
        f"任务: {task_text}\n"
        f"用户回复: {user_reply}\n"
        "请生成一句引导或回应。"
    )
    messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history[-6:])
    messages.append({"role": "user", "content": user_content})
    return messages


def _focus_fallback_text(purpose: str) -> str:
    fallback = {
        "ask_task": "这次专注准备完成什么任务呢？",
        "encourage": "好的，我们开始吧。",
        "distracted": "看起来有点分心，要回到刚才的任务吗？",
        "ask_rest": "要不要休息一下？",
        "continue": "我们继续吧。",
        "shorten": "需要缩短时间吗？",
        "end_focus": "专注结束啦，辛苦了。",
    }
    return fallback.get(purpose, "我在这儿，需要我帮忙吗？")


async def stream_focus_reply(
    purpose: str,
    task_text: str = "",
    user_reply: str = "",
    history: Optional[List[Dict[str, str]]] = None,
    task_type: str = "stream_focus_voice",
) -> AsyncIterator[str]:
    messages = _build_focus_messages(
        purpose,
        task_text=task_text,
        user_reply=user_reply,
        history=history,
    )
    emitted = False
    try:
        for chunk in dashscope_service.stream_messages(
            messages,
            max_tokens=60,
            temperature=0.7,
            task_type=task_type,
        ):
            if not chunk:
                continue
            emitted = True
            yield chunk
    except Exception:
        emitted = False
    if not emitted:
        yield _focus_fallback_text(purpose)
