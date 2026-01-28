这是 FlowMate 后端技术文档的中文翻译版本：

---

# FlowMate 后端技术文档 (p1v2)

最后更新：2026-01-28

## 1. 概述 (Overview)

FlowMate 后端是一个 FastAPI 服务，用于支持 Electron 桌面应用。它提供以下功能：

* 视觉在场检测 (MediaPipe)
* 屏幕审计与专注度分析 (Qwen-VL + 本地启发式算法)
* 语音管道 (SenseVoice 语音识别 → Qwen-Max → CosyVoice 语音合成)
* 任务拆解与对话 (Qwen-Max)
* 健康检查及音频文件服务等辅助端点

服务入口：`backend/main.py`

## 2. 运行后端 (Running the Backend)

* `npm run start:backend`
* 或者：`cd backend && uvicorn main:app --reload --port 8000`

## 3. 环境配置 (Environment Configuration)

主配置位于 `.env` 文件中（参见 `.env.example`）。
关键变量包括：

* `DASHSCOPE_API_KEY` – 必填，用于 Qwen-Max, Qwen-VL, CosyVoice, SenseVoice
* `QWEN_MAX_MODEL` – 默认 `qwen-max`
* `QWEN_VL_MODEL` – 默认 `qwen-vl-plus`
* `COSYVOICE_MODEL` / `COSYVOICE_VOICE` / `COSYVOICE_FALLBACK_VOICE`
* `AUDIO_MOCK_MODE`, `SCREEN_MOCK_MODE`, `DEBUG_MODE`

**SenseVoice 录音文件识别 (OSS配置):**

* `OSS_ENDPOINT`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`
* 可选：`OSS_PUBLIC_BASE_URL`, `OSS_USE_SIGNED_URL`, `OSS_SIGNED_URL_EXPIRES`
* `SENSEVOICE_MODEL`, `SENSEVOICE_SAMPLE_RATE`, `SENSEVOICE_AUDIO_FORMAT`

## 4. API 路由 (API Routes)

### 4.1 健康检查 (Health)

* `GET /` – 状态及版本
* `GET /health` – 健康检查

### 4.2 感知/在场检测 (Perception)

`/api/perception/*` (参见 `backend/api/perception.py`)

* 在场检测使用 MediaPipe Pose 对单帧图像进行分析。

### 4.3 交互 (Interaction)

`/api/interaction/*` (参见 `backend/api/interaction.py`)

#### POST `/api/interaction/speak`

根据文本 + 情绪生成 TTS（语音合成）及动作驱动。
请求：

```json
{ "text": "...", "emotion": "strict|encouraging|neutral|shush" }

```

响应：

```json
{
  "status": "success|mock|error",
  "data": {
    "audio": {"base64": "...", "format": "mp3", "sample_rate": 24000, "estimated_duration_ms": 3500},
    "driver": {"motion_trigger": "...", "expression_trigger": "...", "subtitle": "..."}
  },
  "error": {"code": "...", "message": "..."}
}

```

#### POST `/api/interaction/voice`

语音管道端点 (ASR → LLM → TTS)。

* 接受包含 `audio` 文件的 `multipart/form-data` 请求。
* 返回用户文本/情绪、助手文本/情绪、音频、动作及时间戳信息。

#### POST `/api/interaction/generate-tasks`

任务拆解 (Qwen-Max)，基于单个任务描述生成子任务。

#### POST `/api/interaction/get-response`

旧版 AI 响应端点 (用于鼓励 / 休息提示 / 动画触发)。

#### POST `/api/interaction/chat`

聊天接口 (Qwen-Max)，支持可选的上下文。

#### GET `/api/interaction/audio/{filename}`

提供本地缓存的音频文件服务。

## 5. 核心后端功能 (Core Backend Features)

### 5.1 在场检测 (MediaPipe)

模块：`backend/services/modelscope_vision.py`

* 使用 MediaPipe Pose 检测画面中是否有人。
* 返回是否存在 (presence)、置信度、关键点数量及调试信息。

### 5.2 屏幕审计 (Qwen-VL)

模块：`backend/services/screen_agent.py`

* 使用 Qwen-VL 分析屏幕截图以进行专注度评估。
* 支持 Mock 模式和速率限制，防止 Token 用量失控。
* 追踪最后一次 API 调用时间及错误冷却时间。

### 5.3 语音管道 (ASR → LLM → TTS)

模块：

* `backend/services/sensevoice_asr.py` – SenseVoice 录音文件 ASR
* `backend/services/voice_pipeline.py` – 管道流程编排
* `backend/services/modelscope_audio.py` – CosyVoice TTS + 动作输出
* `backend/services/dashscope_service.py` – Qwen-Max 文本生成

管道流程：

1. 上传音频至 OSS → `Transcription.async_call` → `Transcription.wait`
2. 获取 `transcription_url` JSON 并提取文本/情绪
3. 通过 Qwen-Max 生成回复
4. 基于规则的情绪仲裁，用于 TTS
5. 生成 Base64 音频 + 动作/表情 + 字幕

基于规则的情绪仲裁：

* `sad` (悲伤) / `angry` (愤怒) / `happy` (开心) → `encouraging` (鼓励)
* 其他情况 → `neutral` (中性)

降级/回退行为：

* ASR 失败 → 使用中文回复“没听清”
* TTS 失败 → 返回空音频但保留字幕 (HTTP 200)

耗时日志：

* `asr_ms`, `llm_ms`, `tts_ms`, `total_ms`

### 5.4 CosyVoice TTS & 动作驱动

模块：`backend/services/modelscope_audio.py`

* 使用 DashScope CosyVoice SDK
* 支持指令驱动的语音风格
* 返回 Base64 MP3 + 动作触发器 + 表情
* 可通过 `AUDIO_MOCK_MODE` 开启模拟模式

### 5.5 Qwen-Max 任务拆解

模块：`backend/services/dashscope_service.py`

* 将一个任务拆解为 3 个具体步骤
* 通过提示词强制要求严格的 JSON 输出

### 5.6 聊天 / 鼓励

模块：`backend/services/dashscope_service.py`

* 友好、简短的回复
* 情绪检测 (基于规则)

## 6. 测试工具 (Test Utilities)

* `voice_pipeline_test.html` – 录制音频，调用 `/api/interaction/voice`，播放 TTS
* `camera_test.html`, `screen_test.html` – 手动前端测试工具

## 7. 已知局限 (Known Limitations)

* SenseVoice 录音文件识别需要配置 OSS。
* 如果 OSS URL 不可公网访问（或签名 URL 配置错误），ASR 将返回空文本。
* WebM/Opus 输入仅在 SenseVoice 接受该文件格式时支持；WAV/MP3 更为可靠。

## 8. 建议的下一步 (Suggested Next Steps)

* 将任务拆解集成到语音管道中（意图识别：任务 vs 聊天）
* 添加 OSS 配置的启动检查
* 改进 ASR 解析逻辑以处理更多结果变体
* 添加语音管道的前端生产环境 UI 集成

