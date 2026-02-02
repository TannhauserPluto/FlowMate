# FlowMate-Echo 全面说明（All About It）

本文档基于当前仓库代码与文档完整梳理，旨在 **非常详细** 地阐述 FlowMate-Echo 的产品功能、亮点与技术方案特色，并覆盖关键模块、接口、运行方式与测试工具。

---

## 1. 项目定位与愿景

FlowMate-Echo 是一款 **AI 陪伴式心流助手**。它通过数字人陪伴、智能感知、心流保护机制与语音交互，让用户更容易进入并保持专注状态。  
核心目标是：**降低启动阻力、维护专注节奏、在不打断的前提下提供柔性引导**。

结合 README 与 PRD 文档，FlowMate-Echo 的定位可归纳为：

- 以 **陪伴式专注** 为核心体验（Body Doubling）
- 以 **多模态感知** 为策略（屏幕、键盘、在场、疲劳）
- 以 **生成式 AI** 提供任务拆解与对话支持
- 以 **轻量可视化与强情绪节奏** 为交互风格（数字人状态、语音语气、动作触发）

---

## 2. 核心功能总览

### 2.1 数字人陪伴（Body Doubling）
通过预渲染视频循环与状态机切换（idle / focus / talk / stretch），形成“同桌陪学”的心理暗示，提升用户在场感与专注意愿。

### 2.2 智能感知（Screen / Presence / Fatigue）
多通道感知并不是为了“监管”，而是为了 **降低打扰** 与 **节奏调整**：

- 屏幕专注审计（Qwen-VL）
- 在场检测（MediaPipe Pose）
- 疲劳检测（OpenCV Haar cascades）

### 2.3 心流保护（Flow & Focus Session）
心流状态机与专注会话管理器协同运行，通过 **时间阈值**、**冷却机制**、**弱打断提示** 达到“少打扰、强保护”的状态管理。

### 2.4 任务拆解与对话
面向“卡住 / 不知道怎么开始 / 需要拆解”的情境，系统会自动将任务拆解为可执行的 3 个步骤，并生成简短引导语。

### 2.5 语音全链路
从 **录音 → ASR → 意图路由 → LLM 回复 → TTS 音频 + 动作驱动**，形成完整语音交互闭环。

---

## 3. 用户交互全流程（典型旅程）

下面以“启动 → 任务 → 专注 → 休息”的真实流程总结前后端协作：

1. **启动应用（Home）**
   - 读取 `/api/interaction/encouragement` 获取鼓励语。
   - 用户可文字或语音输入任务。

2. **意图识别**
   - 文本或语音被送入 `/api/interaction/intent` 或 `/api/interaction/voice`。
   - 若命中“拆解意图”，生成任务板；否则进入聊天。

3. **任务拆解（Task View）**
   - `/api/interaction/generate-tasks` 输出 3 个步骤。
   - UI 生成 Todo 卡片、任务标题、时间线记录。

4. **进入专注（Focus）**
   - `POST /api/focus/start` 创建会话。
   - 屏幕检查与疲劳检查定时启动。
   - 触发语音提示，并驱动数字人状态切换。

5. **专注过程管理**
   - 屏幕检查：`/api/focus/screen-check`
   - 疲劳检查：`/api/focus/fatigue-check`
   - 若疲劳严重，触发休息询问流程。

6. **结束与休息（Break）**
   - `POST /api/focus/finish`
   - 显示休息倒计时与星空动画，数字人进入休息动作。

---

## 4. 前端架构与交互细节

### 4.1 Electron 主进程（`src/main/main.ts`）
关键特点：

- **无边框 / 透明 / 永远置顶** 的窗口体验。
- **托盘常驻**：关闭按钮不会退出，而是隐藏到托盘。
- **快捷键**：
  - `Ctrl+1` 立即触发屏幕检查
  - `Ctrl+2` 立即触发疲劳检查
  - `Ctrl+3` 强制剩余 10 秒（收尾测试）
- **屏幕捕获**：通过 `desktopCapturer` 获取主屏截图，提供给渲染进程用于专注审计。

