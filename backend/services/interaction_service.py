"""
FlowMate-Echo interaction routing service.
Flash capture -> intent routing -> multi-modal response.
"""

from __future__ import annotations

import asyncio
import functools
import re
from typing import Dict, List, Literal, Optional, Union, AsyncIterator

from pydantic import BaseModel

from .dashscope_service import dashscope_service
from .fast_route_utils import compact_fast_route_text, normalize_fast_route_text, check_greeting_utterance

FLASH_KEYWORDS = ("闪念", "闪电", "提醒")
FOCUS_FILLER_CONFIRM_EXACT = {
    "好",
    "好的",
    "嗯",
    "嗯嗯",
    "行",
    "可以",
    "继续",
    "开始",
    "收到",
    "收到啦",
    "明白了",
    "知道了",
    "我知道了",
    "好嘞",
}
FOCUS_DISTRACTED_KEYWORDS = ("分心", "走神", "静不下心", "集中不了", "专注不了", "老想别的")
FOCUS_NEXT_STEP_KEYWORDS = (
    "不知道接下来",
    "不知道下一步",
    "下一步",
    "先做哪个",
    "先做什么",
    "不知道先做什么",
    "不知道该做什么",
    "从哪开始",
    "先从哪",
)
FOCUS_TOO_HARD_KEYWORDS = ("太难", "好难", "不会", "卡住", "做不动", "做不下去", "难住", "搞不定")
FOCUS_MEMO_KEYWORDS = ("闪念", "想法", "灵感", "记一下", "记个", "提醒我")
FOCUS_SIMPLE_TEMPLATE_PURPOSES = {"focus_distracted", "focus_next_step", "focus_too_hard", "focus_memo"}
FOCUS_LLM_QUERY_KEYWORDS = (
    "怎么",
    "怎样",
    "如何",
    "为什么",
    "哪里",
    "哪儿",
    "哪个",
    "什么",
    "有没有",
    "推荐",
    "建议",
    "适合",
    "应该",
    "能不能",
    "可不可以",
    "要不要",
    "需不需要",
    "值不值得",
    "先看",
    "怎么读",
    "怎么学",
    "怎么看",
)
FOCUS_LLM_RESOURCE_KEYWORDS = (
    "论文",
    "文献",
    "资源",
    "资料",
    "教程",
    "课程",
    "入门",
    "方向",
    "知识点",
    "综述",
    "书",
    "书单",
    "网站",
    "数据库",
    "公开课",
    "视频",
    "google scholar",
    "semantic scholar",
)
FOCUS_LLM_EXPLANATION_KEYWORDS = (
    "怎么看",
    "怎么做",
    "怎么读",
    "怎么学",
    "看哪里",
    "看哪",
    "看不懂",
    "看懂",
    "入手",
    "理解",
    "解释",
    "分析",
    "系统",
    "路径",
    "步骤",
    "方法",
    "先学",
    "先看",
    "顺序",
    "阅读",
    "框架",
    "思路",
    "要点",
)
FOCUS_LLM_STRONG_PATTERNS = (
    "怎么读论文",
    "读论文",
    "读文献",
    "推荐读论文",
    "学习资源",
    "入门资源",
    "入门资料",
    "推荐资源",
    "推荐资料",
    "系统入门",
    "系统学",
    "学习路径",
    "学习路线",
    "先看哪里",
    "先看什么",
    "先学什么",
    "怎么学",
    "怎么快速看懂",
    "这篇论文该怎么看",
    "哪里找论文",
    "哪里看论文",
    "怎么找论文",
    "怎么查论文",
    "我应该怎么读",
    "我应该先学什么",
    "我现在这一步应该怎么做",
)
FOCUS_COMPLEX_QUESTION_PREFIXES = (
    "你有什么",
    "你推荐",
    "你建议",
    "我应该",
    "我该怎么",
    "我现在应该",
    "我想知道",
    "有没有适合",
    "有没有什么",
    "帮我推荐",
    "告诉我",
)
FOCUS_TASK_RELATED_HINT_KEYWORDS = (
    "论文",
    "文献",
    "摘要",
    "结论",
    "方法",
    "实验",
    "资源",
    "资料",
    "入门",
    "学习",
    "知识点",
    "方向",
    "步骤",
    "第一步",
    "第二步",
    "任务",
    "代码",
    "复现",
    "写作",
)
FOCUS_LONG_NATURAL_SENTENCE_MIN_CHARS = 12

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


