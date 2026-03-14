"""
FlowMate-Echo DashScope Service
阿里云 DashScope Qwen-Max 服务模块
"""

import json
import re
from typing import List, Optional, Dict, Iterator
from dashscope import Generation
from dashscope.api_entities.dashscope_response import GenerationResponse
from config import settings


class DashScopeService:
    """DashScope Qwen-Max 服务"""

    _LIGHT_TASKS = {"classify_intent", "summarize_breakdown"}
    _TEXT_STREAM_TASKS = {"stream_chat_text"}

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.model = settings.QWEN_MAX_MODEL
        self.light_model = settings.QWEN_LIGHT_MODEL
        self.text_chat_model = settings.QWEN_TEXT_CHAT_MODEL

    def _log_route(self, task_type: str, model: str, routing_enabled: bool) -> None:
        if routing_enabled:
            print(f"[QwenRoute] task={task_type} model={model}")
        else:
            print(f"[QwenRoute] routing=off task={task_type} model={model}")

    def choose_model(self, task_type: Optional[str]) -> str:
        if not task_type:
            return self.model

        if not settings.QWEN_USE_ROUTING:
            model = self.model
            self._log_route(task_type, model, routing_enabled=False)
            return model

        if task_type in self._TEXT_STREAM_TASKS:
            if settings.QWEN_TEXT_CHAT_USE_FLASH:
                model = self.text_chat_model
            else:
                model = self.light_model
                print("[QwenRoute] text_flash=off fallback=light")
        elif task_type == "stream_chat_voice":
            model = self.model
        elif task_type in self._LIGHT_TASKS:
            model = self.light_model
        else:
            model = self.model
        self._log_route(task_type, model, routing_enabled=True)
        return model

    def _call_qwen(
        self,
        messages: List[dict],
        max_tokens: int = 1024,
        temperature: float = 0.7,
        task_type: Optional[str] = None,
    ) -> Optional[str]:
        """同步调用 Qwen-Max API"""
        if not self.api_key or self.api_key == "your_dashscope_api_key_here":
            return None

        try:
            model = self.choose_model(task_type)
            response: GenerationResponse = Generation.call(
                model=model,
                api_key=self.api_key,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                result_format="message",
            )

            if response.status_code == 200:
                return response.output.choices[0].message.content
            else:
                print(f"DashScope API error: {response.code} - {response.message}")
                return None
        except Exception as e:
            print(f"DashScope call error: {e}")
            return None

    def _parse_json_array(self, text: str) -> Optional[List[str]]:
        """解析 JSON 数组，处理各种格式"""
        if not text:
            return None

        text = text.strip()
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)

        try:
            result = json.loads(text)
            if isinstance(result, list):
                return [str(item) for item in result]
        except json.JSONDecodeError:
            pass

        try:
            match = re.search(r'\[[\s\S]*?\]', text)
            if match:
                result = json.loads(match.group())
                if isinstance(result, list):
                    return [str(item) for item in result]
        except json.JSONDecodeError:
            pass

        lines = []
        for line in text.strip().split('\n'):
            line = line.strip()
            cleaned = re.sub(r'^[\d]+[\.\)]\s*', '', line)
            cleaned = re.sub(r'^[-\*]\s*', '', cleaned)
            if cleaned:
                lines.append(cleaned)
        if len(lines) >= 2:
            return lines[:3]

        return None

    def decompose_task(self, task: str) -> List[str]:
        """
        Decomposition Agent - 任务拆解
        将大任务拆解为 3 个可执行的微步骤
        """
        system_prompt = """你是一个任务拆解专家。你的唯一工作是把用户的大任务拆解成 3 个具体可执行的微步骤。

【强制输出格式】
只输出一个 JSON 数组，格式如下：
["步骤1的具体动作", "步骤2的具体动作", "步骤3的具体动作"]

【规则】
1. 固定输出 3 个步骤，不多不少
2. 每个步骤必须是具体物理动作，如“打开Word”“新建文件”“输入标题”
3. 禁止使用抽象词汇，如“思考”“分析”“理解”“规划”
4. 每个步骤控制在 5 字以内
5. 不要输出任何解释、markdown 或其他内容

【示例】
输入：写一份调研报告
输出：["新建Word文档", "写下报告标题", "列出三个章节"]

输入：学习Python编程
输出：["打开VS Code", "新建test.py", "输入print"]"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task},
        ]

        response = self._call_qwen(messages, max_tokens=200, temperature=0.5)

        if response:
            parsed = self._parse_json_array(response)
            if parsed and len(parsed) >= 3:
                return parsed[:3]

        return self._get_fallback_tasks(task)

    def _get_fallback_tasks(self, task: str) -> List[str]:
        """回退方案：预设任务响应"""
        task_lower = task.lower()
        presets = {
            "报告": ["新建Word文档", "写下报告标题", "列出三个章节"],
            "论文": ["打开Word", "输入论文标题", "写第一句摘要"],
            "代码": ["打开编辑器", "新建代码文件", "写第一个函数"],
            "python": ["打开VS Code", "新建test.py", "输入print"],
            "学习": ["打开学习资料", "阅读第一页", "写下关键词"],
            "复习": ["打开笔记本", "翻到第一页", "写一个关键词"],
            "ppt": ["打开PowerPoint", "新建空白页", "输入封面标题"],
            "邮件": ["打开邮箱", "点击新建邮件", "填写收件人"],
            "文章": ["打开文档", "写下文章标题", "输入第一句"],
        }

        for key, steps in presets.items():
            if key in task_lower:
                return steps

        return ["打开相关软件", "新建工作文件", "写下第一行内容"]

    def classify_intent(self, user_text: str) -> str:
        """Classify user intent as chat or breakdown using LLM with fallback rules."""
        text = (user_text or "").strip()
        if not text:
            return "chat"

        system_prompt = (
            "你是一个意图路由器，只能输出 JSON："
            "{\"intent\":\"chat\"} 或 {\"intent\":\"breakdown\"}。"
            "当用户表达卡住、不会、不知道怎么开始、启动困难、想拆解任务时输出 breakdown；"
            "普通闲聊输出 chat。不要输出任何其他内容。"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ]

        response = self._call_qwen(
            messages,
            max_tokens=30,
            temperature=0.1,
            task_type="classify_intent",
        )
        if response:
            try:
                data = json.loads(response)
                intent = str(data.get("intent", "")).lower()
                if intent in ("chat", "breakdown"):
                    return intent
            except json.JSONDecodeError:
                try:
                    match = re.search(r"\{[\s\S]*?\}", response)
                    if match:
                        data = json.loads(match.group())
                        intent = str(data.get("intent", "")).lower()
                        if intent in ("chat", "breakdown"):
                            return intent
                except json.JSONDecodeError:
                    pass

        text_lower = text.lower()
        breakdown_keywords = [
            "卡",
            "难",
            "不会",
            "不知道",
            "怎么开始",
            "启动困难",
            "想要拆解",
            "拆解",
        ]
        if any(keyword in text_lower for keyword in breakdown_keywords):
            return "breakdown"
        extra_breakdown_keywords = [
            "准备",
            "复习",
            "考试",
            "面试",
            "计划",
            "任务",
            "论文",
            "作业",
            "项目",
            "汇报",
        ]
        if any(keyword in text_lower for keyword in extra_breakdown_keywords):
            return "breakdown"
        return "chat"

    def summarize_breakdown(self, task: str, steps: List[str]) -> str:
        """Summarize breakdown into a short, spoken suggestion."""
        if not steps:
            return "我已经帮你拆解了一下，我们先从第一步开始吧。"

        system_prompt = (
            "你是一个口语化的工作伙伴。"
            "根据任务和步骤，用一句简短的话建议从第一步开始，"
            "不要列出多步，不要输出列表。"
        )
        user_prompt = f"任务：{task}\n步骤：{steps}\n请输出一句话建议。"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = self._call_qwen(
            messages,
            max_tokens=60,
            temperature=0.6,
            task_type="summarize_breakdown",
        )
        if response:
            return response.strip()

        return f"这确实有点难，我们先从“{steps[0]}”开始吧。"

    def summarize_title(self, task: str, steps: List[str]) -> str:
        """Summarize task into a short title (<=9 chars)."""
        system_prompt = (
            "请为任务生成一个中文标题，要求：不超过9个字符，简洁准确，"
            "不要标点，不要解释，只输出标题。"
        )
        user_prompt = f"任务：{task}\n步骤：{steps}\n请输出标题："
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        response = self._call_qwen(messages, max_tokens=30, temperature=0.3)
        if response:
            return response.strip().splitlines()[0]
        return ""

    def summarize_memo(self, text: str) -> str:
        """Summarize a flash memo into a short todo/reminder phrase."""
        cleaned = (text or "").strip()
        if not cleaned:
            return ""

        system_prompt = (
            "你是一个任务提醒助手。"
            "请把用户的闪念总结成一条简短、可执行的待办提醒。"
            "要求：输出一句话，不超过15字，不要引号，不要列表，不要解释。"
        )
        user_prompt = f"用户闪念：{cleaned}\n请输出总结后的待办。"

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = self._call_qwen(messages, max_tokens=40, temperature=0.4)
        if response:
            return response.strip().strip('"')

        return ""

    def chat(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
        task_type: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Chat Agent - 伙伴闲聊
        基于 FlowMate Persona 生成回复
        """
        system_prompt = """你是 FlowMate，一个陪伴用户进入心流状态的温暖伙伴。

【性格】
- 语调轻柔、鼓励、有趣
- 关心用户的工作状态和身心健康
- 像一个安静的图书馆伙伴
"""

        messages = [{"role": "system", "content": system_prompt}]
        if history:
            for h in history[-6:]:
                if "user" in h:
                    messages.append({"role": "user", "content": h["user"]})
                if "assistant" in h:
                    messages.append({"role": "assistant", "content": h["assistant"]})
        messages.append({"role": "user", "content": message})

        def extract_text(chunk) -> str:
            if chunk is None:
                return ""
            if isinstance(chunk, dict):
                output = chunk.get("output") or {}
            else:
                output = getattr(chunk, "output", None) or {}

            if isinstance(output, dict):
                choices = output.get("choices") or []
                if choices:
                    message_obj = choices[0].get("message") or {}
                    content = message_obj.get("content")
                    if isinstance(content, str):
                        return content
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and isinstance(item.get("text"), str):
                                return item.get("text") or ""

                if isinstance(output.get("text"), str):
                    return output.get("text") or ""

            return ""

        model = self.choose_model(task_type)
        try:
            response = Generation.call(
                model=model,
                api_key=self.api_key,
                messages=messages,
                max_tokens=150,
                temperature=0.8,
                result_format="message",
                stream=True,
            )
        except Exception as e:
            print(f"DashScope stream call error: {e}")
            raise

        full_text = ""
        has_any = False
        for chunk in response:
            text = extract_text(chunk)
            if not text:
                continue
            has_any = True
            if full_text and text.startswith(full_text):
                delta = text[len(full_text):]
                full_text = text
            else:
                delta = text
                full_text += text
            if delta:
                yield delta

        if not has_any:
            fallback = self._get_fallback_chat(message)
            if fallback:
                yield fallback

    def stream_chat(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
        task_type: str = "stream_chat",
    ) -> Iterator[str]:
        """Stream chat reply chunks for SSE test path."""
        yield from self.chat(message, history, task_type=task_type)

    def generate_reply_from_asr(self, user_text: str, user_emotion: str) -> str:
        """
        Generate a short reply for the voice pipeline.
        Emotion is used as context only; TTS emotion is rule-based elsewhere.
        """
        system_prompt = (
            "你是 FlowMate，一个温和且坚定的效率伙伴。"
            "请用中文回复 1-2 句话，简洁、友好、支持用户。"
        )

        user_prompt = (
            f"用户情绪（仅供参考）：{user_emotion}\n"
            f"用户说：{user_text}\n"
            "请以 FlowMate 的口吻回复："
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        response = self._call_qwen(
            messages,
            max_tokens=120,
            temperature=0.7,
            task_type="generate_reply_from_asr",
        )
        if response:
            return response.strip()

        return "我在这里陪着你。可以再说一遍吗？"

    def _detect_emotion(self, message: str) -> str:
        """简单的情绪检测"""
        message_lower = message.lower()

        if any(word in message_lower for word in ["完成", "做完", "搞定", "成功"]):
            return "happy"
        if any(word in message_lower for word in ["累", "困", "疲", "烦"]):
            return "tired"
        if any(word in message_lower for word in ["难", "卡住", "不会", "帮"]):
            return "need_help"
        if any(word in message_lower for word in ["你好", "hi", "嗨", "早"]):
            return "greeting"

        return "neutral"

    def _get_fallback_chat(self, message: str) -> str:
        """回退方案：预设聊天回复"""
        message_lower = message.lower()

        if any(word in message_lower for word in ["完成", "做完", "搞定"]):
            return "刚才你简直是打字机成精了，给自己一个小奖励吧。"
        if any(word in message_lower for word in ["累", "困", "疲"]):
            return "知道吗，章鱼有三颗心脏。休息一下，让大脑换个频率。"
        if any(word in message_lower for word in ["难", "卡住"]):
            return "卡住没关系，先深呼吸一下，换个角度试试。"
        if any(word in message_lower for word in ["你好", "hi", "嗨"]):
            return "你好呀，今天打算做什么？我陪你一起。"
        if any(word in message_lower for word in ["谢", "谢谢"]):
            return "不客气，继续加油，我在这里陪着你。"

        return "我在这里陪着你，有什么需要帮忙的吗？"


# 全局实例
dashscope_service = DashScopeService()