### 4.2 Preload 安全桥接（`src/main/preload.ts`）
使用 `contextBridge` 暴露有限 API：

- `window:get-bounds` / `set-bounds` 供 UI 调整窗口尺寸
- `window:minimize` / `window:close`
- `screen:capture` 主进程截图
- `focus:shortcut` IPC 事件监听

**特点**：在 contextIsolation 开启的情况下仍保持安全调用。

### 4.3 渲染层（React + Tailwind + 自定义 CSS）
入口：
`src/renderer/index.tsx` → `App.tsx`

#### 核心 UI 特性
- **固定设计尺寸 + 自适应缩放**
  - UiScaleFrame 用 ResizeObserver 计算缩放比例
  - 保持设计稿比例（985.766 × 554.493）
  - 提供拖拽缩放（边缘 resize handle）

- **玻璃拟态视觉（Glassmorphism）**
  - 多层渐变 + 背景模糊 + 噪点贴图
  - 支持局部 widget 边框光泽

#### 主要视图
| View | 说明 |
| --- | --- |
| Home | 任务输入、语音入口、启动专注 |
| Task | 任务拆解面板 + 聊天时间线 |
| Timer | 番茄钟 / 倒计时设置 |
| Focus | 专注中：屏幕/疲劳检测 |
| Break | 休息中：星空背景、倒计时 |
| Profile | 统计展示（静态 UI 模板） |

#### 数字人状态切换（视频驱动）
通过 `App.tsx` 控制 `<video>` 的播放与循环：

| 状态 | 视频 |
| --- | --- |
| idle | `idle.webm` |
| talk | `talk.webm` |
| focus | `focus.webm` |
| stretch | `Stretch.webm` |

播放逻辑结合：
- 当前视图
- 是否正在播报语音
- 是否在 break 且需要 stretch

#### 时间轮盘（TimeWheelPicker）
自定义滚轮组件：

- 可交互滚动 + 自动吸附
- 支持滚轮滑动阻尼
- 根据 Focus/Timer 模式切换尺寸

#### 语音输入组件（VoiceInput）
统一入口组件：

- 左侧“+”按钮（扩展入口）
- 文字输入框
- 右侧“语音按钮”触发录音

支持被多个视图复用（Home / Task / Focus）。

---

## 5. 后端架构与服务模块

### 5.1 FastAPI 入口（`backend/main.py`）
注册 4 大模块路由：

- `/api/perception` 感知与心流状态
- `/api/interaction` 语音/任务/聊天
- `/api/brain` AI 任务拆解 / 屏幕审计
- `/api/focus` 专注会话管理

### 5.2 核心模块划分

```
backend/
├─ api/         # 路由层
├─ core/        # 核心业务逻辑
├─ services/    # 模型/系统服务封装
├─ assets/      # mock 音频
└─ cache/       # TTS 输出缓存
```

---

## 6. 关键后端功能详解

### 6.1 心流状态机（FlowManager）
文件：`backend/core/flow_manager.py`

状态：

- idle → working → flow → immunity → break

阈值：

- 25 min 进入心流
- 50 min 工作周期进入免打扰
- 5 min 休息
- 3 min 无活动回到 idle

适用场景：
用于“长期专注节奏控制”，偏宏观。

### 6.2 专注会话系统（FocusSessionManager）
文件：`backend/core/focus_session.py`

特点：

- In-memory 会话（单机）
- 记录 task、剩余时间、连续分心/疲劳次数
- 保存对话历史（用于后续生成提示）

用于 Focus 模式的实时对话与监测。

### 6.3 屏幕专注审计（ScreenAgentService）
文件：`backend/services/screen_agent.py`

核心亮点：**双重过滤机制（Double Throttling）**

1. **时间冷却**：10 分钟内重复请求返回缓存结果
2. **视觉防抖**：缩略图比对（64×64）差异低于阈值则跳过 LLM
3. **异常降级**：错误冷却 30 秒，避免高频重试

分类逻辑：

