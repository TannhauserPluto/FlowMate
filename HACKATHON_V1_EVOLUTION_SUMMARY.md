# HACKATHON V1 EVOLUTION SUMMARY

## 1. 项目目标
本项目在黑客松 demo 中要解决的问题是：让用户与虚拟人语音交互时，从“点击麦克风到听到回应”的体验更快、更连贯、且能稳定完成一轮对话。目标体验包括：用户点击麦克风开始说话 → 系统能听懂（ASR）→ 文本能够流式生成（LLM partial_text）→ 尽快开始说话（首段音频更早出现）→ 异常情况下能安全收口，不会卡死。

## 2. 初始架构（优化前）
初始语音链路是“整段录音 + 串行 ASR → LLM → TTS → 一次性返回 → 前端整段播放”。对应代码路径：
- 前端入口：`src/renderer/App.tsx`（`startRecording` / `sendVoiceIntent` / `sendVoiceChat`）
- 后端接口：`backend/api/interaction.py` 的 `POST /api/interaction/voice`
- 主 pipeline：`backend/services/voice_pipeline.py`（`VoicePipelineService.handle`）
- 模型调用：`backend/services/sensevoice_asr.py`（ASR）、`backend/services/interaction_service.py` + `backend/services/dashscope_service.py`（LLM）、`backend/services/modelscope_audio.py`（TTS）
此链路中，录音结束后才上传整段音频，后端串行处理并一次性返回，前端 `playAudioFromBase64` 才开始播放。

## 3. 初始痛点
基于上述实现，初始痛点包括：
- 串行链路导致总耗时长，`voice_pipeline.py` 中 ASR→LLM→TTS 全部串行。
- 首字出现慢，前端必须等待后端完整返回；没有 partial_text。
- 首音频出现慢，TTS 只有在 LLM 完成后才开始。
- 前端无法体现“实时交互感”，缺少流式文本/音频路径。
- 稳定性不足：异常时容易卡住（没有系统性 watchdog / error 收口）。
这些结论可从 `src/renderer/App.tsx` 的 `/api/interaction/voice` 整段流程与 `backend/services/voice_pipeline.py` 的串行实现确认。

## 4. V1 优化目标
V1 不是追求完整产品化，而是做一个可演示、响应更快、链路完整、稳定性足够的 demo。范围内包含：
- 真实 LLM partial_text 流式输出能力
- WebSocket 双向链路骨架
- 语音上行（audio_chunk uplink）与落地的 ASR fallback
- 句子级 incremental TTS（更早首音频）
明确不在 V1 范围：
- 真 streaming ASR / 真 streaming TTS SDK 接入
- 全量业务 UI/状态重构
- task/focus voice 全部迁移到 WS path

## 5. 分阶段优化过程

### 第 1 轮：主链路埋点
- 目标：量化现有 ASR/LLM/TTS 耗时。
- 改动点：`backend/services/voice_pipeline.py` 记录 `asr_start`/`llm_start`/`tts_start`/`response_build_done` 等；`backend/api/interaction.py` 在 `/api/interaction/voice` 加 timings。
- 文件：`backend/services/voice_pipeline.py`、`backend/api/interaction.py`、`src/renderer/App.tsx`（日志输出）。
- 效果：可定位瓶颈阶段。
- 局限：仍是串行主链路。

### 第 2 轮：LLM 文本流式（SSE）
- 目标：先让文本“先出来”。
- 改动点：新增 `POST /api/interaction/chat-stream`，`StreamingResponse` + SSE。
- 文件：`backend/api/interaction.py`（`chat_stream`）、`backend/services/interaction_service.py`（`stream_chat_reply`）、`backend/services/dashscope_service.py`（`stream_chat`）、`src/renderer/App.tsx`（`window.__flowmateChatStreamTest`）。
- 效果：文本可流式显示。
- 局限：仅文本测试链路，未接语音。

### 第 3 轮：chunked TTS 测试链路
- 目标：验证按句切分 + 逐段 TTS。
- 改动点：新增 `POST /api/interaction/speak-chunks`；`_split_text_into_sentences`；`modelscope_audio.speak_chunks`。
- 文件：`backend/api/interaction.py`、`backend/services/modelscope_audio.py`、`src/renderer/App.tsx`（`window.__flowmateSpeakChunksTest`）。
- 效果：前端可顺序播放多段音频。
- 局限：仍是单次 HTTP 调用。

