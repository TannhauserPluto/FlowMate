# FlowMate-Echo

AI 陪伴式心流助手 - 让专注变得更简单

## 项目简介

FlowMate-Echo 是一款基于 AI 的桌面伴学应用，通过数字人陪伴、智能感知和心流保护机制，帮助用户进入并保持专注状态。

## 核心特性

- **数字人伴学 (Body Doubling)**: 预渲染视频循环实现流畅的数字人陪伴
- **智能感知**: 基于 Qwen-VL 的屏幕分析和键盘活动监测
- **心流保护**: 智能检测心流状态，避免打扰深度专注
- **AI 任务拆解**: 基于 Qwen-Max 的智能任务分解
- **语音交互**: CosyVoice 语音合成，温暖陪伴

## 技术栈

### 前端
- Electron + React + TypeScript
- TailwindCSS
- Vite

### 后端
- Python FastAPI
- ModelScope (Qwen-VL, CosyVoice)
- DashScope API

## 快速开始

### 环境要求
- Node.js >= 18.0
- Python >= 3.10
- 摄像头 (可选)

### 安装

```bash
# 前端依赖
npm install

# 后端依赖
pip install -r requirements.txt
```

### 配置

编辑 `.env` 文件，填入 API Keys:

```env
MODELSCOPE_TOKEN=your_token
DASHSCOPE_API_KEY=your_key
```

### 运行

```bash
# 启动后端
npm run start:backend

# 启动前端
npm run dev
```

## 目录结构

```
FlowMate-Echo/
├── src/                  # 前端代码
│   ├── main/             # Electron 主进程
│   └── renderer/         # React 渲染进程
├── backend/              # Python 后端
│   ├── core/             # 核心逻辑
│   ├── services/         # 服务封装
│   └── api/              # API 路由
└── docs/                 # 文档
```

## 许可证

MIT License
