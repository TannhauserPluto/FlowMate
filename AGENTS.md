# Repository Guidelines

## Project Structure & Module Organization
- `src/main/` holds Electron main-process code (e.g., `main.ts`, `ipc.ts`, `preload.ts`).
- `src/renderer/` is the React UI (entry `index.tsx`, components in `components/`, hooks in `hooks/`, styles in `styles/`).
- `backend/` is the Python FastAPI service (`main.py`, `api/`, `core/`, `services/`, `models/`).
- `docs/` contains supporting documentation, and `dist/` is the build output.
- Standalone HTML files like `camera_test.html` and `screen_test.html` are manual test utilities.

## Build, Test, and Development Commands
- `npm run dev` runs Electron main + Vite renderer with hot reload.
- `npm run dev:main` builds main process with `tsc` and launches Electron.
- `npm run dev:renderer` starts the Vite dev server for the UI.
- `npm run build` builds both main and renderer into `dist/`.
- `npm run start:backend` runs the FastAPI server with reload on port 8000.
- `pip install -r requirements.txt` installs backend dependencies.

## Coding Style & Naming Conventions
- TypeScript/React: use PascalCase for components (`ChatPanel.tsx`) and camelCase for hooks (`useFlowAI.ts`).
- Python: use snake_case for modules and functions (`main.py`, `config.py`).
- Keep formatting consistent with existing files; there is no enforced linter/formatter in this repo.
- Prefer 2-space indentation in TS/JSON and 4-space in Python, matching current files.

## Testing Guidelines
- There is no automated test suite configured yet.
- Use the manual HTML pages (`camera_test.html`, `screen_test.html`) for quick feature checks.
- If you add tests, document how to run them in this file and wire them into `npm` or `pytest`.

## Commit & Pull Request Guidelines
- Recent commit messages use a prefix plus a brief description (e.g., `Yan_feat:...`, `security:...`). Follow the same pattern for consistency.
- PRs should include: a short summary, testing steps (commands run), and UI screenshots/GIFs for renderer changes.
- Link related issues or tickets when available.

## Security & Configuration
- Secrets are loaded from `.env` (e.g., `MODELSCOPE_TOKEN`, `DASHSCOPE_API_KEY`). Do not commit real keys.
- Keep API keys and local paths out of logs and screenshots.
