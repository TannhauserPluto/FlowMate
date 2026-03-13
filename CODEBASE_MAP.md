# CODEBASE MAP

## 1. Project Overview
- FlowMate-Echo is an Electron + React desktop app backed by a FastAPI service for voice-driven task breakdown, focus mode, and a pre-rendered avatar experience.
- The frontend (`src/renderer`) renders the main UI (home/task/focus/break/profile) and a mini window, manages UI state, and orchestrates audio recording and playback.
- The Electron main process (`src/main`) owns window creation, tray/shortcut behaviors, and screen capture for focus auditing.
- The backend (`backend`) exposes REST APIs for interaction (intent routing, voice pipeline, TTS), focus session orchestration, and perception utilities.
- Model services integrate DashScope Qwen (LLM), SenseVoice (ASR), and CosyVoice (TTS), with mock modes for development.
- Audio processing is split: recording + playback in the renderer; ASR/TTS + audio caching in the backend.
- The “virtual avatar” is not a live 3D model; it is a set of looping videos (idle/talk/focus/stretch) switched by UI state and audio playback.
- A typical user interaction is: text/voice input -> backend intent/voice pipeline -> response text + audio -> renderer playback + UI updates.
- Focus mode adds periodic screen checks and fatigue checks; responses can trigger speech and UI prompts.

## 2. Repository Structure
- `src/main/main.ts`: Electron app entry; creates main/mini windows, tray, shortcuts, and IPC handlers.
- `src/main/preload.ts`: Exposes `window.electron` IPC bridge (`invoke`, `on`, `getDesktopSourceId`).
- `src/main/ipc.ts`: Empty placeholder file (no logic).
- `src/renderer/index.tsx`: React entry; selects `App` vs `MiniApp` based on `?mini=1`.
- `src/renderer/index.html`: Vite HTML entry with CSP and font links.
- `src/renderer/App.tsx`: Main UI, voice handling, focus logic, avatar playback, and API calls.
- `src/renderer/MiniApp.tsx`: Mini window UI, drag/resize logic, and local storage sync.
- `src/renderer/components/UiScaleFrame.tsx`: Main window scaling + custom resize overlay.
- `src/renderer/components/VoiceInput.tsx`: Text input + mic button UI.
- `src/renderer/components/ActionFloatingBtn.tsx`: Floating control buttons (home/focus/break).
- `src/renderer/components/TimeWheelPicker.tsx`: Custom wheel UI for timer selection.
- `src/renderer/lib/storage.ts`: LocalStorage schema for todos/memos and parsing helpers.
- `src/renderer/styles/index.css`: Primary UI styling and glassmorphism.
- `backend/main.py`: FastAPI entry; router registration and CORS.
- `backend/config.py`: Environment loading and settings (model keys, ports, timeouts).
- `backend/api/interaction.py`: Interaction endpoints (voice, speak, intent, tasks).
- `backend/api/focus.py`: Focus session endpoints.
- `backend/api/perception.py`: Presence/screen/fatigue/flow endpoints.
- `backend/api/brain.py`: LLM chat/decompose + screen audit endpoints.
- `backend/core/agent_brain.py`: Async LLM client and high-level task/focus logic.
- `backend/core/flow_manager.py`: Flow state machine (idle/working/flow/break).
- `backend/core/focus_session.py`: In-memory focus session store.
- `backend/core/prompt_templates.py`: Prompt templates and presets.
- `backend/services/voice_pipeline.py`: ASR -> intent -> TTS pipeline.
- `backend/services/interaction_service.py`: Intent routing and UI payload construction.
- `backend/services/dashscope_service.py`: Qwen-Max sync client for intent/chat/task.
- `backend/services/modelscope_audio.py`: CosyVoice TTS + motion/expression driver.
- `backend/services/sensevoice_asr.py`: SenseVoice ASR with OSS upload.
- `backend/services/screen_agent.py`: Screen audit + caching + VLM call.
- `backend/services/modelscope_vision.py`: Presence detection + Qwen-VL screen analysis.
- `backend/services/fatigue_detector.py`: OpenCV-based fatigue estimation.
- `backend/services/oss_uploader.py`: OSS upload helper for ASR.
- `backend/assets/mock_audio/*`: Mock audio files (currently zero-length files).
- `docs/voice_motion_protocol.md`: Voice + motion driver protocol SSOT.
- `scripts/localize-figma-assets.ps1`: Figma asset download + replacement script.
- `package.json`, `vite.config.ts`, `tsconfig*.json`, `requirements.txt`, `.env.example`: Build and runtime configuration.

