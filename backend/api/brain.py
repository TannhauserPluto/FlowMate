"""
FlowMate-Echo Brain API
Decomposition Agent、Chat Agent 和 Screen Focus Audit 路由
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict

from services.dashscope_service import dashscope_service
from services.screen_agent import screen_agent

router = APIRouter()


# ==================== 请求/响应模型 ====================

class DecomposeRequest(BaseModel):
    """任务拆解请求"""
    task: str


class ChatRequest(BaseModel):
    """闲聊请求"""
    message: str
    history: Optional[List[Dict[str, str]]] = None


class ChatResponse(BaseModel):
    """闲聊响应"""
    reply: str
    emotion: str


class ScreenAuditRequest(BaseModel):
    """屏幕审计请求"""
    image: str  # Base64 格式的屏幕截图
    current_task: str  # 用户当前任务描述，例如 "完成毕业论文"


class ScreenAuditResponse(BaseModel):
    """屏幕审计响应"""
    is_focused: bool  # 是否专注
    score: int  # 专注度分数 (0-100)
    analysis: str  # 分析说明
    suggestion: str  # 建议
    source: Optional[str] = None  # 结果来源: cache / visual_skip / llm / mock / error
    cooldown_remaining: Optional[int] = None  # 冷却剩余时间（秒）
    visual_diff: Optional[float] = None  # 视觉差异比例
    error: Optional[str] = None  # 错误信息（如有）


# ==================== API 路由 ====================

@router.post("/decompose", response_model=List[str])
async def decompose_task(request: DecomposeRequest):
    """
    Decomposition Agent - 任务拆解接口
    
    你是一个基于 Qwen-Max 的任务拆解智能体 (Decomposition Agent)。
    你的唯一目标是将用户的复杂任务拆解为 **3 个** 具体、可执行的微步骤 (Micro-steps)。

    **约束：**
    1. 必须且只能输出 3 个步骤。
    2. 输出格式必须是纯 JSON 数组：["步骤1", "步骤2", "步骤3"]。
    3. 不要使用 markdown 代码块，不要输出任何解释性文字。

    **示例：**
    User: "写一篇关于AI的论文"
    Assistant: ["查阅ModelScope相关文献", "列出论文核心论点大纲", "撰写引言和第一章"]
"""
    if not request.task or not request.task.strip():
        raise HTTPException(status_code=400, detail="任务描述不能为空")

    task = request.task.strip()
    
    if len(task) > 500:
        raise HTTPException(status_code=400, detail="任务描述过长，请控制在500字以内")

    try:
        steps = dashscope_service.decompose_task(task)
        return steps
    except Exception as e:
        print(f"Decompose error: {e}")
        # 返回默认步骤而不是抛出错误，保证用户体验
        return ["打开相关软件", "新建工作文件", "写下第一行内容"]


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Chat Agent - 伴侣闲聊接口
    
    FlowMate 人设：你是 FlowMate，一个基于 Qwen-Max 的心流伴侣。你的核心功能不是普通聊天，而是通过对话调节用户的认知负荷。
    
    - **输入**: {"message": "用户的对话", "history": []}
    - **输出**: {"reply": "生成的回复", "emotion": "neutral"}
    
    特殊功能:
    - 疲劳时分享冷知识缓解大脑疲劳
    - 求助时给予鼓励
    - 完成任务时给予夸奖

    **你的行为准则 (基于架构设计)：**
    1. **冷知识闲聊**：当用户只是闲聊时，回复中尽量包含一个有趣的、简短的“冷知识”，帮助用户大脑进行短暂的“认知切换”以缓解疲劳。
    2. **鼓励与轻柔**：当用户询问建议时，使用鼓励、轻柔的语调。
    3. **特定夸奖**：如果用户提到“任务完成了”或“刚写完”，请回复：“刚才你简直是打字机成精了！”
    4. **简洁**：回复控制在 3 句以内，不要打断用户太久。
    
    emotion 可能的值:
    - neutral: 正常
    - happy: 开心 (完成任务)
    - tired: 疲劳
    - need_help: 需要帮助
    - greeting: 打招呼
    """
    if not request.message or not request.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")

    message = request.message.strip()
    
    if len(message) > 1000:
        raise HTTPException(status_code=400, detail="消息过长，请控制在1000字以内")

    try:
        result = dashscope_service.chat(message, request.history)
        return ChatResponse(
            reply=result["reply"],
            emotion=result["emotion"],
        )
    except Exception as e:
        print(f"Chat error: {e}")
        return ChatResponse(
            reply="我在这里陪着你，有什么需要帮忙的吗",
            emotion="neutral",
        )


# ==================== Screen Focus Audit ====================

@router.post("/audit/screen", response_model=ScreenAuditResponse)
async def audit_screen(request: ScreenAuditRequest):
    """
    Screen Focus Audit - 屏幕专注度审计接口
    
    通过分析用户的实时屏幕截图，判断用户当前是否专注于设定的任务。
    
    **双重过滤机制 (Double Throttling Strategy):**
    1. 时间冷却：10分钟内不重复调用大模型 API
    2. 视觉防抖：屏幕无变化时跳过 API 调用
    
    **输入:**
    - image: Base64 格式的屏幕截图
    - current_task: 用户当前任务描述
    
    **输出:**
    - is_focused: 是否专注 (bool)
    - score: 专注度分数 (0-100)
    - analysis: 分析说明
    - suggestion: 建议
    - source: 结果来源 (cache/visual_skip/llm/mock/error)
    """
    if not request.image:
        raise HTTPException(status_code=400, detail="屏幕截图不能为空")
    
    if not request.current_task or not request.current_task.strip():
        raise HTTPException(status_code=400, detail="当前任务描述不能为空")
    
    current_task = request.current_task.strip()
    
    if len(current_task) > 200:
        raise HTTPException(status_code=400, detail="任务描述过长，请控制在200字以内")
    
    try:
        result = await screen_agent.audit_screen(request.image, current_task)
        return ScreenAuditResponse(**result)
    except Exception as e:
        print(f"Screen audit error: {e}")
        # 返回中性结果，避免前端报错
        return ScreenAuditResponse(
            is_focused=True,
            score=50,
            analysis="审计服务暂时不可用",
            suggestion="请继续工作",
            source="error",
            error=str(e),
        )


@router.get("/audit/status")
async def get_audit_status():
    """
    获取屏幕审计服务状态
    
    用于调试和监控，返回服务当前的内部状态。
    """
    return screen_agent.get_status()


@router.post("/audit/reset")
async def reset_audit_cache():
    """
    重置屏幕审计缓存
    
    用于测试，清除所有缓存状态，重新开始计时。
    """
    screen_agent.reset_cache()
    return {"message": "缓存已重置", "status": screen_agent.get_status()}