- Focused / Reference / Distracted / Idle
- 若分数 >=60 强制判定为专注
- Reference 强制专注 + 分数修正

### 6.4 在位检测（MediaPipe Pose）
文件：`backend/services/modelscope_vision.py`

流程：

1. 解码 Base64 图片
2. MediaPipe Pose 单帧检测
3. 计算可见度平均值作为置信度

适用于“用户是否在镜头前”的简单判定。

### 6.5 疲劳检测（OpenCV Haar）
文件：`backend/services/fatigue_detector.py`

检测维度：

| 指标 | 说明 |
| --- | --- |
| blink_rate | 每分钟眨眼频率 |
| yawn_count | 打哈欠次数 |
| fatigue_level | 0-100 |

可自动 fallback 到 mock 模式（无摄像头时）。

### 6.6 语音管道（SenseVoice → Qwen → CosyVoice）
文件：`backend/services/voice_pipeline.py`

流程：

1. SenseVoice ASR（上传 OSS → Transcription）
2. 意图路由 / 回复生成（LLM）
3. CosyVoice TTS（含 motion/expression driver）

情绪仲裁规则：

- sad / angry / happy → encouraging
- 其他 → neutral

返回结构中附带：

- `audio.base64`
- `driver.motion_trigger`
- `driver.expression_trigger`
- `timings`（asr / llm / tts / total）

### 6.7 语音驱动协议（Voice & Motion Protocol）
文档：`docs/voice_motion_protocol.md`

亮点：

- Emotion → Instruction → Motion 映射
- motion / expression 可直接映射到前端数字人状态
- 支持 Mock 音频 fallback

### 6.8 任务拆解与意图路由
文件：`backend/services/interaction_service.py`

三层路由：

1. **闪念捕捉**（关键词：`捕捉闪念`）
2. **意图分类**（LLM）
3. **返回结构化 UI Payload**

UI 可直接渲染任务拆解卡片或执行命令。

---

## 7. API 参考（按模块）

### 7.1 Interaction（`/api/interaction`）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /speak | 文本 → TTS + driver |
| POST | /voice | 语音管道（ASR → LLM → TTS） |
| POST | /generate-tasks | 任务拆解 |
| POST | /chat | 聊天 |
| POST | /intent | 意图路由（文本） |
| GET | /audio/{filename} | 获取缓存音频 |
| GET | /encouragement | 心流鼓励语 |

### 7.2 Brain（`/api/brain`）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /decompose | LLM 任务拆解（JSON） |
| POST | /chat | 闲聊 |
| POST | /audit/screen | 屏幕专注审计 |
| GET | /audit/status | 审计状态 |
| POST | /audit/reset | 重置缓存 |

### 7.3 Focus（`/api/focus`）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /prompt | 专注任务提示 |
| POST | /start | 启动专注会话 |
| POST | /screen-check | 屏幕检查 |
| POST | /fatigue-check | 疲劳检查 |
| POST | /fatigue-response | 用户是否接受休息 |
| POST | /finish | 专注结束处理 |

### 7.4 Perception（`/api/perception`）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /analyze/presence | 在位检测 |
| POST | /analyze-screen | 屏幕分析 |
| GET | /fatigue | 疲劳检测 |
| POST | /activity | 活动报告 |
| GET | /flow-state | 当前心流 |
| POST | /update-flow | 状态更新 |
| POST | /force-break | 强制休息 |
| POST | /skip-break | 跳过休息 |

---

## 8. 数据结构与状态管理

### 8.1 Task 面板（前端）
`TaskBoard` 与 `TaskTimeline` 实现“任务 + 历史”双层结构：

- 任务拆解后的 Todo 列表
- 用户/助手对话记录
- 支持“归档旧任务并创建新任务”

### 8.2 Focus 会话（后端）
`FocusSession` 记录：

- 任务内容
- 剩余时间
- 连续分心次数
- 连续疲劳次数
- 最近屏幕 / 疲劳结果
- 对话历史（memory）

