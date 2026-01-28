"""
FlowMate-Echo DashScope Service
阿里云 DashScope Qwen-Max 服务模块
"""

import json
import re
from typing import List, Optional, Dict
from dashscope import Generation
from dashscope.api_entities.dashscope_response import GenerationResponse
from config import settings


class DashScopeService:
    """DashScope Qwen-Max 服务"""

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.model = settings.QWEN_MAX_MODEL

    def _call_qwen(
        self,
        messages: List[dict],
        max_tokens: int = 1024,
        temperature: float = 0.7,
    ) -> Optional[str]:
        """同步调用 Qwen-Max API"""
        if not self.api_key or self.api_key == "your_dashscope_api_key_here":
            return None

        try:
            response: GenerationResponse = Generation.call(
                model=self.model,
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

        # 清理可能的 markdown 标记
        text = text.strip()
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)

        # 尝试直接解析
        try:
            result = json.loads(text)
            if isinstance(result, list):
                return [str(item) for item in result]
        except json.JSONDecodeError:
            pass

        # 尝试提取 JSON 数组部分
        try:
            match = re.search(r'\[[\s\S]*?\]', text)
            if match:
                result = json.loads(match.group())
                if isinstance(result, list):
                    return [str(item) for item in result]
        except json.JSONDecodeError:
            pass

        # 尝试按行解析为列表
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
        system_prompt = """你是一个任务拆解专家。你的唯一工作是将用户的大任务拆解为3个具体可执行的微步骤。

【强制输出格式】
你必须且只能输出一个JSON数组，格式如下：
["步骤1的具体动作", "步骤2的具体动作", "步骤3的具体动作"]

【规则】
1. 固定输出3个步骤，不多不少
2. 每个步骤必须是具体的物理动作，例如"打开Word"、"新建文件"、"输入标题"
3. 禁止使用抽象词汇如"思考"、"分析"、"理解"、"规划"
4. 每个步骤控制在15字以内
5. 不要输出任何解释、markdown标记或其他内容，只输出JSON数组

【示例】
输入：写一份调研报告
输出：["新建Word文档", "写下报告标题", "列出三个章节标题"]

输入：学习Python编程
输出：["打开VS Code", "新建test.py文件", "输入print语句并运行"]"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task},
        ]

        response = self._call_qwen(messages, max_tokens=200, temperature=0.5)

        if response:
            parsed = self._parse_json_array(response)
            if parsed and len(parsed) >= 3:
                return parsed[:3]

        # 回退：预设响应
        return self._get_fallback_tasks(task)

    def _get_fallback_tasks(self, task: str) -> List[str]:
        """回退方案：预设任务响应"""
        task_lower = task.lower()
        presets = {
            "报告": ["新建Word文档", "写下报告标题", "列出三个章节标题"],
            "论文": ["打开Word", "输入论文标题", "写出摘要第一句"],
            "代码": ["打开编辑器", "新建代码文件", "写第一个函数"],
            "python": ["打开VS Code", "新建test.py", "输入print语句"],
            "学习": ["打开学习资料", "阅读第一页", "写下一个关键词"],
            "复习": ["打开笔记本", "翻到第一页", "大声读出标题"],
            "ppt": ["打开PowerPoint", "新建空白幻灯片", "输入封面标题"],
            "邮件": ["打开邮箱", "点击新建邮件", "输入收件人地址"],
            "文章": ["打开文档", "写下文章标题", "输入第一段第一句"],
        }

        for key, steps in presets.items():
            if key in task_lower:
                return steps

        return ["打开相关软件", "新建工作文件", "写下第一行内容"]

    def chat(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, str]:
        """
        Chat Agent - 伴侣闲聊
        基于 FlowMate Persona 生成回复
        """
        system_prompt = """你是 FlowMate，一个旨在帮助用户进入心流状态的温暖伙伴。

【你的性格】
- 语调轻柔、鼓励、有趣
- 关心用户的工作状态和身心健康
- 像一个安静的图书馆伙伴

【行为规则】
1. 回复简短精炼，不超过50字
2. 不使用emoji表情
3. 语气自然，像朋友聊天

【特殊场景处理】
- 当用户表达疲劳、困倦时：分享一个有趣的冷知识来帮助"认知转换"缓解大脑疲劳
- 当用户求助或遇到困难时：给予鼓励和简单建议
- 当用户说"完成了"、"做完了"、"搞定了"时：夸奖用户，可以说"刚才你简直是打字机成精了！"
- 当用户打招呼时：友好回应，询问今天的工作计划

【冷知识示例】（用于缓解疲劳时分享）
- 章鱼有三颗心脏，两颗专门给鳃供血
- 蜂蜜是永远不会变质的食物
- 人类的大脑在睡眠时比看电视时更活跃"""

        # 构建消息列表
        messages = [{"role": "system", "content": system_prompt}]

        # 添加历史对话
        if history:
            for h in history[-6:]:  # 最多保留最近6轮
                if "user" in h:
                    messages.append({"role": "user", "content": h["user"]})
                if "assistant" in h:
                    messages.append({"role": "assistant", "content": h["assistant"]})

        # 添加当前消息
        messages.append({"role": "user", "content": message})

        response = self._call_qwen(messages, max_tokens=150, temperature=0.8)

        # 情绪检测
        emotion = self._detect_emotion(message)

        if response:
            return {"reply": response.strip(), "emotion": emotion}

        # 回退响应
        return {"reply": self._get_fallback_chat(message), "emotion": emotion}

    def generate_reply_from_asr(self, user_text: str, user_emotion: str) -> str:
        """
        Generate a short reply for the voice pipeline.
        Emotion is used as context only; TTS emotion is rule-based elsewhere.
        """
        system_prompt = (
            "你是 FlowMate，一个温和且坚定的效率伙伴。"
            "请用中文回复，1-2 句话，简洁、友好、支持用户。"
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

        response = self._call_qwen(messages, max_tokens=120, temperature=0.7)
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
        if any(word in message_lower for word in ["难", "卡", "不会", "帮"]):
            return "need_help"
        if any(word in message_lower for word in ["你好", "hi", "嗨", "早"]):
            return "greeting"

        return "neutral"

    def _get_fallback_chat(self, message: str) -> str:
        """回退方案：预设聊天响应"""
        message_lower = message.lower()

        if any(word in message_lower for word in ["完成", "做完", "搞定"]):
            return "刚才你简直是打字机成精了！给自己一个小奖励吧"
        if any(word in message_lower for word in ["累", "困", "疲"]):
            return "知道吗，章鱼有三颗心脏。休息一下，让大脑换换频道"
        if any(word in message_lower for word in ["难", "卡住"]):
            return "卡住了没关系，先深呼吸一下，换个角度试试"
        if any(word in message_lower for word in ["你好", "hi", "嗨"]):
            return "你好呀，今天打算做什么？我陪你一起"
        if any(word in message_lower for word in ["谢"]):
            return "不客气，继续加油，我在这里陪着你"

        return "我在这里陪着你，有什么需要帮忙的吗"


# 全局实例
dashscope_service = DashScopeService()
