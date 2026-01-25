"""
FlowMate-Echo Interaction API
交互相关的 API 路由
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from pathlib import Path

from core import agent_brain, flow_manager
from services import audio_service

router = APIRouter()


class TaskGenerationRequest(BaseModel):
    """任务生成请求"""
    task_description: str


class TaskGenerationResponse(BaseModel):
    """任务生成响应"""
    tasks: List[str]
    original_description: str


class AIResponseRequest(BaseModel):
    """AI 响应请求"""
    flow_state: str
    work_duration: int  # 秒
    fatigue_level: int  # 0-100


class AIResponseResult(BaseModel):
    """AI 响应结果"""
    action: str  # speak, animate, task, break
    content: str
    audio_url: Optional[str] = None


class SpeechSynthesisRequest(BaseModel):
    """语音合成请求"""
    text: str
    voice: str = "longxiaochun"


class ChatRequest(BaseModel):
    """聊天请求"""
    message: str
    context: Optional[str] = None


class ChatResponse(BaseModel):
    """聊天响应"""
    reply: str
    audio_url: Optional[str] = None


@router.post("/generate-tasks", response_model=TaskGenerationResponse)
async def generate_tasks(request: TaskGenerationRequest):
    """生成任务拆解"""
    try:
        tasks = await agent_brain.generate_task_breakdown(request.task_description)
        return TaskGenerationResponse(
            tasks=tasks,
            original_description=request.task_description,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/get-response", response_model=AIResponseResult)
async def get_ai_response(request: AIResponseRequest):
    """获取 AI 响应 (鼓励/提醒)"""
    try:
        # 生成鼓励语
        content = await agent_brain.generate_encouragement(
            flow_state=request.flow_state,
            work_duration=request.work_duration,
            fatigue_level=request.fatigue_level,
        )

        # 决定响应类型
        if request.fatigue_level >= 70:
            action = "break"
        elif request.flow_state == "flow":
            action = "animate"  # 只做动作，不打扰
        else:
            action = "speak"

        # 生成语音 (非心流状态)
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
    """语音合成"""
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


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """聊天对话"""
    try:
        reply = await agent_brain.chat(request.message, request.context)

        # 生成语音
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


@router.get("/audio/{filename}")
async def get_audio(filename: str):
    """获取音频文件"""
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
    """获取当前状态的鼓励语"""
    try:
        info = flow_manager.get_session_info()
        state = info.get("state", "idle")
        work_minutes = info.get("work_duration", 0) // 60

        from core.prompt_templates import PromptTemplates
        prompts = PromptTemplates()
        encouragement = prompts.get_encouragement_by_state(state, work_minutes)

        return {
            "state": state,
            "encouragement": encouragement,
            "work_minutes": work_minutes,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
