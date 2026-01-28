"""
FlowMate-Echo Interaction API
Interaction-related routes
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from pathlib import Path

from core import agent_brain, flow_manager
from services import audio_service, voice_pipeline_service

router = APIRouter()


class TaskGenerationRequest(BaseModel):
    """Task generation request."""
    task_description: str


class TaskGenerationResponse(BaseModel):
    """Task generation response."""
    tasks: List[str]
    original_description: str


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


@router.post("/generate-tasks", response_model=TaskGenerationResponse)
async def generate_tasks(request: TaskGenerationRequest):
    """Generate task breakdown."""
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


@router.post("/voice")
async def voice_chat(
    audio: UploadFile = File(...),
    context: Optional[str] = Form(None),
):
    """Voice pipeline: ASR -> LLM -> TTS."""
    try:
        audio_bytes = await audio.read()
        result = await voice_pipeline_service.handle(
            audio_bytes=audio_bytes,
            filename=audio.filename,
            content_type=audio.content_type,
        )
        # Context is reserved for future use (e.g., memory injection)
        _ = context
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

        return {
            "state": state,
            "encouragement": encouragement,
            "work_minutes": work_minutes,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
