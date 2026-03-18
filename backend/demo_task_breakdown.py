from dataclasses import dataclass
from typing import Optional, Tuple


DEMO_TASK_BREAKDOWN_DELAY_SECONDS = 2.0


@dataclass(frozen=True)
class DemoTaskBreakdown:
    trigger: str
    title: str
    steps: Tuple[str, str, str]
    summary: str


DIGITAL_MEDIA_PAPER_DEMO = DemoTaskBreakdown(
    trigger="数字媒体论文",
    title="数字媒体论文",
    steps=(
        "新建论文文档",
        "列出章节大纲",
        "写摘要初稿",
    ),
    summary="演示模式下，我先帮你固定拆成三步：新建论文文档、列出章节大纲、写摘要初稿。",
)


def _normalize_text(text: str) -> str:
    return "".join((text or "").strip().lower().split())


def get_demo_task_breakdown(task_text: str) -> Optional[DemoTaskBreakdown]:
    normalized = _normalize_text(task_text)
    if not normalized:
        return None

    if "数字媒体论文" in normalized:
        return DIGITAL_MEDIA_PAPER_DEMO

    if "数字媒体" in normalized and "论文" in normalized:
        return DIGITAL_MEDIA_PAPER_DEMO

    return None
