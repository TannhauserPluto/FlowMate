# FlowMate-Echo

AI 陪伴式心流助手 - 让专注变得更简单

FlowMate-Echo 是一款基于 AI 的桌面伴学应用，通过数字人陪伴、多模态感知与心流保护机制，帮助用户进入并保持专注状态。它强调“低打扰、强陪伴”，在不打断的前提下提供任务拆解、语音支持与节奏管理。

如果你需要更完整的技术说明，请查看 `allaboutit.md`。

---

## 功能概览

- 数字人陪伴（Body Doubling）：预渲染视频循环，提供真实在场感
- 任务拆解：大任务自动拆成 3 个可执行步骤
- 语音交互：ASR → 意图路由 → LLM 回复 → TTS
- 智能感知：屏幕专注审计 / 在位检测 / 疲劳检测
- 心流保护：专注状态机 + 低打扰提醒机制

---

## 技术亮点

- 双重过滤屏幕审计：时间冷却 + 视觉防抖，降低大模型调用频率
- 语音与动作一体化输出：TTS 同时返回 motion/expression driver
- 多模块可降级：Mock 模式保证 MVP 可运行
- 统一意图路由：聊天与任务拆解走同一协议

---

## 架构简图

- Electron 主进程：窗口控制 / 托盘 / 快捷键 / 屏幕截图
- React 渲染层：交互与视觉呈现（玻璃拟态 UI）
- FastAPI 后端：语音管道、屏幕审计、心流会话与任务拆解
- 模型服务：DashScope (Qwen / CosyVoice / SenseVoice)

---

## 项目结构

```
FlowMate-Echo/
├─ src/
│  ├─ main/         # Electron 主进程
│  └─ renderer/     # React 渲染层
├─ backend/         # FastAPI 后端
├─ docs/            # 文档
├─ dist/            # 构建输出
└─ *.html           # 手动测试页面
```

---

## 环境要求

- Node.js >= 18
- Python >= 3.10
- 摄像头（可选，用于疲劳检测）

---

## 快速开始

### 1. 安装依赖

```bash
npm install
pip install -r requirements.txt
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写 API Key：

```env
MODELSCOPE_TOKEN=
DASHSCOPE_API_KEY=your_key
```

> 注意：请勿提交真实 `.env`。

### 3. 启动服务

```bash
# 启动后端
npm run start:backend

# 启动前端（Electron + Vite）
npm run dev
```

---

## 常用命令

- `npm run dev`：渲染进程 + 主进程同时启动
- `npm run dev:renderer`：仅启动 UI
- `npm run dev:main`：构建主进程并启动 Electron
- `npm run build`：构建到 `dist/`

---

## 典型使用流程

1. Home 页面输入任务（文字或语音）
2. 系统自动拆解任务 → 生成 Todo 面板
3. 点击开始专注 → 进入 Focus 模式
4. 屏幕审计 / 疲劳检测定时触发
5. 专注结束 → Break 休息视图

---

## 手动测试页面

- `camera_test.html`：在位检测
- `screen_test.html`：屏幕专注审计
- `voice_test.html`：TTS + driver
- `voice_single_test.html`：单入口语音测试
- `voice_pipeline_test.html`：完整语音管道
- `voice_all_test.html`：一体化语音测试

---

## 常见问题

**Q: 数字人视频不显示？**
A: 确保 `src/renderer/assets/video_loops/` 有对应视频文件。

**Q: 后端连接失败？**
A: 确认后端在 8000 端口运行，且 CSP 允许访问本地接口。

**Q: ASR 没有结果？**
A: SenseVoice 录音识别需要 OSS 配置，否则会返回空文本。

---

## 相关文档

- `docs/UserManual.md`
- `docs/PRD_V9.0.md`
- `docs/voice_motion_protocol.md`
- `allaboutit.md`

---

## 许可证

MIT License
