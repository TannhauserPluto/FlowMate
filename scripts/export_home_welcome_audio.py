"""
Dev-only helper: export HOME_WELCOME_TEXT via /api/interaction/speak to a local mp3 file.
This script is not part of the production runtime.
"""

from __future__ import annotations

import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_URL = "http://127.0.0.1:8000/api/interaction/speak"
HOME_WELCOME_TEXT = (
    "你好呀，我是 FlowMate，你的心流维护小助手。你可以在输入框告诉我今天要完成的事，我会帮你拆解成待办；"
    "也可以点击麦克风直接告诉我你的闪念灵感。想进入专注计时就点下方的“番茄钟”，头像页可以查看进度。"
    "现在告诉我你的任务吧。"
)
OUTPUT_REL_PATH = Path("public") / "audio" / "home_welcome.mp3"


def _post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8"))


def _extract_audio_base64(payload: dict) -> tuple[str | None, str]:
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), dict):
            audio = payload["data"].get("audio")
            if isinstance(audio, dict) and audio.get("base64"):
                return audio.get("base64"), "data.audio.base64"
        if isinstance(payload.get("audio"), dict) and payload["audio"].get("base64"):
            return payload["audio"].get("base64"), "audio.base64"
    return None, "not_found"


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    output_path = repo_root / OUTPUT_REL_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        payload = _post_json(API_URL, {"text": HOME_WELCOME_TEXT, "emotion": "neutral"})
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore")
        print(f"[export] request_failed status={error.code} body={body}")
        return 1
    except Exception as error:
        print(f"[export] request_failed error={error}")
        return 1

    audio_b64, field_path = _extract_audio_base64(payload)
    if not audio_b64:
        print("[export] audio_base64_not_found")
        print(f"[export] response={payload}")
        print(f"[export] expected_field={field_path}")
        return 1

    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception as error:
        print(f"[export] decode_failed error={error}")
        return 1

    output_path.write_bytes(audio_bytes)
    print("[export] success")
    print(f"[export] output={output_path}")
    print(f"[export] bytes={len(audio_bytes)}")
    print(f"[export] field_used={field_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