def _build_home_breakdown_fast_text(explore_mode: bool = False) -> str:
    if explore_mode:
        return "别急，我们先找个方向。"
    return "好，我来帮你拆一下。"


def _normalize_focus_route_text(text: str) -> str:
    return compact_fast_route_text(text)


def resolve_focus_route(user_text: str) -> Dict[str, str]:
    normalized = _normalize_focus_route_text(user_text)
    greeting_match = check_greeting_utterance(user_text)
    if not normalized:
        return {
            "category": "filler_confirm",
            "purpose": "continue",
            "template": "我们继续吧。",
            "template_key": "continue_default",
        }

    if normalized in FOCUS_FILLER_CONFIRM_EXACT:
        if normalized in {"继续", "开始"}:
            template = "我们继续吧。"
            template_key = "continue_default"
        elif normalized in {"收到", "收到啦", "明白了", "知道了", "我知道了"}:
            template = "好，先回到这一步。"
            template_key = "confirm_ack"
        elif normalized in {"行", "可以", "好嘞"}:
            template = "行，先把这一步做完。"
            template_key = "confirm_do_step"
        else:
            template = "好，先回到这一步。"
            template_key = "confirm_return"
        return {
            "category": "filler_confirm",
            "purpose": "continue",
            "template": template,
            "template_key": template_key,
        }

    if greeting_match.get("matched") == "true":
        greeting_kind = greeting_match.get("kind") or "default"
        if greeting_kind == "present":
            template = "我在，先把眼前这一步做完。"
            template_key = "greeting_present"
        elif greeting_kind == "short":
            template = "嗨，先回到当前任务。"
            template_key = "greeting_short"
        elif greeting_kind == "morning":
            template = "早安，先回到当前任务。"
            template_key = "greeting_morning"
        else:
            template = "你好呀，我们继续当前任务吧。"
            template_key = "greeting_default"
        return {
            "category": "greeting",
            "purpose": "focus_greeting",
            "template": template,
            "template_key": template_key,
        }

    if any(keyword in normalized for keyword in FOCUS_DISTRACTED_KEYWORDS):
        return {
            "category": "simple_focus_support",
            "purpose": "focus_distracted",
            "template": "没关系，我们先回到第一步。",
            "template_key": "distracted",
        }

    if any(keyword in normalized for keyword in FOCUS_NEXT_STEP_KEYWORDS):
        return {
            "category": "simple_focus_support",
            "purpose": "focus_next_step",
            "template": "先看第一条就好。",
            "template_key": "next_step",
        }

    if any(keyword in normalized for keyword in FOCUS_TOO_HARD_KEYWORDS):
        return {
            "category": "simple_focus_support",
            "purpose": "focus_too_hard",
            "template": "那我们先把它拆小一点。",
            "template_key": "too_hard",
        }

    if any(keyword in normalized for keyword in FOCUS_MEMO_KEYWORDS):
        return {
            "category": "simple_focus_support",
            "purpose": "focus_memo",
            "template": "你先记下来，我们再继续。",
            "template_key": "memo",
        }

    complex_question = should_use_llm_for_focus(
        user_text,
        {
            "category": "meaningful_focus",
            "purpose": "focus_meaningful",
        },
    )
    if complex_question.get("use_llm") == "true":
        return {
            "category": "complex_focus_question",
            "purpose": "focus_question",
            "template": "先抓住最关键的问题，我们一步步来。",
            "template_key": "focus_question",
            "llm_reason": complex_question.get("reason") or "complex_focus_question",
        }

    return {
        "category": "meaningful_focus",
        "purpose": "focus_meaningful",
        "template": "先抓住眼前这一步，我们慢慢来。",
        "template_key": "meaningful_generic",
    }