## 3. Runtime Entry Points
- Electron main process: `src/main/main.ts`
  - `app.whenReady()` -> `createWindow()` + `createMiniWindow()` + `createTray()`.
  - `ipcMain.handle('screen:capture')` returns a data URL via `desktopCapturer`.
  - Global shortcuts `CommandOrControl+1/2/3` send `focus:shortcut` events.
- Preload bridge: `src/main/preload.ts`
  - Exposes `window.electron.invoke()` for IPC (`window:*`, `mini-window:*`, `screen:capture`).
  - Exposes `window.electron.on('focus:shortcut', ...)`.
- Frontend entry: `src/renderer/index.tsx`
  - Chooses `App` or `MiniApp` based on query `?mini=1`.
- Backend entry: `backend/main.py`
  - `app.include_router()` registers `/api/interaction`, `/api/focus`, `/api/brain`, `/api/perception`.
- Avatar rendering/loop switching:
  - `src/renderer/App.tsx` `avatarVideoRef` + `useEffect` that calls `playAvatar(...)` with `vidIdle`, `vidTalk`, `vidFocus`, `vidStretch`.
- Audio recording entry:
  - `src/renderer/App.tsx` `startRecording()` (MediaRecorder).
- LLM/ASR/TTS service entry points:
  - `backend/services/voice_pipeline.py: VoicePipelineService.handle()`
  - `backend/services/sensevoice_asr.py: SenseVoiceService.transcribe()`
  - `backend/services/dashscope_service.py: DashScopeService._call_qwen()`
  - `backend/services/modelscope_audio.py: ModelScopeAudio.speak()`

## 4. Frontend Architecture
- Main UI root: `src/renderer/App.tsx`
  - Layout: `UiScaleFrame` -> `.window` with left pane (avatar + timer) and right pane (chat/task).
  - Views: `currentView` in `('home'|'task'|'timer'|'focus'|'break'|'profile')` with derived flags (`isTaskRunning`, `isFocusView`, `isBreakView`, etc.).
- Mini window: `src/renderer/MiniApp.tsx`
  - Renders stacked Todo and Memo cards (`MiniTodoCard`, `MiniMemoCard`).
  - Manages drag and resize by IPC calls to `mini-window:get-bounds` / `mini-window:set-bounds`.
  - Uses `ResizeObserver` to update `--mini-scale`.
  - Syncs todos and memos via LocalStorage keys `flowmate.todoState` and `flowmate.memos`.
- Voice input UI:
  - `src/renderer/components/VoiceInput.tsx` emits `onAudioClick` and `onSubmit`.
  - `App.tsx` handles `handleHomeAudioClick`, `handleTaskAudioClick`, `handleFocusAudioClick`.
- Audio recording & upload:
  - `startRecording(handler)` -> `navigator.mediaDevices.getUserMedia` -> `MediaRecorder`.
  - `recorder.onstop` -> `Blob` -> handler (`sendVoiceIntent`, `sendVoiceChat`, `sendFocusVoice`).
- API calls (no dedicated client module):
  - `App.tsx` uses `fetch` with `API_BASE` (`VITE_API_BASE`).
  - Endpoints used: `/interaction/encouragement`, `/interaction/intent`, `/interaction/voice`, `/interaction/speak`, `/interaction/chat`, `/interaction/generate-tasks`, `/focus/*`, `/brain/audit/reset`.
