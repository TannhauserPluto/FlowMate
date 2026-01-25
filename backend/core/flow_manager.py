"""
FlowMate-Echo Flow Manager
心流状态机管理
"""

from enum import Enum
from typing import Optional
from dataclasses import dataclass
from datetime import datetime, timedelta


class FlowState(Enum):
    """心流状态枚举"""
    IDLE = "idle"           # 待机
    WORKING = "working"     # 工作中
    FLOW = "flow"           # 心流状态
    IMMUNITY = "immunity"   # 心流豁免
    BREAK = "break"         # 休息


@dataclass
class FlowSession:
    """心流会话数据"""
    state: FlowState
    start_time: datetime
    work_duration: int = 0  # 秒
    break_duration: int = 0  # 秒
    flow_count: int = 0     # 进入心流次数
    total_focus_time: int = 0  # 总专注时间


class FlowManager:
    """心流状态机管理器"""

    # 配置常量 (秒)
    FLOW_THRESHOLD = 25 * 60       # 25 分钟进入心流
    IMMUNITY_DURATION = 5 * 60     # 5 分钟心流豁免
    BREAK_DURATION = 5 * 60        # 5 分钟休息
    WORK_CYCLE = 50 * 60           # 50 分钟工作周期
    IDLE_TIMEOUT = 3 * 60          # 3 分钟无活动回到待机

    def __init__(self):
        self.session: Optional[FlowSession] = None
        self.last_activity_time: Optional[datetime] = None
        self._init_session()

    def _init_session(self):
        """初始化会话"""
        self.session = FlowSession(
            state=FlowState.IDLE,
            start_time=datetime.now(),
        )

    def get_state(self) -> FlowState:
        """获取当前状态"""
        return self.session.state if self.session else FlowState.IDLE

    def get_session_info(self) -> dict:
        """获取会话信息"""
        if not self.session:
            return {}
        return {
            "state": self.session.state.value,
            "work_duration": self.session.work_duration,
            "break_duration": self.session.break_duration,
            "flow_count": self.session.flow_count,
            "total_focus_time": self.session.total_focus_time,
        }

    def on_activity(self) -> FlowState:
        """检测到用户活动时调用"""
        self.last_activity_time = datetime.now()

        if self.session.state == FlowState.IDLE:
            self._transition_to(FlowState.WORKING)
        elif self.session.state == FlowState.BREAK:
            # 休息期间检测到活动，可选择是否打断
            pass

        return self.session.state

    def on_idle(self) -> FlowState:
        """检测到用户空闲时调用"""
        if self.session.state in [FlowState.WORKING, FlowState.FLOW]:
            # 检查是否超过空闲超时
            if self.last_activity_time:
                idle_duration = (datetime.now() - self.last_activity_time).total_seconds()
                if idle_duration > self.IDLE_TIMEOUT:
                    self._transition_to(FlowState.IDLE)

        return self.session.state

    def update(self, delta_seconds: int = 1) -> dict:
        """更新状态机 (每秒调用)"""
        events = []

        if self.session.state == FlowState.WORKING:
            self.session.work_duration += delta_seconds

            # 检查是否进入心流
            if self.session.work_duration >= self.FLOW_THRESHOLD:
                self._transition_to(FlowState.FLOW)
                events.append("enter_flow")

        elif self.session.state == FlowState.FLOW:
            self.session.work_duration += delta_seconds
            self.session.total_focus_time += delta_seconds

            # 检查是否到达工作周期
            if self.session.work_duration >= self.WORK_CYCLE:
                self._transition_to(FlowState.IMMUNITY)
                events.append("enter_immunity")

        elif self.session.state == FlowState.IMMUNITY:
            # 心流豁免倒计时
            self.session.work_duration += delta_seconds
            if self.session.work_duration >= self.WORK_CYCLE + self.IMMUNITY_DURATION:
                self._transition_to(FlowState.BREAK)
                events.append("start_break")

        elif self.session.state == FlowState.BREAK:
            self.session.break_duration += delta_seconds

            # 检查休息是否结束
            if self.session.break_duration >= self.BREAK_DURATION:
                self._end_break()
                events.append("end_break")

        return {
            "state": self.session.state.value,
            "events": events,
            "work_duration": self.session.work_duration,
            "break_duration": self.session.break_duration,
        }

    def _transition_to(self, new_state: FlowState):
        """状态转换"""
        old_state = self.session.state
        self.session.state = new_state

        if new_state == FlowState.FLOW:
            self.session.flow_count += 1

        print(f"Flow state transition: {old_state.value} -> {new_state.value}")

    def _end_break(self):
        """结束休息"""
        self.session.state = FlowState.IDLE
        self.session.work_duration = 0
        self.session.break_duration = 0

    def force_break(self):
        """强制休息"""
        self._transition_to(FlowState.BREAK)

    def skip_break(self):
        """跳过休息"""
        self._end_break()

    def reset(self):
        """重置状态机"""
        self._init_session()


# 全局实例
flow_manager = FlowManager()
