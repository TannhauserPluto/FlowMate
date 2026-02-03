# FlowMate Voice & Motion Driver Protocol (SSOT)

## 1. Basics
- Service layer: `backend/services/modelscope_audio.py`
- Endpoint: `POST /api/interaction/speak`
- Default voice: `sambert-zhiyan-v1` (instruction-driven voice)
- Model (example): `cosyvoice-v3-flash`
- Mock assets: `backend/assets/mock_audio/{emotion}.mp3`

## 2. API Schema

### Request
```json
{
  "text": "Stop zoning out. The thesis is not finished yet.",
  "emotion": "strict"
}
```

### Response
```json
{
  "status": "success",
  "data": {
    "audio": {
      "base64": "SUQzBAAAAAAA...",
      "format": "mp3",
      "sample_rate": 24000,
      "estimated_duration_ms": 3500
    },
    "driver": {
      "motion_trigger": "explain",
      "expression_trigger": "serious",
      "subtitle": "Stop zoning out. The thesis is not finished yet."
    }
  }
}
```

## 3. Emotion Mapping (EMOTION_MAP)

Instruction-based control: the backend sends an instruction sentence via the SDK `instruction` field (not spoken aloud).
The `subtitle` returned to the client is the **original text only** (instruction not included).

| Emotion | Instruction | Rate | Motion | Expression | Example Line |
| --- | --- | --- | --- | --- |
| neutral | 你正在进行闲聊互动，你说话的情感是neutral。 | 1.0 | idle_breathing | neutral | I am here with you. |
| strict | 你正在进行新闻播报，你说话的情感是neutral。 | 0.9 | explain | serious | Refocus on the task. |
| encouraging | 你正在进行闲聊互动，你说话的情感是happy。 | 1.1 | clapping / wave | smile | You are doing great. Keep going! |
| shush | 你正在以一个故事机的身份说话，你说话的情感是neutral。 | 0.8 | shush_gesture | worry | Shh... keep it quiet. |

## 4. Mock & Fallback
- When `MOCK_MODE = True`, load `backend/assets/mock_audio/{emotion}.mp3` and return Base64.
- If the file is missing, fall back to `neutral.mp3`; if still missing, return empty audio.
- Duration is estimated as: `estimated_duration_ms = char_count * 250`, capped at 20000ms.

## 5. Constraints
- `emotion` allowed values: `strict | encouraging | neutral | shush`. Unknown values fall back to `neutral`.
- If a motion or expression is unavailable on the client, the UI should fall back to `idle_breathing` / `neutral` without crashing.