### 第 4 轮：WebSocket 双向骨架
- 目标：建立可扩展的 WS 通道。
- 改动点：新增 `/api/interaction/ws`，支持 `start_turn`/`audio_chunk`/`end_audio`/`cancel_turn` 及 ack/done/error。
- 文件：`backend/api/interaction.py`、`src/renderer/App.tsx`（`window.__flowmateWsTest`）。
- 效果：可验证双向协议。
- 局限：无真实 ASR/TTS。

### 第 5 轮：真实 LLM partial_text 接入 WS
- 目标：WS 下行 partial_text 使用真实 LLM。
- 改动点：WS handler 复用 `stream_chat_reply`。
- 文件：`backend/api/interaction.py`。
- 效果：WS path 可流式输出 LLM 文本。
- 局限：仍无真实 audio 上行。

### 第 6 轮：真实 audio_chunk 上行
- 目标：前端真实录音分片上行，后端缓冲。
- 改动点：`window.__flowmateWsAudioTest`，MediaRecorder 分片；后端缓存 per turn。
- 文件：`src/renderer/App.tsx`、`backend/api/interaction.py`。
- 效果：WS audio uplink 打通。
- 局限：ASR 仍为 mock。

### 第 7 轮：ASR fallback adapter
- 目标：将 audio_chunk 汇总后走非流式 ASR，返回真实文本。
- 改动点：新增 `backend/services/streaming_asr_adapter.py`（fallback）；`interaction_ws` 在 `end_audio` 调用 `finalize`。
- 文件：`backend/services/streaming_asr_adapter.py`、`backend/api/interaction.py`。
- 效果：`partial_asr` 来自真实 ASR（非 streaming）。
- 局限：仍是 end_audio 才识别。

### 第 8 轮：audio -> ASR fallback -> LLM streaming
- 目标：ASR 文本自动触发 LLM partial_text。
- 改动点：`end_audio` 后用 ASR 文本调用 `stream_chat_reply`。
- 文件：`backend/api/interaction.py`、`src/renderer/App.tsx`（日志与显示）。
- 效果：完成“语音→LLM”链路。
- 局限：还没有音频输出。

### 第 9 轮：WS audio path 接入 chunked TTS
- 目标：在 LLM 完成后做 chunked TTS，输出音频。
- 改动点：WS audio path 复用 `audio_service.speak_chunks` 发送 `audio_chunk` 下行。
- 文件：`backend/api/interaction.py`、`src/renderer/App.tsx`。
- 效果：完整闭环可听到音频。
- 局限：首段音频仍偏晚（等待 LLM 完成）。

### 第 10 轮：sentence-buffered incremental TTS（更早首音频）
- 目标：LLM 流中按句触发 TTS。
- 改动点：`interaction_ws` 内 sentence buffer + TTS worker，句子完成就推 `audio_chunk`。
- 文件：`backend/api/interaction.py`。
- 效果：首段音频更早出现。
- 局限：仍非底层真 streaming TTS。

### 第 11 轮：正式首页主麦克风接入 WS audio path
- 目标：首页主麦克风走 WS audio path。
- 改动点：`handleHomeAudioClick` 改为调用 WS audio path；保留旧 `/api/interaction/voice` fallback。
- 文件：`src/renderer/App.tsx`。
- 效果：无需调试 hook 即可演示完整链路。
- 局限：task/focus voice 仍旧逻辑。

### 第 12 轮：稳定性收口与 fallback
- 目标：避免 listening/thinking/speaking 卡死。
- 改动点：增加 watchdog、WS 断开处理、ASR 空文本提示、playback error 收口。
- 文件：`src/renderer/App.tsx`。
- 效果：黑客松级稳定性提升。
- 局限：复杂异常仍是简单处理。

## 6. 当前 V1 最终链路
一句话描述：**首页主麦克风 → WS audio uplink → ASR fallback → LLM partial_text → sentence-buffered incremental TTS → WS audio_chunk 下行 → 顺序播放**。

