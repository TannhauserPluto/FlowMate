import React, { useState, useEffect, useCallback, useRef } from 'react';

type FlowState = 'idle' | 'working' | 'flow' | 'immunity' | 'break';

interface FlowTimerProps {
  flowState: FlowState;
  wpm: number;
  charsPerMinute: number;
  onFlowEnter: () => void;
  onImmunityEnter: () => void;
  onBreakStart: () => void;
  onBreakEnd: () => void;
  onShhhTrigger: () => void;
}

// MVP 配置常量
const DEFAULT_FOCUS_TIME = 10 * 60; // 10 分钟冲刺 (演示用)
const FLOW_IMMUNITY_THRESHOLD = 40; // 心流豁免阈值 (字符/分钟)
const BREAK_DURATION = 5 * 60; // 5 分钟休息
const OVERTIME_MAX = 5 * 60; // 最大超时 5 分钟

/**
 * 心流计时器组件 (MVP 版本)
 * 核心功能：倒计时 + 心流豁免检测
 */
const FlowTimer: React.FC<FlowTimerProps> = ({
  flowState,
  wpm,
  charsPerMinute,
  onFlowEnter,
  onImmunityEnter,
  onBreakStart,
  onBreakEnd,
  onShhhTrigger,
}) => {
  const [countdown, setCountdown] = useState(DEFAULT_FOCUS_TIME);
  const [overtime, setOvertime] = useState(0);
  const [breakTime, setBreakTime] = useState(BREAK_DURATION);
  const [isRunning, setIsRunning] = useState(false);
  const [isImmunityActive, setIsImmunityActive] = useState(false);
  const [showShhhAnimation, setShowShhhAnimation] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const hasTriggeredImmunity = useRef(false);

  // 格式化时间显示
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.abs(seconds) % 60;
    const prefix = isImmunityActive ? '+' : '';
    return `${prefix}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 检查是否应该触发心流豁免
  const checkFlowImmunity = useCallback((): boolean => {
    return charsPerMinute >= FLOW_IMMUNITY_THRESHOLD || wpm >= 8;
  }, [charsPerMinute, wpm]);

  // 主计时器逻辑
  useEffect(() => {
    if (!isRunning) return;

    timerRef.current = setInterval(() => {
      if (flowState === 'break') {
        setBreakTime((prev) => {
          if (prev <= 1) {
            onBreakEnd();
            setIsRunning(false);
            setCountdown(DEFAULT_FOCUS_TIME);
            setOvertime(0);
            setIsImmunityActive(false);
            hasTriggeredImmunity.current = false;
            return BREAK_DURATION;
          }
          return prev - 1;
        });
      } else if (isImmunityActive) {
        setOvertime((prev) => {
          if (prev >= OVERTIME_MAX) {
            onBreakStart();
            return prev;
          }
          return prev + 1;
        });
      } else {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (checkFlowImmunity() && !hasTriggeredImmunity.current) {
              hasTriggeredImmunity.current = true;
              setIsImmunityActive(true);
              setShowShhhAnimation(true);
              onImmunityEnter();
              onShhhTrigger();
              setTimeout(() => setShowShhhAnimation(false), 3000);
              return 0;
            } else {
              onBreakStart();
              return 0;
            }
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRunning, flowState, isImmunityActive, checkFlowImmunity, onBreakStart, onBreakEnd, onImmunityEnter, onShhhTrigger]);

  // 监听演示快捷键
  useEffect(() => {
    const handleDemoJump = () => setCountdown(3);
    const handleDemoShhh = () => {
      setIsImmunityActive(true);
      setShowShhhAnimation(true);
      setCountdown(0);
      onShhhTrigger();
      setTimeout(() => setShowShhhAnimation(false), 3000);
    };

    if (window.electron) {
      window.electron.on('demo:jump-to-end', handleDemoJump);
      window.electron.on('demo:trigger-shhh', handleDemoShhh);
    }

    return () => {
      if (window.electron) {
        window.electron.removeListener('demo:jump-to-end', handleDemoJump);
        window.electron.removeListener('demo:trigger-shhh', handleDemoShhh);
      }
    };
  }, [onShhhTrigger]);

  const handleToggle = () => {
    if (isRunning) {
      setIsRunning(false);
    } else {
      setIsRunning(true);
      if (flowState === 'idle') {
        onFlowEnter();
      }
    }
  };

  const handleEndImmunity = () => {
    setIsImmunityActive(false);
    setOvertime(0);
    onBreakStart();
  };

  const handleSkipBreak = () => {
    onBreakEnd();
    setIsRunning(false);
    setCountdown(DEFAULT_FOCUS_TIME);
    setBreakTime(BREAK_DURATION);
    setOvertime(0);
    setIsImmunityActive(false);
    hasTriggeredImmunity.current = false;
  };

  const handleSetTime = (minutes: number) => {
    setCountdown(minutes * 60);
    setIsRunning(false);
  };

  return (
    <div className="flow-timer">
      {showShhhAnimation && (
        <div className="shhh-overlay">
          <div className="shhh-text">嘘... 心流保护中</div>
        </div>
      )}

      <div className={`timer-display ${isImmunityActive ? 'immunity' : ''} ${flowState === 'break' ? 'break' : ''}`}>
        {flowState === 'break' ? (
          <span className="break-time">{formatTime(breakTime)}</span>
        ) : isImmunityActive ? (
          <span className="overtime">{formatTime(overtime)}</span>
        ) : (
          <span className="countdown">{formatTime(countdown)}</span>
        )}
      </div>

      <div className="timer-stats">
        <span className="wpm-indicator">
          {charsPerMinute} 字符/分
          {charsPerMinute >= FLOW_IMMUNITY_THRESHOLD && (
            <span className="flow-badge">心流</span>
          )}
        </span>
      </div>

      <div className="timer-status">
        {!isRunning && flowState === 'idle' && '准备开始'}
        {isRunning && !isImmunityActive && flowState !== 'break' && '专注中...'}
        {isImmunityActive && '心流保护中 - 继续保持!'}
        {flowState === 'break' && '休息一下'}
      </div>

      <div className="timer-progress-container">
        <div
          className={`timer-progress ${isImmunityActive ? 'immunity' : ''}`}
          style={{
            width: flowState === 'break'
              ? `${(1 - breakTime / BREAK_DURATION) * 100}%`
              : isImmunityActive
              ? `${Math.min((overtime / OVERTIME_MAX) * 100, 100)}%`
              : `${(1 - countdown / DEFAULT_FOCUS_TIME) * 100}%`,
          }}
        />
      </div>

      {!isRunning && flowState !== 'break' && (
        <div className="time-presets">
          <button onClick={() => handleSetTime(5)} className={countdown === 300 ? 'active' : ''}>5分钟</button>
          <button onClick={() => handleSetTime(10)} className={countdown === 600 ? 'active' : ''}>10分钟</button>
          <button onClick={() => handleSetTime(25)} className={countdown === 1500 ? 'active' : ''}>25分钟</button>
        </div>
      )}

      <div className="timer-controls">
        {flowState === 'break' ? (
          <button className="skip-btn" onClick={handleSkipBreak}>跳过休息</button>
        ) : isImmunityActive ? (
          <button className="end-immunity-btn" onClick={handleEndImmunity}>结束并休息</button>
        ) : (
          <button className="toggle-btn" onClick={handleToggle}>
            {isRunning ? '暂停' : '开始冲刺'}
          </button>
        )}
      </div>

      {isImmunityActive && (
        <div className="flow-protection-tip">
          检测到深度专注 ({charsPerMinute} 字符/分)，已延迟休息提醒
        </div>
      )}
    </div>
  );
};

export default FlowTimer;
