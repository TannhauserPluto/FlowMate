"""
FlowMate-Echo Perception API
感知相关的 API 路由
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services import vision_service, fatigue_detector
from core import flow_manager

router = APIRouter()


class ScreenAnalysisRequest(BaseModel):
    """屏幕分析请求"""
    image: str  # Base64 编码的图片


class ScreenAnalysisResponse(BaseModel):
    """屏幕分析响应"""
    app: str
    is_working: bool
    distraction: bool
    focus_score: int
    raw_analysis: Optional[str] = None


class FatigueResponse(BaseModel):
    """疲劳检测响应"""
    fatigue_level: int
    blink_rate: float
    yawn_count: int
    recommendation: str


class ActivityRequest(BaseModel):
    """活动报告请求"""
    is_active: bool
    key_count: int


class FlowStateResponse(BaseModel):
    """心流状态响应"""
    state: str
    work_duration: int
    break_duration: int
    flow_count: int


@router.post("/analyze-screen", response_model=ScreenAnalysisResponse)
async def analyze_screen(request: ScreenAnalysisRequest):
    """分析屏幕截图"""
    try:
        result = await vision_service.analyze_screen(request.image)
        return ScreenAnalysisResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fatigue", response_model=FatigueResponse)
async def get_fatigue():
    """获取疲劳检测结果"""
    try:
        metrics = fatigue_detector.detect()

        # 根据疲劳等级生成建议
        if metrics.fatigue_level >= 70:
            recommendation = "疲劳度较高，建议立即休息"
        elif metrics.fatigue_level >= 50:
            recommendation = "有些疲劳，考虑休息一下"
        elif metrics.fatigue_level >= 30:
            recommendation = "状态良好，继续保持"
        else:
            recommendation = "精力充沛"

        return FatigueResponse(
            fatigue_level=metrics.fatigue_level,
            blink_rate=metrics.blink_rate,
            yawn_count=metrics.yawn_count,
            recommendation=recommendation,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/activity")
async def report_activity(request: ActivityRequest):
    """报告用户活动"""
    try:
        if request.is_active:
            state = flow_manager.on_activity()
        else:
            state = flow_manager.on_idle()

        return {
            "state": state.value,
            "message": "Activity reported successfully",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/flow-state", response_model=FlowStateResponse)
async def get_flow_state():
    """获取当前心流状态"""
    try:
        info = flow_manager.get_session_info()
        return FlowStateResponse(
            state=info.get("state", "idle"),
            work_duration=info.get("work_duration", 0),
            break_duration=info.get("break_duration", 0),
            flow_count=info.get("flow_count", 0),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/update-flow")
async def update_flow_state():
    """更新心流状态机 (每秒调用)"""
    try:
        result = flow_manager.update()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/force-break")
async def force_break():
    """强制开始休息"""
    try:
        flow_manager.force_break()
        return {"message": "Break started", "state": "break"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/skip-break")
async def skip_break():
    """跳过休息"""
    try:
        flow_manager.skip_break()
        return {"message": "Break skipped", "state": "idle"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
