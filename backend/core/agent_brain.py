"""
FlowMate-Echo Agent Brain
决策中枢 - 基于 Qwen-Max 的 AI 大脑 (MVP 版本)
"""

import json
from typing import Optional, List
import httpx
from config import settings
from .prompt_templates import PromptTemplates


class AgentBrain:
    """AI 决策中枢"""

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.model = settings.QWEN_MAX_MODEL
        self.base_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
        self.prompts = PromptTemplates()
        # MVP: 启用预制响应 (演示用)
        self.use_preset = True

    async def _call_qwen(self, messages: List[dict], max_tokens: int = 1024) -> Optional[str]:
        """调用 Qwen-Max API"""
        if not self.api_key or self.api_key == "your_dashscope_api_key_here":
            return None

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": self.model,
            "input": {"messages": messages},
            "parameters": {
                "max_tokens": max_tokens,
                "temperature": 0.7,
            },
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.base_url,
                    headers=headers,
                    json=payload,
                    timeout=30.0,
                )
                response.raise_for_status()
                result = response.json()
                return result["output"]["text"]
        except Exception as e:
            print(f"Qwen API error: {e}")
            return None

    def _get_preset_tasks(self, task_description: str) -> List[str]:
        """获取预制任务响应 (MVP 演示用)"""
        task_lower = task_description.lower().strip()
        
        # 查找匹配的预制响应
        for key, value in self.prompts.PRESET_TASK_RESPONSES.items():
            if key in task_lower or task_lower in key:
                return value["steps"]
        
        # 默认响应
        return self.prompts.PRESET_TASK_RESPONSES["default"]["steps"]

    async def generate_task_breakdown(self, task_description: str) -> List[str]:
        """生成任务拆解"""
        # MVP: 优先使用预制响应
        if self.use_preset:
            preset = self._get_preset_tasks(task_description)
            if preset:
                return preset

        messages = [
            {"role": "system", "content": self.prompts.task_breakdown_system},
            {"role": "user", "content": task_description},
        ]

        response = await self._call_qwen(messages, max_tokens=200)
        
        if response:
            # 尝试解析 JSON
            try:
                # 提取 JSON 部分
                json_start = response.find("{")
                json_end = response.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    json_str = response[json_start:json_end]
                    data = json.loads(json_str)
                    if "steps" in data and isinstance(data["steps"], list):
                        return data["steps"][:3]  # 确保只返回 3 个步骤
            except json.JSONDecodeError:
                pass
            
            # 回退：解析普通文本
            tasks = []
            for line in response.strip().split("\n"):
                line = line.strip()
                if line and (line[0].isdigit() or line.startswith("-")):
                    task = line.lstrip("0123456789.-) ").strip()
                    if task:
                        tasks.append(task)
            if tasks:
                return tasks[:3]

        # 最终回退：使用预制响应
        return self._get_preset_tasks(task_description)

    async def generate_encouragement(
        self, flow_state: str, work_duration: int, fatigue_level: int
    ) -> str:
        """生成鼓励/提醒语"""
        work_minutes = work_duration // 60
        
        # MVP: 优先使用预制鼓励语
        if self.use_preset:
            return self.prompts.get_encouragement_by_state(flow_state, work_minutes)

        context = f"状态:{flow_state} 工作:{work_minutes}分钟 疲劳:{fatigue_level}%"
        messages = [
            {"role": "system", "content": self.prompts.encouragement_system},
            {"role": "user", "content": context},
        ]

        response = await self._call_qwen(messages, max_tokens=50)
        return response or self.prompts.get_encouragement_by_state(flow_state, work_minutes)

    async def chat(self, message: str, context: Optional[str] = None) -> str:
        """闲聊对话"""
        # MVP: 简单的关键词响应
        if self.use_preset:
            message_lower = message.lower()
            if "卡" in message_lower or "难" in message_lower:
                return "卡住了吗？先休息一下，换个思路"
            if "累" in message_lower or "困" in message_lower:
                return "累了就休息一下吧，我在这里等你"
            if "你好" in message_lower or "hi" in message_lower:
                return "你好呀，准备开始工作了吗"
            if "谢" in message_lower:
                return "不客气，继续加油"

        messages = [{"role": "system", "content": self.prompts.chat_system}]
        if context:
            messages.append({"role": "system", "content": f"上下文:{context}"})
        messages.append({"role": "user", "content": message})

        response = await self._call_qwen(messages, max_tokens=100)
        return response or "我在这里陪着你"

    async def analyze_screen_content(self, analysis_result: str) -> dict:
        """分析屏幕内容并给出建议"""
        messages = [
            {"role": "system", "content": self.prompts.screen_analysis_system},
            {"role": "user", "content": analysis_result},
        ]

        response = await self._call_qwen(messages, max_tokens=200)
        
        if response:
            try:
                json_start = response.find("{")
                json_end = response.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    return json.loads(response[json_start:json_end])
            except json.JSONDecodeError:
                pass

        # 默认响应
        return {
            "app": "unknown",
            "is_working": True,
            "distraction": False,
            "focus_score": 7,
        }

    def set_preset_mode(self, enabled: bool):
        """设置预制响应模式"""
        self.use_preset = enabled


# 全局实例
agent_brain = AgentBrain()