- Text bubble rendering:
  - `homeChatBubble`, `speechBubbleText` with `wrapTextByWidth()` (canvas measure) in `App.tsx`.
- Audio playback:
  - `ensureAudioPlayer()` creates a single `HTMLAudioElement` and binds `play/ended/pause/error` to `isAvatarSpeaking`.
  - `playAudioFromBase64()` -> data URL; `playAudioFromUrl()` handles `/api` paths.
- Avatar motion driver:
  - Backend returns `driver` with motion/expression, but frontend only uses `isAvatarSpeaking` to switch videos (no driver parsing found).
- State management:
  - React `useState`/`useRef`; no external store.
  - `thinkingCountRef` gates `isThinking` for concurrent async operations.
  - LocalStorage sync in `App.tsx` and `MiniApp.tsx` via `storage` events.
- Animation:
  - `animateList()` in `App.tsx` uses Web Animations API for Todo list transitions.

## 5. Backend Architecture
- Entry: `backend/main.py` (FastAPI app + CORS).
- Routing:
  - `backend/api/interaction.py` -> intent/chat/tasks/voice/tts endpoints.
  - `backend/api/focus.py` -> focus session orchestration.
  - `backend/api/perception.py` -> presence/fatigue/flow utilities.
  - `backend/api/brain.py` -> decompose/chat and screen audit utilities.
- Voice pipeline:
  - `interaction.py /voice` -> `services/voice_pipeline.py: VoicePipelineService.handle()`
    - `SenseVoiceService.transcribe()` -> ASR
    - `process_user_intent()` -> LLM intent routing
    - `ModelScopeAudio.speak()` -> TTS + driver
- Intent routing:
  - `services/interaction_service.py: process_user_intent()`
    - FLASH keyword routing -> command payload
    - `dashscope_service.classify_intent()` -> `chat` vs `breakdown`
    - `dashscope_service.decompose_task()` + `summarize_breakdown()` for breakdown
    - `dashscope_service.generate_reply_from_asr()` for chat
- Focus flow:
  - `api/focus.py: focus_start()` -> `focus_session_manager.create_session()` -> `agent_brain.generate_focus_message()` -> `audio_service.speak()`.
  - `api/focus.py: screen_check()` -> `screen_agent.audit_screen()` -> conditional TTS.
  - `api/focus.py: fatigue_check()` -> `fatigue_detector.detect()` -> optional TTS.
  - Session state lives in `backend/core/focus_session.py` (in-memory).
- Perception flow:
  - Presence: `services/modelscope_vision.py: VisionService.detect_presence_from_base64()`
  - Screen analysis: `services/modelscope_vision.py: ModelScopeVision.analyze_screen()`
  - Fatigue: `services/fatigue_detector.py: FatigueDetector.detect()`
  - Flow state: `core/flow_manager.py: FlowManager.update()`
- Data storage:
  - Audio cache directory is `backend/cache/audio` (created in `config.py`).
  - Focus sessions and flow state are in-memory only.

## 6. End-to-End Voice Interaction Flow
1. User clicks mic in `VoiceInput` -> `App.tsx` calls `handleHomeAudioClick` / `handleTaskAudioClick` / `handleFocusAudioClick`.
2. `startRecording(handler)` requests `navigator.mediaDevices.getUserMedia({ audio: true })` and creates `MediaRecorder`.
3. On stop (`recorder.onstop`), a `Blob` is created and passed to:
   - `sendVoiceIntent` (home), `sendVoiceChat` (task), or `sendFocusVoice` (focus).
4. Each sender builds `FormData` with `audio` and `fetch`es `POST ${API_BASE}/interaction/voice`.
5. Backend `backend/api/interaction.py: voice_chat()` reads the upload and calls `voice_pipeline_service.handle()`.
6. `voice_pipeline.py` executes **serially**:
   - ASR: `sensevoice_asr.SenseVoiceService.transcribe()` (may upload to OSS + wait for DashScope transcription).
   - LLM: `interaction_service.process_user_intent()` (intent classification + response generation).
   - TTS: `modelscope_audio.ModelScopeAudio.speak()` (CosyVoice).
