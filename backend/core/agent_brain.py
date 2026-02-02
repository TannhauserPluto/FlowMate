'''
FlowMate-Echo Agent Brain
'''

import json
import os
from typing import Optional, List
import httpx
from config import settings
from .prompt_templates import PromptTemplates


class AgentBrain:
    '''AI decision brain'''

    def __init__(self):
        self.api_key = settings.DASHSCOPE_API_KEY
        self.model = settings.QWEN_MAX_MODEL
        self.base_url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
        self.prompts = PromptTemplates()
        # Use preset replies for demo when enabled
        self.use_preset = os.getenv("FLOWMATE_USE_PRESET", "false").lower() == "true"

    async def _call_qwen(self, messages: List[dict], max_tokens: int = 1024) -> Optional[str]:
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
        task_lower = task_description.lower().strip()
        for key, value in self.prompts.PRESET_TASK_RESPONSES.items():
            if key in task_lower or task_lower in key:
                return value["steps"]
        return self.prompts.PRESET_TASK_RESPONSES["default"]["steps"]

    async def generate_task_breakdown(self, task_description: str) -> List[str]:
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
            try:
                json_start = response.find("{")
                json_end = response.rfind("}") + 1
                if json_start >= 0 and json_end > json_start:
                    json_str = response[json_start:json_end]
                    data = json.loads(json_str)
                    if "steps" in data and isinstance(data["steps"], list):
                        return data["steps"][:3]
            except json.JSONDecodeError:
                pass

            tasks = []
            for line in response.strip().split("\n"):
                line = line.strip()
                if line and (line[0].isdigit() or line.startswith("-")):
                    task = line.lstrip("0123456789.-) ").strip()
                    if task:
                        tasks.append(task)
            if tasks:
                return tasks[:3]

        if self.use_preset:
            return self._get_preset_tasks(task_description)
        raise RuntimeError("LLM task breakdown unavailable")

    async def generate_task_topic(self, task_description: str, steps: List[str]) -> str:
        messages = [
            {
                "role": "system",
                "content": "??????????????????8????????????????",
            },
            {
                "role": "user",
                "content": f"???{task_description}\n???{steps}\n???",
            },
        ]
        response = await self._call_qwen(messages, max_tokens=30)
        if response:
            return response.strip().splitlines()[0][:8]
        return ""

    async def generate_encouragement(self, flow_state: str, work_duration: int, fatigue_level: int) -> str:
        work_minutes = work_duration // 60
        if self.use_preset:
            return self.prompts.get_encouragement_by_state(flow_state, work_minutes)

        context = f"??:{flow_state} ??:{work_minutes}?? ??:{fatigue_level}%"
        messages = [
            {"role": "system", "content": self.prompts.encouragement_system},
            {"role": "user", "content": context},
        ]

        response = await self._call_qwen(messages, max_tokens=50)
        return response or self.prompts.get_encouragement_by_state(flow_state, work_minutes)

    async def generate_focus_message(
        self,
        purpose: str,
        task_text: str = "",
        user_reply: str = "",
        history: Optional[List[dict]] = None,
    ) -> str:
        system_prompt = (
            "???????????????????????????"
            "???????30????????????"
        )
        user_content = f"??: {purpose}\n??: {task_text}\n????: {user_reply}\n?????????"
        messages = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(history[-6:])
        messages.append({"role": "user", "content": user_content})

        response = await self._call_qwen(messages, max_tokens=60)
        if response:
            return response.strip().splitlines()[0]

        fallback = {
            "ask_task": "???????????",
            "encourage": "?????????",
            "distracted": "??????????????????",
            "ask_rest": "?????????????????",
            "continue": "???????????",
            "shorten": "??????????????",
            "end_focus": "??????????",
        }
        return fallback.get(purpose, "???????")

    async def chat(self, message: str, context: Optional[str] = None) -> str:
        if self.use_preset:
            message_lower = message.lower()
            if "?" in message_lower or "?" in message_lower:
                return "???????????????"
            if "?" in message_lower or "?" in message_lower:
                return "???????????????"
            if "??" in message_lower or "hi" in message_lower:
                return "????????????"
            if "?" in message_lower:
                return "????????"

        messages = [{"role": "system", "content": self.prompts.chat_system}]
        if context:
            messages.append({"role": "system", "content": f"???:{context}"})
        messages.append({"role": "user", "content": message})

        response = await self._call_qwen(messages, max_tokens=100)
        return response or "???????"

    async def analyze_screen_content(self, analysis_result: str) -> dict:
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

        return {
            "app": "unknown",
            "is_working": True,
            "distraction": False,
            "focus_score": 7,
        }

    def set_preset_mode(self, enabled: bool):
        self.use_preset = enabled


agent_brain = AgentBrain()
