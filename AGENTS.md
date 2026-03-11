这是仓库指南的中文翻译版本：

# 仓库规范指南

## 项目结构与模块组织

* `src/main/` 存放 Electron 主进程代码（例如 `main.ts`, `ipc.ts`, `preload.ts`）。
* `src/renderer/` 是 React UI 部分（入口为 `index.tsx`，组件在 `components/` 中，Hooks 在 `hooks/` 中，样式在 `styles/` 中）。
* `backend/` 是 Python FastAPI 服务（`main.py`, `api/`, `core/`, `services/`, `models/`）。
* `docs/` 包含支持文档，`dist/` 是构建输出目录。
* 独立的 HTML 文件如 `camera_test.html` 和 `screen_test.html` 是用于手动测试的工具。

## 构建、测试与开发命令

* `npm run dev` 运行 Electron 主进程 + 带有热重载（hot reload）的 Vite 渲染进程。
* `npm run dev:main` 使用 `tsc` 构建主进程并启动 Electron。
* `npm run dev:renderer` 启动 UI 的 Vite 开发服务器。
* `npm run build` 将主进程和渲染进程都构建到 `dist/` 目录中。
* `npm run start:backend` 在端口 8000 上运行带有重载功能的 FastAPI 服务器。
* `pip install -r requirements.txt` 安装后端依赖。

## 代码风格与命名约定

* **TypeScript/React**：组件使用帕斯卡命名法/大驼峰（PascalCase，如 `ChatPanel.tsx`），Hooks 使用驼峰命名法/小驼峰（camelCase，如 `useFlowAI.ts`）。
* **Python**：模块和函数使用蛇形命名法（snake_case，如 `main.py`, `config.py`）。
* 保持格式与现有文件一致；本仓库目前没有强制使用代码检查（linter）或格式化工具（formatter）。
* TS/JSON 倾向于使用 **2 空格**缩进，Python 使用 **4 空格**缩进，以匹配当前文件风格。

## 测试指南

* 目前尚未配置自动化测试套件。
* 请使用手动 HTML 页面（`camera_test.html`, `screen_test.html`）进行快速的功能检查。
* 如果你添加了测试，请在此文件中记录如何运行它们，并将其集成到 `npm` 或 `pytest` 命令中。

## 提交 (Commit) 与合并请求 (Pull Request) 指南

* 最近的提交信息使用“前缀 + 简短描述”的格式（例如 `Yan_feat:...`, `security:...`）。请遵循相同的模式以保持一致性。
* PR (合并请求) 应包含：简短摘要、测试步骤（运行了哪些命令）以及针对渲染层更改的 UI 截图/GIF 动图。
* 如果有相关的 Issue 或工单，请在 PR 中关联。

## 安全与配置

* 机密信息（Secrets）通过 `.env` 文件加载（例如 `MODELSCOPE_TOKEN`, `DASHSCOPE_API_KEY`）。**切勿提交真实的密钥**。
* 避免在日志和截图中泄露 API 密钥和本地路径。