def should_use_llm_for_focus(user_text: str, focus_route: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    route = focus_route or {}
    category = str(route.get("category") or "")
    purpose = str(route.get("purpose") or "")
    normalized = normalize_fast_route_text(user_text)
    compact = compact_fast_route_text(user_text)

    if category in {"filler_confirm", "greeting", "simple_focus_support"}:
        return {"use_llm": "false", "reason": "non_meaningful_focus"}
    if category == "complex_focus_question":
        return {"use_llm": "true", "reason": str(route.get("llm_reason") or "complex_focus_question")}
    if purpose in FOCUS_SIMPLE_TEMPLATE_PURPOSES:
        return {"use_llm": "false", "reason": "simple_focus_template"}
    if not compact:
        return {"use_llm": "false", "reason": "empty"}

    if any(pattern in normalized for pattern in FOCUS_LLM_STRONG_PATTERNS):
        return {"use_llm": "true", "reason": "strong_question_pattern"}

    if "?" in str(user_text or "") or "？" in str(user_text or ""):
        return {"use_llm": "true", "reason": "question_mark"}

    has_query_keyword = any(keyword in normalized for keyword in FOCUS_LLM_QUERY_KEYWORDS)
    has_resource_keyword = any(keyword in normalized for keyword in FOCUS_LLM_RESOURCE_KEYWORDS)
    has_explanation_keyword = any(keyword in normalized for keyword in FOCUS_LLM_EXPLANATION_KEYWORDS)
    if normalized.startswith(FOCUS_COMPLEX_QUESTION_PREFIXES):
        return {"use_llm": "true", "reason": "complex_question_prefix"}

    if has_query_keyword and has_resource_keyword:
        return {"use_llm": "true", "reason": "question_and_resource"}

    if has_query_keyword and has_explanation_keyword:
        return {"use_llm": "true", "reason": "question_and_explanation"}

    if normalized.startswith(("你有什么", "你推荐", "你建议", "我应该", "我该怎么", "我想知道")):
        return {"use_llm": "true", "reason": "assistant_advice_request"}

    if any(keyword in normalized for keyword in ("能不能", "可不可以", "要不要", "应该先", "应该怎么")):
        return {"use_llm": "true", "reason": "advice_modal_question"}

    if (has_resource_keyword or has_explanation_keyword) and len(compact) >= 8:
        return {"use_llm": "true", "reason": "resource_or_method_request"}

    if has_query_keyword and len(compact) >= 8:
        return {"use_llm": "true", "reason": "question_keyword_long"}

    if (has_resource_keyword or has_explanation_keyword) and len(compact) >= FOCUS_LONG_NATURAL_SENTENCE_MIN_CHARS:
        return {"use_llm": "true", "reason": "long_natural_focus_question"}

    if compact.endswith(("吗", "呢", "么")) and len(compact) >= 8:
        return {"use_llm": "true", "reason": "question_like_ending"}

    if len(compact) >= FOCUS_LONG_NATURAL_SENTENCE_MIN_CHARS and re.search(r"(我|你|这篇|这个).*(怎么|如何|为什么|哪里|哪个|适合|应该|推荐)", normalized):
        return {"use_llm": "true", "reason": "natural_sentence_question"}

    return {"use_llm": "false", "reason": "simple_focus_state"}


def _infer_focus_question_strategy(user_text: str) -> Dict[str, str]:
    normalized = normalize_fast_route_text(user_text)
    compact = compact_fast_route_text(user_text)
    if not compact:
        return {"strategy": "general_focus_question", "hint": "先直接回答问题，再给一个下一步。"}

    if any(keyword in normalized for keyword in ("论文", "文献")) and any(
        keyword in normalized for keyword in ("哪里", "哪儿", "推荐", "资源", "资料", "数据库", "综述", "google scholar", "semantic scholar")
    ):
        return {
            "strategy": "paper_resource_recommendation",
            "hint": "优先给出2到3个具体找论文或文献的来源，再给筛选顺序。",
        }

    if any(pattern in normalized for pattern in ("怎么读论文", "读论文", "看论文", "这篇论文该怎么看", "先看哪里", "先看什么", "摘要", "结论", "实验")):
        return {
            "strategy": "paper_reading_method",
            "hint": "优先给论文阅读顺序，再给当前最适合先看的部分。",
        }

    if any(keyword in normalized for keyword in ("入门", "系统学", "系统入门", "学习路径", "学习路线", "方向", "先学什么", "怎么学", "路径")):
        return {
            "strategy": "learning_path_guidance",
            "hint": "优先给1到3步学习路径，并指出第一步先做什么。",
        }

    if any(keyword in normalized for keyword in ("应该怎么做", "我现在这一步应该怎么做", "怎么开始", "步骤", "方法", "先做什么", "先看")):
        return {
            "strategy": "task_step_guidance",
            "hint": "优先给下一步动作和顺序，不要只说继续专注。",
        }

    if any(keyword in normalized for keyword in ("为什么", "是什么", "解释", "理解", "区别", "原理", "看不懂")):
        return {
            "strategy": "concept_explanation",
            "hint": "先解释核心点，再给理解或验证的方法。",
        }

    if any(keyword in normalized for keyword in ("推荐", "建议", "资源", "资料", "课程", "教程", "书", "网站", "公开课")):
        return {
            "strategy": "resource_recommendation",
            "hint": "优先给2到3个具体资源或选择标准。",
        }

    return {"strategy": "general_focus_question", "hint": "先直接回答，再给一个最可执行的下一步。"}


def _assess_focus_question_task_relation(
    user_text: str,
    focus_goal: str = "",
    todo_snapshot: Optional[List[str]] = None,
) -> Dict[str, str]:
    question_text = compact_fast_route_text(user_text)
    goal_text = compact_fast_route_text(focus_goal)
    todo_items = [compact_fast_route_text(item) for item in (todo_snapshot or []) if compact_fast_route_text(item)][:3]
    context_items = [item for item in [goal_text, *todo_items] if item]
    if not question_text:
        return {"related": "false", "label": "unknown", "reason": "empty_question"}
    if not context_items:
        return {"related": "false", "label": "no_context", "reason": "no_context"}

    for context_text in context_items:
        if len(context_text) >= 2 and (context_text in question_text or question_text in context_text):
            return {"related": "true", "label": "direct_overlap", "reason": "direct_overlap"}

    shared_keywords = [
        keyword for keyword in FOCUS_TASK_RELATED_HINT_KEYWORDS
        if keyword in question_text and any(keyword in context_text for context_text in context_items)
    ]
    if shared_keywords:
        return {
            "related": "true",
            "label": "shared_keyword",
            "reason": f"shared_keyword:{','.join(shared_keywords[:3])}",
        }

    if any(keyword in question_text for keyword in ("这篇", "这一步", "这个任务", "当前任务")):
        return {"related": "true", "label": "explicit_current_task", "reason": "explicit_current_task"}

    return {"related": "false", "label": "weak_or_unrelated", "reason": "no_clear_overlap"}


def _focus_answer_has_task_reference(
    answer_text: str,
    focus_goal: str = "",
    todo_snapshot: Optional[List[str]] = None,
) -> bool:
    answer_compact = compact_fast_route_text(answer_text)
    if not answer_compact:
        return False
    goal_text = compact_fast_route_text(focus_goal)
    todo_items = [compact_fast_route_text(item) for item in (todo_snapshot or []) if compact_fast_route_text(item)][:3]
    context_items = [item for item in [goal_text, *todo_items] if item]
    for context_text in context_items:
        if len(context_text) >= 2 and context_text in answer_compact:
            return True
    return any(
        keyword in answer_compact and any(keyword in context_text for context_text in context_items)
        for keyword in FOCUS_TASK_RELATED_HINT_KEYWORDS
    )


def _detect_home_explore_breakdown(text: str, page: Optional[str] = None) -> bool:
    page_key = (page or "").strip().lower()
    if page_key != "home":
        return False

    normalized = re.sub(r"\s+", "", str(text or "")).strip().lower()
    if not normalized:
        return False

    direct_patterns = (
        "不知道该学什么",
        "不知道学什么",
        "不知道先学什么",
        "不知道先做什么",
        "不知道从哪开始",
        "还没想好学什么",
        "还没想好做什么",
        "没想好学什么",
        "没方向",
        "没有方向",
        "想学点东西",
        "学一点东西",
        "学点新东西",
        "不知道选什么",
        "不知道往哪走",
        "不知道做哪件事",
    )
    if any(pattern in normalized for pattern in direct_patterns):
        return True

    uncertain_tokens = (
        "不知道",
        "没想好",
        "还没想好",
        "迷茫",
        "没方向",
        "没有方向",
        "不知道从哪",
        "不知道先",
        "不知道该",
        "不知道选",
    )
    start_tokens = (
        "学",
        "学习",
        "开始",
        "提升",
        "新东西",
        "做点",
        "做什么",
        "起步",
    )
    return any(token in normalized for token in uncertain_tokens) and any(
        token in normalized for token in start_tokens
    )


def _build_breakdown_fast_title(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return "任务拆解"
    compact = cleaned.replace("，", "").replace("。", "").replace("？", "").replace("！", "")
    compact = compact.strip()
    if not compact:
        return "任务拆解"
    return compact[:9]


def _extract_flash_content(text: str) -> Optional[str]:
    for keyword in FLASH_KEYWORDS:
        if keyword in text:
            content = text.replace(keyword, "", 1).strip()
            content = content.lstrip("，。,:：")
            if not content:
                content = text
            return content
    return None


async def process_user_intent(
    user_text: str,
    user_emotion: Optional[str] = None,
    page: Optional[str] = None,
    fast_breakdown: bool = False,
) -> Dict:
    """
    Process user ASR text with three-layer routing:
    1) Flash capture by keyword
    2) Intent routing (LLM)
    3) Multi-modal response construction
    """

    text = (user_text or "").strip()
    page_key = (page or "").strip().lower()
    transcript_preview = text.replace("\n", " ")[:120]
    print(f"[IntentRoute] page={page_key or 'unknown'} transcript={transcript_preview}")

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

    detected_explore_breakdown = _detect_home_explore_breakdown(text, page_key)
    if detected_explore_breakdown:
        print("[IntentRoute] detected_explore_breakdown=true")

    # Layer 2: intent routing (LLM)
    intent = await _run_sync(dashscope_service.classify_intent, text)
    if intent not in ("chat", "breakdown"):
        intent = "chat"
    if page_key == "home" and intent == "chat" and detected_explore_breakdown:
        print("[IntentRoute] remap_chat_to_breakdown reason=uncertain_study_goal")
        intent = "breakdown"
    print(f"[IntentRoute] final_intent={intent}")

    # Layer 3: multi-modal response building
    if intent == "breakdown":
        if fast_breakdown and page_key == "home":
            breakdown = TaskBreakdown(
                title=_build_breakdown_fast_title(text),
                steps=[],
            )
            payload = BreakdownPayload(
                content=breakdown,
                display_text="已为你生成任务拆解，查看侧边栏",
            )
            response = InteractionResponse(
                type="breakdown",
                audio_text=_build_home_breakdown_fast_text(detected_explore_breakdown),
                ui_payload=payload,
            )
            return response.model_dump()

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
    reply = await _run_sync(dashscope_service.generate_reply_from_asr, text, emotion, page or "home")
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
    context: Optional[str] = None,
    task_type: str = "stream_chat",
) -> AsyncIterator[str]:
    """Stream chat reply chunks for SSE test path."""
    text = (user_text or "").strip()
    if not text:
        return
    for chunk in dashscope_service.stream_chat(text, history, context=context, task_type=task_type):
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


def _build_focus_llm_answer_messages(
    task_text: str = "",
    user_reply: str = "",
    history: Optional[List[Dict[str, str]]] = None,
    focus_goal: str = "",
    todo_snapshot: Optional[List[str]] = None,
    page: str = "focus",
) -> List[Dict[str, str]]:
    goal_text = (focus_goal or task_text or "").strip()
    todo_items = [str(item).strip() for item in (todo_snapshot or []) if str(item).strip()][:3]
    question_strategy = _infer_focus_question_strategy(user_reply)
    task_relation = _assess_focus_question_task_relation(user_reply, goal_text, todo_items)
    goal_log = goal_text.replace("\n", " ")[:120] if goal_text else "-"
    todo_log = " | ".join(todo_items)[:160] if todo_items else "-"
    print("[FocusLLM] using_complex_answer_prompt")
    print(f"[FocusLLM] prompt_context_goal={goal_log}")
    print(f"[FocusLLM] prompt_context_todos={todo_log}")
    print(
        f"[FocusLLM] question_strategy={question_strategy.get('strategy')} "
        f"task_relation={task_relation.get('label')}"
    )
    system_prompt = (
        "你是 FlowMate 的 Focus 页助手，风格像简洁的导师或学习搭子。"
        "用户正在专注过程中提出具体问题，你的第一任务是先把问题回答到位，不要先安抚、不要先劝继续专注。"
        "回答要求：先直接给结论或答案，再给1到3个具体建议、资源、步骤或阅读顺序，必要时再补一个最小下一步。"
        "如果问题和当前 focus goal 或 todo 相关，就自然结合当前任务回答；如果关系不强，也要先认真回答，不要硬扯回任务。"
        "请尽量用2到4句中文，必要时可到5句；信息要具体、可执行、有信息量，但不要变成长篇闲聊。"
        "不要空泛鼓励，不要模板化重复“继续专注”“慢慢来”“先抓住这一步”，除非已经回答完问题且确实需要轻轻拉回任务。"
        "首句尽量先给核心答案，便于语音快速播报。"
        "示例1：用户问“你有什么推荐读论文的地方吗？”时，应先给Google Scholar、Semantic Scholar、学校数据库、综述和高引用论文等具体建议，再给第一步。"
        "示例2：用户问“我应该怎么读这篇论文？”时，应先给标题/摘要/结论、图表/实验、方法细节的阅读顺序，再给当前最适合先看的部分。"
    )
    todo_lines = "\n".join(f"- {item}" for item in todo_items) if todo_items else "- 暂无 todo"
    user_content = (
        f"当前页面: {page or 'focus'}\n"
        f"当前专注目标: {goal_text or '未设置'}\n"
        f"当前待办(最多3条):\n{todo_lines}\n"
        f"问题类型: {question_strategy.get('strategy') or 'general_focus_question'}\n"
        f"回答提示: {question_strategy.get('hint') or '先直接回答，再给下一步。'}\n"
        f"与当前任务关系: {task_relation.get('label') or 'unknown'}\n"
        f"用户问题: {user_reply}\n"
        "请输出适合 Focus 页语音播放的回答：先答问题，再给具体建议，最后如有必要再用一句很短的话拉回当前任务。"
    )
    messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.append({"role": "user", "content": user_content})
    return messages


def _focus_fallback_text(purpose: str) -> str:
    fallback = {
        "ask_task": "这次专注准备完成什么任务呢？",
        "encourage": "好的，我们开始吧。",
        "distracted": "看起来有点分心，要回到刚才的任务吗？",
        "ask_rest": "要不要休息一下？",
        "continue": "我们继续吧。",
        "focus_greeting": "你好呀，我们继续当前任务吧。",
        "focus_distracted": "没关系，我们先回到第一步。",
        "focus_next_step": "先看第一条就好。",
        "focus_too_hard": "那我们先把它拆小一点。",
        "focus_memo": "你先记下来，我们再继续。",
        "focus_meaningful": "先抓住眼前这一步，我们慢慢来。",
        "focus_question": "先抓住最关键的问题，我们一步步来。",
        "shorten": "需要缩短时间吗？",
        "end_focus": "专注结束啦，辛苦了。",
    }
    return fallback.get(purpose, "我在这儿，需要我帮忙吗？")


async def stream_focus_reply(
    purpose: str,
    task_text: str = "",
    user_reply: str = "",
    history: Optional[List[Dict[str, str]]] = None,
    reply_override: str = "",
    focus_goal: str = "",
    todo_snapshot: Optional[List[str]] = None,
    page: str = "focus",
    task_type: str = "stream_focus_voice",
) -> AsyncIterator[str]:
    if task_type == "stream_focus_voice":
        fast_text = (reply_override or _focus_fallback_text(purpose)).strip()
        for chunk in _chunk_text_for_stream(fast_text, chunk_size=5):
            yield chunk
        return

    if task_type == "stream_focus_llm_answer":
        messages = _build_focus_llm_answer_messages(
            task_text=task_text,
            user_reply=user_reply,
            history=history,
            focus_goal=focus_goal,
            todo_snapshot=todo_snapshot,
            page=page,
        )
        emitted = False
        answer_parts: List[str] = []
        try:
            for chunk in dashscope_service.stream_messages(
                messages,
                max_tokens=180,
                temperature=0.3,
                task_type=task_type,
            ):
                if not chunk:
                    continue
                emitted = True
                answer_parts.append(chunk)
                yield chunk
        except Exception:
            emitted = False
        full_answer = "".join(answer_parts).strip()
        if full_answer:
            print(f"[FocusLLM] answer_length={len(compact_fast_route_text(full_answer))}")
            print(
                f"[FocusLLM] answer_has_task_reference="
                f"{'true' if _focus_answer_has_task_reference(full_answer, focus_goal=focus_goal or task_text, todo_snapshot=todo_snapshot) else 'false'}"
            )
        if not emitted:
            yield _focus_fallback_text(purpose)
        return

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


def _chunk_text_for_stream(text: str, chunk_size: int = 6) -> List[str]:
    cleaned = (text or "").strip()
    if not cleaned:
        return []
    return [cleaned[index:index + chunk_size] for index in range(0, len(cleaned), chunk_size)]


def _build_breakdown_messages(
    task_text: str,
    title: str,
    steps: List[str],
    summary: str,
) -> List[Dict[str, str]]:
    system_prompt = (
        "你是 FlowMate。用户刚通过语音让你拆解任务。"
        "请基于已经生成好的拆解结果，用中文给出一段自然、简短、口语化的说明。"
        "要求：保持和拆解结果一致，不要编造额外步骤；首句控制在8到16个汉字并单独成句；控制在50字以内；"
        "更像边想边整理出来的引导语。"
    )
    steps_text = "；".join([step for step in steps if step])
    user_content = (
        f"原始任务：{task_text}\n"
        f"标题：{title}\n"
        f"步骤：{steps_text}\n"
        f"当前总结：{summary}\n"
        "请输出一段适合流式展示给用户的说明。"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


async def stream_breakdown_reply(
    task_text: str,
    interaction: Dict,
    task_type: str = "stream_breakdown_voice",
) -> AsyncIterator[str]:
    ui_payload = interaction.get("ui_payload") or {}
    content = ui_payload.get("content") or {}
    title = str(content.get("title") or task_text or "任务拆解").strip()
    steps = [str(step).strip() for step in (content.get("steps") or []) if str(step).strip()]
    summary = str(interaction.get("audio_text") or ui_payload.get("display_text") or "").strip()
    messages = _build_breakdown_messages(task_text, title, steps, summary)
    emitted = False
    try:
        for chunk in dashscope_service.stream_messages(
            messages,
            max_tokens=80,
            temperature=0.6,
            task_type=task_type,
        ):
            if not chunk:
                continue
            emitted = True
            yield chunk
    except Exception:
        emitted = False

    if emitted:
        return

    fallback_text = summary or f"我先帮你拆成{max(1, len(steps))}个待办，按顺序推进就好。"
    for chunk in _chunk_text_for_stream(fallback_text):
        yield chunk