7. The response includes:
   - `data.interaction` (type + audio_text + ui_payload),
   - `data.audio` (base64, format, sample_rate),
   - `data.driver` (motion/expression triggers).
8. Renderer `sendVoiceIntent`/`sendVoiceChat`:
   - `applyInteraction()` updates UI, writes memos to LocalStorage if `command/save_memo`.
   - `playAudioFromBase64()` creates a data URL and plays via `HTMLAudioElement`.
9. Audio playback events toggle `isAvatarSpeaking`, which drives the avatar video loop selection.

## 7. API Inventory
### /api/interaction (backend/api/interaction.py)
- POST `/api/interaction/generate-tasks`
  - Handler: `generate_tasks`
  - Request: `{ task_description: string }`
  - Response: `{ tasks: string[], original_description: string, topic?: string }`
  - Caller: `src/renderer/App.tsx` (`generateTasks`)
  - Voice/Avatar: Indirect (task breakdown only)
- POST `/api/interaction/get-response`
  - Handler: `get_ai_response`
  - Request: `{ flow_state: string, work_duration: number, fatigue_level: number }`
  - Response: `{ action: string, content: string, audio_url?: string }`
  - Caller: Not found in renderer
  - Voice/Avatar: Optional (audio_url)
- POST `/api/interaction/synthesize-speech` (deprecated)
  - Handler: `synthesize_speech`
  - Request: `{ text: string, voice?: string }`
  - Response: `{ audio_url: string, text: string }`
  - Caller: Not found in renderer
  - Voice/Avatar: TTS only
- POST `/api/interaction/speak`
  - Handler: `speak`
  - Request: `{ text: string, emotion: 'strict'|'encouraging'|'neutral'|'shush' }`
  - Response: `{ status, data: { audio, driver } }` (base64 audio + motion/expression)
  - Caller: `src/renderer/App.tsx` (`speakText`, fallback in chat)
  - Voice/Avatar: Yes (TTS + driver)
- POST `/api/interaction/voice`
  - Handler: `voice_chat`
  - Request: `multipart/form-data` with `audio` (UploadFile), optional `context`
  - Response: `{ status, data: { user, assistant, interaction, audio, driver }, timings }`
  - Caller: `src/renderer/App.tsx` (`sendVoiceIntent`, `sendVoiceChat`, `sendFocusVoice`)
  - Voice/Avatar: Yes (ASR + LLM + TTS + driver)
- POST `/api/interaction/chat`
  - Handler: `chat`
  - Request: `{ message: string, context?: string }`
  - Response: `{ reply: string, audio_url?: string }`
  - Caller: `src/renderer/App.tsx` (`sendChatMessage`)
  - Voice/Avatar: Optional (audio_url)
- POST `/api/interaction/intent`
  - Handler: `intent`
  - Request: `{ text: string, emotion?: string }`
  - Response: `InteractionResponse` (`type`, `audio_text`, `ui_payload`)
  - Caller: `src/renderer/App.tsx` (`sendTextIntent`, `requestIntent`)
  - Voice/Avatar: Indirect (text only)
- GET `/api/interaction/audio/{filename}`
  - Handler: `get_audio`
  - Response: audio file from cache (`audio/mpeg`)
  - Caller: `playAudioFromUrl()` when `audio_url` returned
  - Voice/Avatar: TTS playback
- GET `/api/interaction/encouragement`
  - Handler: `get_encouragement`
  - Response: `{ state, encouragement, work_minutes }`
  - Caller: `src/renderer/App.tsx` (initial fetch)
  - Voice/Avatar: Text only

### /api/focus (backend/api/focus.py)
- POST `/api/focus/prompt`
  - Handler: `focus_prompt`
  - Request: none
  - Response: `{ prompt, audio?: { base64, format } }`
  - Caller: `App.tsx` (`requestFocusPrompt`)
  - Voice/Avatar: Yes (TTS)
