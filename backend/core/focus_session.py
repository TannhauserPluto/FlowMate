"""
FlowMate-Echo Focus Session Manager
In-memory session state for focus detection.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional
import uuid


@dataclass
class FocusSession:
    """Focus session state (in-memory)."""
    id: str
    task_text: str
    created_at: datetime
    remaining_seconds: int
    last_screen_focused: Optional[bool] = None
    last_fatigue_ok: Optional[bool] = None
    consecutive_distract: int = 0
    consecutive_fatigue: int = 0
    awaiting_rest_response: bool = False
    memory: List[Dict[str, str]] = field(default_factory=list)


class FocusSessionManager:
    """Manage focus sessions in memory (single-node)."""

    def __init__(self) -> None:
        self._sessions: Dict[str, FocusSession] = {}

    def create_session(self, task_text: str, duration_seconds: int) -> FocusSession:
        session_id = f"focus-{uuid.uuid4().hex[:8]}"
        session = FocusSession(
            id=session_id,
            task_text=task_text.strip(),
            created_at=datetime.now(),
            remaining_seconds=max(0, int(duration_seconds or 0)),
        )
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> Optional[FocusSession]:
        return self._sessions.get(session_id)

    def update_task(self, session_id: str, task_text: str) -> Optional[FocusSession]:
        session = self.get(session_id)
        if not session:
            return None
        session.task_text = task_text.strip()
        return session

    def record_message(self, session_id: str, role: str, content: str) -> None:
        session = self.get(session_id)
        if not session:
            return
        session.memory.append({"role": role, "content": content})
        # Keep memory short to avoid prompt blow-up
        if len(session.memory) > 12:
            session.memory = session.memory[-12:]

    def update_remaining(self, session_id: str, remaining_seconds: int) -> None:
        session = self.get(session_id)
        if not session:
            return
        session.remaining_seconds = max(0, int(remaining_seconds or 0))

    def set_screen_result(self, session_id: str, focused: bool) -> Optional[int]:
        session = self.get(session_id)
        if not session:
            return None
        session.last_screen_focused = focused
        if focused:
            session.consecutive_distract = 0
            return 8 * 60
        session.consecutive_distract += 1
        # If distracted, re-check in 4 minutes
        return 4 * 60

    def set_fatigue_result(self, session_id: str, fatigue_ok: bool) -> None:
        session = self.get(session_id)
        if not session:
            return
        session.last_fatigue_ok = fatigue_ok
        if fatigue_ok:
            session.consecutive_fatigue = 0
            session.awaiting_rest_response = False
        else:
            session.consecutive_fatigue += 1

    def should_start_positive_timer(self, session_id: str) -> bool:
        session = self.get(session_id)
        if not session:
            return False
        return bool(session.last_screen_focused) and bool(session.last_fatigue_ok)


focus_session_manager = FocusSessionManager()

