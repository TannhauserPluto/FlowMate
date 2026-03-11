"""
FlowMate-Echo Screen Focus Audit Service
屏幕专注度审计服务 - 双重过滤机制实现

核心策略：
1. 时间冷却 (Time Throttling) - 10分钟内不重复调用 API
2. 视觉变化防抖 (Visual Debounce) - 屏幕无变化时跳过 API 调用
"""

import asyncio
import base64
import json
import random
import time
from io import BytesIO
from typing import Dict, Optional, Tuple

import cv2
import numpy as np
from PIL import Image

import os
from config import settings

# Short backoff after API errors to avoid rapid retries
ERROR_COOLDOWN_SECONDS = 30

# 尝试导入 DashScope
try:
    from dashscope import MultiModalConversation
    DASHSCOPE_AVAILABLE = True
except ImportError:
    DASHSCOPE_AVAILABLE = False
    print("Warning: dashscope not installed, using mock mode")


class ScreenAgentService:
    """
    屏幕专注度审计服务 (单例模式)
    
    双重过滤机制 (Double Throttling Strategy):
    ├── 步骤 A: 时间冷却 - 10分钟内复用缓存结果
    ├── 步骤 B: 视觉防抖 - 屏幕无变化时跳过 API
    ├── 步骤 C: 大模型推理 - 实际调用 QwenVL
    └── 步骤 D: Mock 模式 - 开发测试用
    """
    
    _instance: Optional['ScreenAgentService'] = None
    
    # ==================== 配置常量 ====================
    # Mock 开关：环境变量优先，其次 DEBUG_MODE
    MOCK_MODE: bool = os.getenv("SCREEN_MOCK_MODE", "false").lower() == "true" or settings.DEBUG_MODE
    
    TIME_COOLDOWN_SECONDS: int = 600  # 时间冷却：10分钟 = 600秒
    VISUAL_DIFF_THRESHOLD: float = 0.01  # 视觉变化阈值：1%
    THUMBNAIL_SIZE: Tuple[int, int] = (64, 64)  # 缩略图尺寸 (用于视觉对比)
    MAX_IMAGE_DIMENSION: int = 1280  # 发送给 VLM 的最大图片边长
    
    # VLM 模型配置
    VLM_MODEL: str = "qwen-vl-max"  # 或 "qwen-vl-plus"
    
    def __new__(cls) -> 'ScreenAgentService':
        """单例模式"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        # ==================== 内存状态 ====================
        self._last_api_call_time: float = 0.0  # 上次真正调用 API 的时间戳
        self._last_frame_cache: Optional[np.ndarray] = None  # 上次分析的帧 (灰度缩略图)
        self._last_analysis_result: Dict = self._get_default_result()  # 上次分析结果
        
        self._last_error_time = 0.0
        self._last_error_result = None

        self._initialized = True
        print("[ScreenAgent] Service initialized, MOCK_MODE =", self.MOCK_MODE)
    
    # ==================== 主入口 ====================
    
    async def audit_screen(
        self,
        image_b64: str,
        current_task: str,
        cooldown_seconds: Optional[int] = None,
    ) -> Dict:
        """
        审计屏幕专注度 (主入口方法)
        
        Args:
            image_b64: Base64 编码的屏幕截图
            current_task: 用户当前任务描述 (例如 "写后端代码")
            
        Returns:
            {
                "is_focused": bool,
                "score": int (0-100),
                "analysis": str,
                "suggestion": str,
                "source": str  # "cache" | "visual_skip" | "llm" | "mock"
            }
        """
        
        # ========== 步骤 D: Mock 模式 ==========
        if self.MOCK_MODE:
            return await self._mock_analysis()
        
        # ========== 步骤 A: 时间冷却检查 ==========
        current_time = time.time()
        time_since_last_call = current_time - self._last_api_call_time
        cooldown = self.TIME_COOLDOWN_SECONDS if cooldown_seconds is None else max(0, cooldown_seconds)

        if time_since_last_call < cooldown:
            # 未超过冷却时间，直接返回缓存结果
            remaining = int(cooldown - time_since_last_call)
            print(f"[ScreenAgent] 时间冷却中，剩余 {remaining} 秒，返回缓存结果")
            result = self._last_analysis_result.copy()
            result["source"] = "cache"
            result["cooldown_remaining"] = remaining
            return result

        time_since_error = current_time - self._last_error_time
        if self._last_error_result is not None and time_since_error < ERROR_COOLDOWN_SECONDS:
            remaining = int(ERROR_COOLDOWN_SECONDS - time_since_error)
            result = self._last_error_result.copy()
            result["source"] = "error_cooldown"
            result["cooldown_remaining"] = remaining
            return result

        # ========== 步骤 B: 视觉变化防抖 ==========
        try:
            current_thumbnail = self._decode_and_thumbnail(image_b64)
            
            if current_thumbnail is not None and self._last_frame_cache is not None:
                diff_ratio = self._calculate_visual_diff(
                    self._last_frame_cache, 
                    current_thumbnail
                )
                
                if diff_ratio < self.VISUAL_DIFF_THRESHOLD:
                    # 屏幕无实质变化，跳过 API 调用
                    # 但仍更新时间戳，重置冷却计时器
                    self._last_api_call_time = current_time
                    print(f"[ScreenAgent] 视觉变化 {diff_ratio:.2%} < 阈值 {self.VISUAL_DIFF_THRESHOLD:.2%}，跳过 API")
                    result = self._last_analysis_result.copy()
                    result["source"] = "visual_skip"
                    result["visual_diff"] = round(diff_ratio, 4)
                    return result
                
                print(f"[ScreenAgent] 视觉变化 {diff_ratio:.2%}，需要调用 API")
            
            # 更新帧缓存
            if current_thumbnail is not None:
                self._last_frame_cache = current_thumbnail
                
        except Exception as e:
            print(f"[ScreenAgent] 视觉防抖异常: {e}，继续调用 API")
        
        # ========== 步骤 C: 大模型推理 ==========
        try:
            result = await self._call_vlm(image_b64, current_task)
            result["source"] = "llm"

            # 逻辑纠偏：确保分类/分数/专注状态自洽
            category = str(result.get("category", "")).strip().lower()
            raw_score = result.get("score", 0)
            try:
                score = int(raw_score)
            except (TypeError, ValueError):
                score = 0
            is_focused = bool(result.get("is_focused", True))

            # 规则A：Reference 视为专注，且低分修正
            if category == "reference":
                if score < 60:
                    score = 70
                is_focused = True

            # 规则B：分数保护，60 分及以上必须专注
            if score >= 60:
                is_focused = True

            # 规则C：仅 Distracted 且低分时允许分心
            if category == "distracted" and score < 60:
                is_focused = False

            result["score"] = max(0, min(100, score))
            result["is_focused"] = is_focused
            
            # 更新缓存
            self._last_api_call_time = current_time
            self._last_analysis_result = result
            self._last_error_time = 0.0
            self._last_error_result = None
            
            return result
            
        except Exception as e:
            print(f"[ScreenAgent] VLM 调用失败: {e}，返回默认结果")
            # API 失败时返回中性结果，避免前端报错
            result = self._get_default_result()
            result["source"] = "error"
            result["error"] = str(e)
            self._last_error_time = current_time
            self._last_error_result = result.copy()
            return result
    
    # ==================== 步骤 B: 视觉处理 ====================
    
    def _decode_and_thumbnail(self, image_b64: str) -> Optional[np.ndarray]:
        """
        解码 Base64 图片并生成灰度缩略图
        
        用于视觉变化检测，使用极小尺寸以提高比较速度
        """
        try:
            # 移除 Data URL 前缀
            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]
            
            # Base64 解码
            image_bytes = base64.b64decode(image_b64)
            nparr = np.frombuffer(image_bytes, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if image is None:
                return None
            
            # Resize 到极小尺寸
            thumbnail = cv2.resize(image, self.THUMBNAIL_SIZE, interpolation=cv2.INTER_AREA)
            
            # 转为灰度图
            gray = cv2.cvtColor(thumbnail, cv2.COLOR_BGR2GRAY)
            
            return gray
            
        except Exception as e:
            print(f"[ScreenAgent] 缩略图生成失败: {e}")
            return None
    
    def _calculate_visual_diff(self, frame1: np.ndarray, frame2: np.ndarray) -> float:
        """
        计算两帧之间的视觉差异比例
        
        算法：使用 cv2.absdiff 计算绝对差异，统计非零像素占比
        
        Returns:
            差异比例 (0.0 ~ 1.0)，例如 0.01 表示 1% 的像素有变化
        """
        try:
            # 确保尺寸一致
            if frame1.shape != frame2.shape:
                frame2 = cv2.resize(frame2, (frame1.shape[1], frame1.shape[0]))
            
            # 计算绝对差异
            diff = cv2.absdiff(frame1, frame2)
            
            # 二值化（差异大于阈值的像素标记为变化）
            _, thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
            
            # 计算非零像素占比
            non_zero = cv2.countNonZero(thresh)
            total = thresh.size
            
            return non_zero / total if total > 0 else 0.0
            
        except Exception as e:
            print(f"[ScreenAgent] 视觉差异计算失败: {e}")
            return 1.0  # 出错时返回 100%，强制调用 API
    
    # ==================== 步骤 C: VLM 调用 ====================
    
    async def _call_vlm(self, image_b64: str, current_task: str) -> Dict:
        """
        调用 QwenVL 大模型进行屏幕分析
        """
        if not DASHSCOPE_AVAILABLE:
            print("[ScreenAgent] DashScope 不可用，使用 Mock 结果")
            return await self._mock_analysis()
        
        api_key = settings.DASHSCOPE_API_KEY
        if not api_key or api_key == "your_dashscope_api_key_here":
            print("[ScreenAgent] API Key 未配置，使用 Mock 结果")
            return await self._mock_analysis()
        
        # 优化图片尺寸以减少 Token 消耗
        optimized_image = self._optimize_image_for_vlm(image_b64)
        
        # 构建 System Prompt
        system_prompt = """
        你是一个严厉的生产力审计员。你的任务是根据【用户当前任务】和【屏幕截图】判断用户是否分心。

        用户当前任务：{current_task}

        请严格按照以下步骤思考（Chain of Thought）：
        1. **识别应用**：画面中最显著的窗口是什么软件？(如 VS Code, Bilibili, 微信, Word)
        2. **内容分析**：如果是浏览器，具体页面标题或内容是什么？与任务有语义关联吗？
        3. **分类判定 (关键步骤)**：
        - [Focused]: 强相关（如：任务是写代码，屏幕是 IDE）
        - [Reference]: 查资料/学习（如：任务是写代码，屏幕是技术文档；**任务是写论文，屏幕是B站/YouTube上的学术教程**）
        - [Distracted]: 明显分心（如：**非学术类**的娱乐视频、社交聊天、游戏、购物、小说）
        - [Idle]: 桌面或空白
        4. **打分规则**：
        - Focused: 85-100
        - Reference: 60-80 (注意：如果是视频教程，只要内容与任务强相关，应归为此类，给及格分！)
        - Distracted: 0-40 (只有确认视频内容为娱乐/鬼畜/游戏时才给低分)
        - Idle: 50

        **特别注意**：对于 Bilibili/YouTube 等视频网站，必须通过**视频标题**和**画面内容**来判断。如果标题包含“教程”、“指南”、“课程”、“写作”、“各种学术名词”，请务必判定为 [Reference] 而非 [Distracted]！


        请输出纯 JSON：
        {
        "detected_app": "Chrome (Bilibili)",
        "category": "Distracted",
        "reasoning": "检测到视频播放界面，内容为娱乐向视频，与代码任务无关。",
        "score": 10,
        "is_focused": false
        }
        """

        try:
            # 异步调用 DashScope (在线程池中执行同步调用)
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: MultiModalConversation.call(
                    model=self.VLM_MODEL,
                    api_key=api_key,
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"image": optimized_image},
                                {"text": system_prompt},
                            ],
                        }
                    ],
                )
            )
            
            # 解析响应
            if response.status_code == 200:
                content = response.output.choices[0].message.content[0].get("text", "")
                return self._parse_vlm_response(content)
            else:
                print(f"[ScreenAgent] VLM API 错误: {response.code} - {response.message}")
                return self._get_default_result()
                
        except Exception as e:
            print(f"[ScreenAgent] VLM 调用异常: {e}")
            raise
    
    def _optimize_image_for_vlm(self, image_b64: str) -> str:
        """
        优化图片尺寸以减少 Token 消耗
        
        将长边限制在 MAX_IMAGE_DIMENSION 以内
        """
        try:
            # 移除 Data URL 前缀
            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]
            
            # 解码
            image_bytes = base64.b64decode(image_b64)
            image = Image.open(BytesIO(image_bytes))
            
            # 获取原始尺寸
            width, height = image.size
            max_dim = max(width, height)
            
            # 如果已经足够小，直接返回
            if max_dim <= self.MAX_IMAGE_DIMENSION:
                return f"data:image/jpeg;base64,{image_b64}"
            
            # 计算缩放比例
            scale = self.MAX_IMAGE_DIMENSION / max_dim
            new_width = int(width * scale)
            new_height = int(height * scale)
            
            # 缩放
            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            
            # 重新编码为 Base64
            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=85)
            optimized_b64 = base64.b64encode(buffer.getvalue()).decode()
            
            print(f"[ScreenAgent] 图片优化: {width}x{height} → {new_width}x{new_height}")
            
            return f"data:image/jpeg;base64,{optimized_b64}"
            
        except Exception as e:
            print(f"[ScreenAgent] 图片优化失败: {e}，使用原图")
            if not image_b64.startswith("data:"):
                return f"data:image/jpeg;base64,{image_b64}"
            return image_b64
    
    def _parse_vlm_response(self, content: str) -> Dict:
        """
        解析 VLM 响应为标准格式
        """
        try:
            # 清理可能的 Markdown 代码块
            content = content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            if content.endswith("```"):
                content = content[:-3]
            
            # 解析 JSON
            result = json.loads(content.strip())
            
            # 确保必要字段存在
            return {
                "is_focused": result.get("is_focused", True),
                "score": result.get("score", 50),
                "analysis": result.get("analysis", "分析完成"),
                "suggestion": result.get("suggestion", "继续保持"),
            }
            
        except json.JSONDecodeError as e:
            print(f"[ScreenAgent] JSON 解析失败: {e}，原始内容: {content[:100]}")
            return self._get_default_result()
    
    # ==================== 步骤 D: Mock 模式 ====================
    
    async def _mock_analysis(self) -> Dict:
        """
        Mock 模式：返回随机测试数据，模拟 1 秒延迟
        """
        await asyncio.sleep(1.0)  # 模拟网络延迟
        
        is_focused = random.choice([True, True, True, False])  # 75% 概率专注
        
        if is_focused:
            return {
                "is_focused": True,
                "score": random.randint(70, 95),
                "analysis": random.choice([
                    "检测到 VS Code 编辑器，正在编写代码",
                    "检测到浏览器访问技术文档",
                    "检测到终端窗口，正在执行命令",
                ]),
                "suggestion": "继续保持专注",
                "source": "mock",
            }
        else:
            return {
                "is_focused": False,
                "score": random.randint(20, 45),
                "analysis": random.choice([
                    "检测到社交媒体应用",
                    "检测到视频网站",
                    "检测到游戏窗口",
                ]),
                "suggestion": "建议关闭分心应用，回到工作",
                "source": "mock",
            }
    
    # ==================== 辅助方法 ====================
    
    def _get_default_result(self) -> Dict:
        """
        获取默认的中性结果 (用于错误回退)
        """
        return {
            "is_focused": True,
            "score": 50,
            "analysis": "无法分析屏幕内容",
            "suggestion": "请继续工作",
        }
    
    def reset_cache(self) -> None:
        """
        重置所有缓存 (用于测试)
        """
        self._last_api_call_time = 0.0
        self._last_frame_cache = None
        self._last_analysis_result = self._get_default_result()
        self._last_error_time = 0.0
        self._last_error_result = None
        print("[ScreenAgent] 缓存已重置")
    
    def get_status(self) -> Dict:
        """
        获取服务状态 (用于调试)
        """
        current_time = time.time()
        time_since_last = current_time - self._last_api_call_time
        
        return {
            "mock_mode": self.MOCK_MODE,
            "cooldown_seconds": self.TIME_COOLDOWN_SECONDS,
            "time_since_last_call": int(time_since_last),
            "cooldown_remaining": max(0, self.TIME_COOLDOWN_SECONDS - int(time_since_last)),
            "has_frame_cache": self._last_frame_cache is not None,
            "last_result": self._last_analysis_result,
        }


# 全局单例实例
screen_agent = ScreenAgentService()