### 8.3 闪念存储
前端收到 `command: save_memo` 时，写入 `localStorage`：

```
flowmate.memos = [{ content, created_at }, ...]
```

---

## 9. 技术方案特色总结（亮点）

1. **双重过滤屏幕审计**  
   通过“时间冷却 + 视觉防抖”控制大模型调用频率，兼顾成本与体验。

2. **语音 + 动作驱动一体化协议**  
   语音 TTS 输出同时返回 motion/expression，实现数字人自然联动。

3. **轻量且可降级的多模态架构**  
   所有模块均支持 Mock 模式或 fallback，保证 MVP 可运行。

4. **任务拆解与对话融合**  
   任务拆解与聊天行为统一通过意图路由器处理，UI 能直接渲染结构化 payload。

5. **“低打扰”专注设计**  
   focus session 通过多次连续异常才触发提醒，避免过度打断。

---

## 10. 配置与环境变量

核心配置在 `.env.example`，包括：

- DashScope API Key
- Qwen / CosyVoice / SenseVoice 模型名称
- Mock 模式开关
- OSS 上传配置（SenseVoice 录音识别）

注意：真实 `.env` 不应提交仓库，本说明仅基于 `.env.example`。

---

## 11. 构建、运行与开发命令

来自 `package.json` 与文档说明的主要命令：

### 前端 / Electron
- `npm run dev`：同时启动渲染进程 + 主进程
- `npm run dev:renderer`：仅启动 Vite UI
- `npm run dev:main`：tsc 构建主进程后启动 Electron
- `npm run build`：构建 main + renderer 到 `dist/`

### 后端
- `npm run start:backend`：`uvicorn main:app --reload --port 8000`
- 或 `cd backend && uvicorn main:app --reload --port 8000`

---

## 12. 手动测试与调试工具

仓库根目录提供多个 HTML 测试工具：

- `camera_test.html`  
  测试 `/api/perception/analyze/presence` 在位检测（摄像头）

- `screen_test.html`  
  测试 `/api/brain/audit/screen` 屏幕专注审计

- `voice_test.html`  
  测试 `/api/interaction/speak`（TTS + 动作驱动）

- `voice_single_test.html`  
  单入口语音录制 → `/api/interaction/voice`

- `voice_pipeline_test.html`  
  语音管道完整测试（录音 → ASR → LLM → TTS）

- `voice_all_test.html`  
  一体化测试页面（录音、上传、TTS）

---

## 13. 资产与视觉资源

### 13.1 前端资源
位于 `src/renderer/assets/`：

- `figma/`：设计稿导出图像（背景、UI 装饰、按钮）
- `digits/`：计时轮盘数字贴图
- `star/`：星级与进度图标
- `video_loops/`：数字人动作视频（idle / talk / focus / stretch）
- `noise texture.jpg`：玻璃噪点层

### 13.2 后端资源
位于 `backend/assets/` 与 `backend/cache/`：

- `assets/mock_audio/`：情绪音频 mock 资源
- `cache/audio/`：TTS 缓存音频文件（运行时生成）

---

## 14. Figma 资产本地化脚本

脚本 `scripts/localize-figma-assets.ps1` 的作用是：

1. 从 URL 列表批量下载 Figma 资产
2. 写入 `src/renderer/assets/figma`
3. 自动替换源码中的远程 URL 为本地路径

支持 `-DryRun` 模式以预览替换结果。

---

## 15. 构建输出与分发

构建目录：

- `dist/main/`：Electron 主进程编译产物
- `dist/renderer/`：Vite 打包后的 UI 静态资源

构建后可直接通过 Electron 加载 `dist/renderer/index.html`。

---

## 16. 安全与隐私

- `.env` 中存放敏感密钥（DashScope / OSS 等），应避免泄露。
- 渲染层 CSP 仅允许访问 `http://127.0.0.1:8000`（本地后端）。
- 语音 / 屏幕截图仅在本机处理或发送到 DashScope API（需遵守平台隐私规范）。

---

## 17. 已知限制与可改进方向