- POST `/api/focus/start`
  - Handler: `focus_start`
  - Request: `{ task_text: string, duration_seconds: number }`
  - Response: `{ session_id, reply, audio?: { base64, format } }`
  - Caller: `App.tsx` (`startFocusSession`)
  - Voice/Avatar: Yes (TTS)
- POST `/api/focus/screen-check`
  - Handler: `screen_check`
  - Request: `{ session_id: string, image: base64, task_text?: string }`
  - Response: `{ is_focused, score, analysis, suggestion, next_interval_seconds, consecutive_distract, reply?, audio? }`
  - Caller: `App.tsx` (`scheduleScreenCheck`)
  - Voice/Avatar: Optional (TTS on distract)
- POST `/api/focus/fatigue-check`
  - Handler: `fatigue_check`
  - Request: `{ session_id: string, remaining_seconds: number }`
  - Response: `{ fatigue_level, action, reply?, audio?, new_remaining_seconds?, consecutive_fatigue }`
  - Caller: `App.tsx` (`scheduleFatigueCheck`)
  - Voice/Avatar: Optional (TTS)
- POST `/api/focus/fatigue-response`
  - Handler: `fatigue_response`
  - Request: `{ session_id: string, accept_rest: boolean, user_text?: string }`
  - Response: `{ action, reply, audio }`
  - Caller: `App.tsx` (`handleFocusUserText`)
  - Voice/Avatar: Yes (TTS)
- POST `/api/focus/finish`
  - Handler: `finish_focus`
  - Request: `{ session_id: string }`
  - Response: `{ start_positive_timer: boolean }`
  - Caller: `App.tsx` (timer completion; response unused)
  - Voice/Avatar: No

### /api/brain (backend/api/brain.py)
- POST `/api/brain/decompose`
  - Handler: `decompose_task`
  - Request: `{ task: string }`
  - Response: `string[]` (steps)
  - Caller: Not found in renderer
- POST `/api/brain/chat`
  - Handler: `chat`
  - Request: `{ message: string, history?: [{ user, assistant }] }`
  - Response: `{ reply, emotion }`
  - Caller: Not found in renderer
- POST `/api/brain/audit/screen`
  - Handler: `audit_screen`
  - Request: `{ image: base64, current_task: string }`
  - Response: `{ is_focused, score, analysis, suggestion, source?, cooldown_remaining?, visual_diff?, error? }`
  - Caller: Not found in renderer
- GET `/api/brain/audit/status`
  - Handler: `get_audit_status`
  - Response: `screen_agent.get_status()`
  - Caller: Not found in renderer
- POST `/api/brain/audit/reset`
  - Handler: `reset_audit_cache`
  - Response: `{ message, status }`
  - Caller: `App.tsx` (`handleStartFocus`)

### /api/perception (backend/api/perception.py)
- POST `/api/perception/analyze/presence`
  - Handler: `analyze_presence`
  - Request: `{ image: base64 }`
  - Response: `{ presence, confidence, landmarks_count, debug_info, latency_ms }`
  - Caller: Not found in renderer
- POST `/api/perception/analyze-screen`
  - Handler: `analyze_screen`
  - Request: `{ image: base64 }`
  - Response: `{ app, is_working, distraction, focus_score, raw_analysis? }`
  - Caller: Not found in renderer
- GET `/api/perception/fatigue`
  - Handler: `get_fatigue`
  - Request: none
  - Response: `{ fatigue_level, blink_rate, yawn_count, recommendation }`
  - Caller: Not found in renderer
- POST `/api/perception/activity`
  - Handler: `report_activity`
  - Request: `{ is_active: boolean, key_count: number }`
  - Response: `{ state, message }`
  - Caller: Not found in renderer
- GET `/api/perception/flow-state`
  - Handler: `get_flow_state`
  - Response: `{ state, work_duration, break_duration, flow_count }`
  - Caller: Not found in renderer
