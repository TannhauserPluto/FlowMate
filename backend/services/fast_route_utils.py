from __future__ import annotations

import re
import unicodedata
from typing import Dict


FAST_ROUTE_EDGE_PUNCT_RE = re.compile(r"^[\s，。！？、,.!?;；:：'\"“”‘’（）()【】\[\]<>《》~～`·-]+|[\s，。！？、,.!?;；:：'\"“”‘’（）()【】\[\]<>《》~～`·-]+$")
FAST_ROUTE_COMPACT_RE = re.compile(r"[\s，。！？、,.!?;；:：'\"“”‘’（）()【】\[\]<>《》~～`·-]+")
FAST_ROUTE_SPACE_RE = re.compile(r"\s+")
ENGLISH_TOKEN_RE = re.compile(r"[a-z]+")

GREETING_PATTERN_SPECS = (
    ("nihao_default", re.compile(r"^(?:你好(?:呀|啊)?|您好)$"), "default"),
    ("social_short", re.compile(r"^(?:哈喽(?:呀|啊)?|嗨|hi|hello)$"), "short"),
    (
        "social_present",
        re.compile(r"^(?:(?:你好(?:呀|啊)?|您好|哈喽(?:呀|啊)?|嗨|hi|hello)?(?:在吗|在不在|有人吗))$"),
        "present",
    ),
    ("morning_short", re.compile(r"^(?:早|早啊|早安|早上好)$"), "morning"),
)

CHINESE_GREETING_HINTS = (
    "你好",
    "您好",
    "哈喽",
    "嗨",
    "在吗",
    "在不在",
    "有人吗",
    "早安",
    "早上好",
)
ENGLISH_GREETING_HINTS = {"hi", "hello"}


def normalize_fast_route_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(text or "")).strip().lower()
    return FAST_ROUTE_SPACE_RE.sub(" ", normalized)


def compact_fast_route_text(text: str) -> str:
    normalized = normalize_fast_route_text(text)
    trimmed = FAST_ROUTE_EDGE_PUNCT_RE.sub("", normalized)
    return FAST_ROUTE_COMPACT_RE.sub("", trimmed)


def _resolve_greeting_reject_reason(normalized: str, compact: str) -> str:
    english_tokens = [token for token in ENGLISH_TOKEN_RE.findall(normalized) if token in ENGLISH_GREETING_HINTS]
    if english_tokens:
        return "extra_semantic_content"

    if any(compact.startswith(token) for token in CHINESE_GREETING_HINTS):
        return "extra_semantic_content"

    if any(token in compact for token in CHINESE_GREETING_HINTS):
        return "substring_only"

    return "no_pattern"


def check_greeting_utterance(text: str) -> Dict[str, str]:
    original = str(text or "")
    normalized = normalize_fast_route_text(original)
    compact = compact_fast_route_text(normalized)
    display_original = original.replace("\n", " ")[:120]
    display_normalized = normalized.replace("\n", " ")[:120]

    print(f"[FastRoute] normalize text={display_original} normalized={display_normalized}")

    if not compact:
        print(f"[FastRoute] greeting_check text={display_original} result=false reason=empty")
        return {
            "matched": "false",
            "reason": "empty",
            "pattern": "",
            "kind": "",
            "normalized": normalized,
            "compact": compact,
        }

    for pattern_name, pattern_re, kind in GREETING_PATTERN_SPECS:
        if pattern_re.fullmatch(compact):
            print(f"[FastRoute] greeting_check text={display_original} result=true reason=matched")
            print(f"[FastRoute] greeting_accepted pattern={pattern_name}")
            return {
                "matched": "true",
                "reason": "matched",
                "pattern": pattern_name,
                "kind": kind,
                "normalized": normalized,
                "compact": compact,
            }

    reason = _resolve_greeting_reject_reason(normalized, compact)
    print(f"[FastRoute] greeting_check text={display_original} result=false reason={reason}")
    if reason in {"substring_only", "extra_semantic_content"}:
        print(f"[FastRoute] greeting_rejected reason={reason}")
    return {
        "matched": "false",
        "reason": reason,
        "pattern": "",
        "kind": "",
        "normalized": normalized,
        "compact": compact,
    }