分步骤说明：
1. 首页主麦克风点击触发 `handleHomeAudioClick`（`src/renderer/App.tsx`），启动 WS audio path。
2. 前端 MediaRecorder 分片（`audio/webm` + base64）通过 `/api/interaction/ws` 发送 `audio_chunk`。
3. 后端 `interaction_ws` 聚合音频并调用 `StreamingAsrAdapter.finalize`（`backend/services/streaming_asr_adapter.py`）进行 ASR fallback。
4. 得到 ASR 文本后，`stream_chat_reply` 流式生成 `partial_text`。
5. LLM 流过程中 sentence buffer 触发 `audio_service.speak_chunks`，逐句 TTS，发送 `audio_chunk`。
6. 前端按 seq 缓存并顺序播放，更新 `chatAssistantText`/`homeChatBubble` 和 speaking 状态。

路径区分：
- **正式 demo 主路径**：首页主麦克风（`handleHomeAudioClick` → WS audio path）。
- **测试路径**：`window.__flowmateWsAudioTest`、`window.__flowmateWsTest`、`window.__flowmateChatStreamTest`、`window.__flowmateSpeakChunksTest`。
- **旧 fallback 路径**：`/api/interaction/voice`（`sendVoiceIntent`/`sendVoiceChat`）。
- task/focus voice 仍走旧逻辑（未迁移）。

## 7. 当前关键接口与消息流
### HTTP 接口
- `POST /api/interaction/voice`：旧主链路（整段上传 → 串行 ASR/LLM/TTS），仍保留为 fallback。
- `POST /api/interaction/chat-stream`：SSE 文本流式测试链路。
- `POST /api/interaction/speak-chunks`：chunked TTS 测试链路。
- `POST /api/interaction/speak`：单次 TTS 语音合成（旧路径依赖）。

### WebSocket
`/api/interaction/ws`：V1 实验主链路（audio path）和 text path。

WS 消息 schema（可从 `backend/api/interaction.py` 确认）：
- Client → Server：
  - `start_turn`（含 `mode: "audio"|"text"`, `text`, `turn_id`）
  - `audio_chunk`（base64, `seq`, `mime_type`）
  - `end_audio`
  - `cancel_turn`
- Server → Client：
  - `ack`
  - `partial_asr`（ASR fallback，`source: "asr_fallback"`）
  - `partial_text`（LLM streaming）
  - `audio_chunk`（TTS chunked，`source: "tts_chunked"`）
  - `done`
  - `error`

用途与现状：
- `/api/interaction/ws` 是 V1 demo 主路径。
- `/api/interaction/chat-stream`、`/api/interaction/speak-chunks` 是演进过程中的测试路径，仍保留。

## 8. 当前关键文件与职责
（标注是否属于正式 demo 主链）
- `src/renderer/App.tsx`：前端核心 UI + 录音 + WS audio path + fallback（**主链**）。
- `backend/api/interaction.py`：WS/voice/chat-stream/speak-chunks 等接口（**主链**）。
- `backend/services/voice_pipeline.py`：旧串行 voice pipeline（**fallback**）。
- `backend/services/interaction_service.py`：LLM 路由与 `stream_chat_reply`（**主链**）。
- `backend/services/dashscope_service.py`：LLM 调用与流式输出（**主链**）。
- `backend/services/modelscope_audio.py`：TTS 与 `speak_chunks`（**主链**）。
- `backend/services/streaming_asr_adapter.py`：WS 音频 fallback ASR（**主链**）。
- `backend/services/sensevoice_asr.py`：非流式 ASR 具体实现（**主链**，但非 streaming）。

## 9. 当前 V1 已达成能力
- 首页主麦克风已接入 WS audio path（`handleHomeAudioClick`）。
- 语音可上行并触发 ASR fallback，输出 `partial_asr`。
- LLM 可流式生成 `partial_text` 并实时展示。
- TTS 按句输出 `audio_chunk`，顺序播放。
- 首段音频出现明显提前（incremental TTS）。
- 异常可 fallback 或重置（watchdog + error 收口）。

## 10. 当前 V1 仍然存在的限制
- ASR 仍为 fallback（`end_audio` 后整段识别），非真 streaming ASR。
- TTS 不是底层 streaming SDK，仅 sentence-buffered incremental。
- task/focus voice 仍走旧 `/api/interaction/voice`。
- audio/webm 与 ASR 兼容性仍有风险（是否原生支持未确认）。
- 测试入口（debug hooks）与正式入口并存。
- 异常处理仍是黑客松级别（watchdog/重置为主）。