- POST `/api/perception/update-flow`
  - Handler: `update_flow_state`
  - Response: `flow_manager.update()` output
  - Caller: Not found in renderer
- POST `/api/perception/force-break`
  - Handler: `force_break`
  - Response: `{ message, state }`
  - Caller: Not found in renderer
- POST `/api/perception/skip-break`
  - Handler: `skip_break`
  - Response: `{ message, state }`
  - Caller: Not found in renderer

## 8. Model Service Integration
- ASR (SenseVoice)
  - File: `backend/services/sensevoice_asr.py`
  - Entry: `SenseVoiceService.transcribe(audio_bytes, filename, content_type)`
  - Input: raw audio bytes from `/interaction/voice`
  - Output: `{ status, text, emotion, error? }`
  - Async: yes (async + `run_in_executor`), non-streaming
  - Usage: `VoicePipelineService.handle()`
  - Limits: requires OSS config; mock mode returns empty text.
- LLM (Qwen-Max)
  - File: `backend/services/dashscope_service.py` and `backend/core/agent_brain.py`
  - Entry: `DashScopeService._call_qwen()` (sync), `AgentBrain._call_qwen()` (async)
  - Input: prompt messages
  - Output: string reply/JSON-like content
  - Async: dashscope calls are sync; used via executor in `interaction_service`
  - Usage: intent classification, task breakdown, chat replies, focus prompts
  - Limits: no streaming; errors mostly logged and fallback replies used.
- TTS / Audio generation (CosyVoice)
  - File: `backend/services/modelscope_audio.py`
  - Entry: `ModelScopeAudio.speak(text, emotion)`
  - Output: `{ status, audio_data (base64), format, sample_rate, estimated_duration_ms, motion_trigger, expression_trigger }`
  - Async: yes (awaited); non-streaming
  - Usage: `/interaction/speak`, `/interaction/chat`, `/focus/*`, `voice_pipeline`
  - Limits: mock audio files are zero bytes; fallback to mock or error.
- Emotion recognition
  - File: `backend/services/sensevoice_asr.py` (`_extract_emotion`)
  - File: `backend/services/dashscope_service.py` (`_detect_emotion` for chat)
  - Usage: Voice pipeline maps emotion to TTS tone via `_map_emotion()`.
- Motion/Expression control
  - File: `backend/services/modelscope_audio.py` (`EMOTION_CONFIG`)
  - Output: `driver.motion_trigger`, `driver.expression_trigger`
  - Frontend usage: not found; renderer only reacts to audio playback.

## 9. Data Contracts
- Audio upload (frontend -> backend)
  - `FormData` with `audio` (Blob, filename `voice.webm`) in `sendVoiceIntent`, `sendVoiceChat`, `sendFocusVoice`.
- Interaction response (backend -> frontend)
  - `InteractionResponse` in `backend/services/interaction_service.py`:
    - `{ type: 'command'|'chat'|'breakdown', audio_text: string, ui_payload?: CommandPayload|BreakdownPayload }`
    - `CommandPayload`: `{ command: 'save_memo', content: string, display_text: string }`
    - `BreakdownPayload`: `{ content: { title: string, steps: string[] }, display_text: string }`
- Voice pipeline response (`/api/interaction/voice`)
  - `{ status, data: { user, assistant, interaction, audio, driver }, timings, error? }`
  - `audio`: `{ base64, format, sample_rate, estimated_duration_ms }`
  - `driver`: `{ motion_trigger, expression_trigger, subtitle }`
- Speak response (`/api/interaction/speak`)
  - `{ status, data: { audio, driver }, error? }`
- Focus session response
  - `FocusStartResponse`: `{ session_id, reply, audio? }`
  - `ScreenCheckResponse`: `{ is_focused, score, analysis, suggestion, next_interval_seconds, consecutive_distract, reply?, audio? }`
  - `FatigueCheckResponse`: `{ fatigue_level, action, reply?, audio?, new_remaining_seconds?, consecutive_fatigue }`