### 已知限制
- SenseVoice 录音识别依赖 OSS 配置，若未配置会失败或返回空文本。
- Focus 会话为内存存储，应用重启后不会保留。
- 依赖 DashScope 的功能在无 API Key 时会降级为 mock。
- Screen 审计依赖截图质量，且对页面内容理解存在模型不确定性。

### 可改进建议
- 增加本地持久化（任务历史、心流记录）
- 将任务拆解与语音管道进一步融合（意图驱动 UI 更新）
- 对 ASR 返回结构进行更强健解析
- 引入用户画像与长期专注统计

---

## 18. 总结

FlowMate-Echo 通过 **数字人陪伴 + 多模态感知 + 生成式 AI** 的组合，实现了一个兼具视觉情感与效率导向的心流助手原型。  
其技术设计在“低打扰”与“高可用”之间取得平衡，特别体现在：

- 屏幕审计的双重过滤
- 语音与动作一体化输出
- 任务拆解与专注流程的闭环

这使其不仅具备 MVP 形态下的可运行性，也为后续扩展为完整生产力产品奠定了基础。

---

## 附录 A：技术细节补充

### A.1 CosyVoice TTS 与动作驱动细节

- 入口：`ModelScopeAudio.speak(text, emotion)`
- 输出字段：
  - `audio_data`：Base64 音频
  - `format`：默认 `mp3`
  - `sample_rate`：24000
  - `estimated_duration_ms`：文本长度 * 250ms，封顶 20000ms
  - `motion_trigger` / `expression_trigger` / `subtitle`
- 情绪映射（与 `docs/voice_motion_protocol.md` 对齐）：
  - neutral → idle_breathing / neutral
  - strict → explain / serious
  - encouraging → clapping / smile
  - shush → shush_gesture / worry
- Mock 模式：读取 `backend/assets/mock_audio/{emotion}.mp3`

### A.2 SenseVoice ASR 与 OSS 上传

- `SenseVoiceService.transcribe` 支持多格式输入（wav/mp3/webm/ogg）
- OSSUploader 根据配置生成：
  - 公网 URL 或签名 URL
  - 可选自动清理 OSS 对象
- ASR 结果解析支持：
  - `transcription_url` 二次拉取 JSON
  - `text` / `transcript` / `results` 多种返回结构

### A.3 DashScopeService & AgentBrain

- DashScopeService（同步 SDK）
  - 任务拆解输出严格 3 步 JSON 数组
  - 意图路由：LLM 优先，关键词规则兜底
- AgentBrain（httpx 异步）
  - 任务拆解 / 鼓励语 / Focus 引导 / Chat
  - `FLOWMATE_USE_PRESET=true` 可强制使用预设回复

### A.4 Focus 调度策略（前端 + 后端）

- 前端（`App.tsx`）
  - `scheduleScreenCheck`：专注 8 分钟 / 分心 4 分钟
  - `scheduleFatigueCheck`：每 6 分钟检查
  - `parseRestDecision`：解析“继续 / 休息”语义
- 后端（`backend/api/focus.py`）
  - 连续疲劳 = 1 → ask_rest
  - 连续疲劳 >= 2 → shorten（剩余时间 * 0.35）

### A.5 InteractionResponse 协议（意图路由输出）

```
{
  "type": "command" | "chat" | "breakdown",
  "audio_text": "...",
  "ui_payload": {
    "command": "save_memo",
    "content": "...",
    "display_text": "..."
  }
}
```

breakdown 模式会返回：

```
{
  "content": { "title": "...", "steps": ["...", "...", "..."] },
  "display_text": "已为你生成任务拆解，查看侧边栏"
}
```

### A.6 CSP 与渲染安全策略

`src/renderer/index.html` 中限制：

- `connect-src` 仅允许本地 `127.0.0.1:8000`
- `media-src` 允许 data/blob 以支持音频播放

### A.7 MCP / Figma 配置

- `.vscode/mcp.json` 已配置 Figma MCP 服务
- 用于 Figma 设计资产的代码连接与设计上下文读取