## 11. 为什么这个版本已经足够作为黑客松 Demo
从演示角度看，V1 已具备完整闭环且体验提升明显：
- 用户点击麦克风即可完整演示“听懂 → 生成 → 说话”。
- partial_text 与更早首段音频体现“实时交互感”。
- 与原始串行主链路相比，体验提升直观。
- 以“完整闭环 + 体验优化 + 稳定性收口”为优先级是合理取舍。

## 12. 版本二建议方向
务实改进方向（不展开实现细节）：
- 真 streaming ASR（替换 `StreamingAsrAdapter.finalize`）
- 真 streaming TTS（替换 `stream_llm_sequence` 内的 TTS worker）
- task/focus voice 统一接入 WS path
- barge-in 打断与中途取消
- 音频格式/转码链路稳定化
- 旧主链路与新 WS 链路逐步融合

## 13. 一页式总结
- 一句话概括项目：FlowMate 通过虚拟人语音交互帮助用户进入心流、完成任务拆解与专注。
- 一句话概括 V1 核心改进：从“整段上传、整段播放”升级为“WS 双向、LLM 流式、句子级增量 TTS”。
- 一句话概括最终链路：首页主麦克风 → WS audio uplink → ASR fallback → LLM partial_text → sentence-buffered TTS → audio_chunk 回放。
- 一句话概括后续方向：引入真 streaming ASR/TTS 并统一语音路径。

## Appendix: Demo Talk Track

### 1) 90 秒版本讲解稿
我们做了一个虚拟人语音交互的 FlowMate。最初链路是整段录音上传、后端串行 ASR→LLM→TTS、一次性返回，首字和首音频都很慢。黑客松 V1 重点是把体验做“更快、更连续、可展示”。我们先做了 LLM 文本流式（SSE），然后引入 WebSocket 双向骨架，打通 audio_chunk 上行，加入 ASR fallback，再把 LLM partial_text 接入 WS。接着把 TTS 做成按句切分，并在 LLM 流中“句子一成就立刻 TTS”，首段音频明显提前。现在首页主麦克风直接走 WS 音频链路，异常也有 watchdog 和 fallback。V1 已经能展示完整闭环和实时感，后续再升级到真 streaming ASR/TTS。

### 2) 3 分钟版本讲解提纲
1. 问题背景：初始语音链路慢、无实时感（`/api/interaction/voice` 串行）。
2. 优化目标：不是产品化，而是 demo 可演示、响应更快、链路完整。
3. 分阶段演进：
   - 埋点定位瓶颈（`voice_pipeline.py`）
   - SSE 文本流式（`/api/interaction/chat-stream`）
   - chunked TTS 测试（`/api/interaction/speak-chunks`）
   - WS 双向骨架（`/api/interaction/ws`）
   - LLM partial_text 接入 WS
   - audio_chunk uplink + ASR fallback（`streaming_asr_adapter.py`）
   - LLM 流 + sentence-buffered TTS
4. 当前链路与体验：首页主麦克风 → WS audio → ASR fallback → LLM 流 → 增量 TTS → 音频播放。
5. 稳定性收口：watchdog、异常回退、UI 状态复位。
6. 版本二方向：真 streaming ASR/TTS、统一任务路径。

### 3) 评委可能会问的 5 个技术问题
1. Q：为什么不用真 streaming ASR/TTS？
   A：黑客松 V1 以“完整闭环 + 可演示 + 稳定性”为优先级，先用 fallback 方案验证链路与体验，后续可替换为真 streaming。
2. Q：现在的 ASR 是实时的吗？
   A：不是，当前是 end_audio 后调用非流式 ASR（`StreamingAsrAdapter.finalize`），在文档中明确标注为 fallback。
3. Q：首段音频为什么会更早？
   A：LLM 流中按句缓冲，一旦成句就触发 TTS，而不是等完整 LLM 结束。
4. Q：如何避免卡死？
   A：前端 `App.tsx` 增加 watchdog 和 error 收口，WS 断开/播放失败都会复位状态并可 fallback。
5. Q：如何与旧链路共存？
   A：`/api/interaction/voice` 仍保留，主麦克风优先走 WS，失败时 fallback 到旧链路。