- LocalStorage contracts
  - `StoredTodoState` in `src/renderer/lib/storage.ts`:
    - `{ taskTitle, taskDate, todoItems: {id,text}[], doneItems: {id,text}[] }`
  - `MemoItem`: `{ content: string, created_at: string }`
  - Keys: `flowmate.todoState`, `flowmate.memos`
- Focus session state (`backend/core/focus_session.py`)
  - `FocusSession` dataclass: `id`, `task_text`, `remaining_seconds`, `consecutive_distract`, `consecutive_fatigue`, `awaiting_rest_response`, `memory[]`, etc.
- Flow state (`backend/core/flow_manager.py`)
  - `FlowState`: `idle`, `working`, `flow`, `immunity`, `break`

## 10. State Machine / Interaction State
- Frontend view state (`App.tsx`)
  - `currentView`: `home` -> `task` -> `timer` -> `focus` -> `break` with transitions in `handleGoToTimerConfig`, `handleStartFocus`, `enterBreakView`, `finishBreak`.
  - `profile` view toggled by `toggleProfilePanel()`.
- Audio/voice state
  - `isRecording`: controlled by `startRecording`/`stopRecording`.
  - `isThinking`: controlled by `beginThinking`/`endThinking` (ref-counted).
  - `isAvatarSpeaking`: set by `HTMLAudioElement` events (`play`, `ended`, `pause`, `error`).
- Focus state
  - `isFocusRunning`, `isCountUp`, `remainingSeconds` managed by timer effects.
  - `isAwaitingRestDecision` set by `fatigue_check` response.
  - `focusSessionId` holds backend session id.
- Backend flow state
  - `FlowManager` states: `idle`, `working`, `flow`, `immunity`, `break`.
  - `FocusSessionManager` holds per-session state including `awaiting_rest_response`.
- State transition triggers
  - User mic click -> `isRecording` -> `sendVoice*` -> `isThinking`.
  - Audio playback -> `isAvatarSpeaking` -> avatar video state switch.
  - `scheduleScreenCheck`/`scheduleFatigueCheck` timers update focus state.
- Concurrency risks
  - Multiple async requests can increment `thinkingCountRef`; errors are generally ignored, so UI may not surface failure states.

## 11. Dependency Graph
- Renderer
  - `src/renderer/App.tsx`
    - Components: `VoiceInput`, `ActionFloatingBtn`, `TimeWheelPicker`, `UiScaleFrame`
    - Storage: `src/renderer/lib/storage.ts`
    - IPC: `window.electron` from `src/main/preload.ts`
    - Backend APIs: `/api/interaction/*`, `/api/focus/*`, `/api/brain/audit/reset`
  - `src/renderer/MiniApp.tsx`
    - Storage: `src/renderer/lib/storage.ts`
    - IPC: `mini-window:get-bounds` / `mini-window:set-bounds`
- Electron main
  - `src/main/main.ts`
    - Window management: `BrowserWindow`
    - IPC: `ipcMain.handle(...)`
    - Screen capture: `desktopCapturer`
- Backend
  - `backend/main.py` -> routers
  - `backend/api/interaction.py` -> `voice_pipeline_service`, `audio_service`, `process_user_intent`, `agent_brain`
  - `backend/api/focus.py` -> `focus_session_manager`, `screen_agent`, `fatigue_detector`, `audio_service`, `agent_brain`
  - `backend/api/perception.py` -> `vision_service`, `fatigue_detector`, `flow_manager`
  - `backend/api/brain.py` -> `dashscope_service`, `screen_agent`
  - `backend/services/voice_pipeline.py`
    - `sensevoice_asr` -> `oss_uploader`
    - `interaction_service` -> `dashscope_service`
    - `modelscope_audio`
- High coupling / risk
  - `src/renderer/App.tsx` contains most UI + logic + API calls.
  - `backend/services/interaction_service.py` and `dashscope_service.py` tightly couple intent routing to a single LLM provider.

## 12. Configuration / Environment
- Environment files:
  - `.env` (runtime values, not scanned)
  - `.env.example` lists `DASHSCOPE_KEY`, `MODELSCOPE_KEY`, `VITE_API_BASE`, `SENSEVOICE_*`, `COSYVOICE_*`, `SCREEN_MOCK_MODE`, `AUDIO_MOCK_MODE`, `OSS_*`, `ENABLE_CAMERA`.
- Backend config: `backend/config.py`
  - Loads `.env` via `python-dotenv`.
  - Exposes model names, ports, timeouts, cache paths.
- Vite proxy: `vite.config.ts`
  - `/api` -> `http://127.0.0.1:8000` for local dev.
- Build/run commands: `package.json`
  - `npm run dev` (electron + vite), `npm run start:backend` (uvicorn).

## 13. Logging / Error Handling
- Renderer logs:
  - `console.warn`/`console.log` in `App.tsx` for audio playback errors and focus shortcuts.
  - Most `fetch` calls ignore errors or swallow them in `catch`.
- Backend logs:
  - `print()` statements in `focus.py`, `screen_agent.py`, `sensevoice_asr.py`.
  - Raises `HTTPException` for validation failures; other errors often converted to 500.
- Error propagation gaps:
  - Voice pipeline errors are returned in `response.error` but not surfaced in UI.
  - Frontend ignores non-OK responses in several calls (`speakText`, `sendVoice*`).

## 14. Performance Bottleneck Candidates
- Voice pipeline is strictly serial: ASR -> LLM -> TTS (`voice_pipeline.py`).
- ASR uploads audio to OSS and waits for transcription task completion.
- Screen audit sends full base64 images and may call VLM; caching helps but is still heavy.
- TTS generates full audio before playback; no streaming or chunked playback.
- Renderer always uploads full audio blobs; no progressive ASR.
- Multiple `fetch` calls for focus (screen + fatigue) can overlap with TTS.

## 15. Refactor Readiness
- Good first targets
  - Extract API client module from `src/renderer/App.tsx` (all `fetch` calls are inline).
  - Centralize voice pipeline response parsing and error surfacing.
  - Add instrumentation around `VoicePipelineService.handle()` timings.
- High-risk areas
  - `App.tsx` is highly coupled to UI + state + networking.
  - `screen_agent.py` caching logic affects focus behavior; changes can alter user experience.
  - `interaction_service.py` ties UI payloads to LLM outputs (breaking schema affects frontend).
- Dead/duplicate/legacy signals
  - `backend/api/interaction.py: /synthesize-speech` marked deprecated but still present.
  - `backend/api/brain.py` endpoints not referenced by renderer (except `/audit/reset`).
  - `backend/services/modelscope_vision.py` screen analysis API not referenced by renderer.
  - `src/main/ipc.ts` is empty.
  - `src/renderer/App.tsx` `audioUrlRef` is declared but unused.
  - README references test HTML files that are not present (only `src/renderer/index.html` found).

## 16. Open Questions / Unknowns
- `AGENT_GUIDE.md` not found in repo; unable to apply its instructions (未确认).
- Memo persistence: only LocalStorage writes found; backend memo APIs not found (未确认).
- Motion/expression driver fields are returned but unused in renderer (intended future work?).
- Presence/fatigue endpoints in `/api/perception` are not called by renderer (are they used by a background process?).
- Mock audio files in `backend/assets/mock_audio` are zero length; expected real audio assets? (未确认).

## 17. Recommended Next Step
- Step 1: Add latency instrumentation in `backend/services/voice_pipeline.py` and surface timings to the UI (use existing `timings` field).
- Step 2: Introduce a dedicated frontend API layer (extract all `fetch` calls from `src/renderer/App.tsx`) to enable retries, streaming, and error UI.
- Step 3: Evaluate streaming ASR/TTS options by extending `/interaction/voice` (or adding SSE/WebSocket) to reduce perceived latency.
