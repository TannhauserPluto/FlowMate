import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 感知钩子 (MVP 版本)
 * 监听键盘活动和鼠标空闲时间
 */
export function usePerception() {
  const [isKeyboardActive, setIsKeyboardActive] = useState(false);
  const [fatigueLevel, setFatigueLevel] = useState(0);
  const [mouseIdleTime, setMouseIdleTime] = useState(0);
  const [wpm, setWpm] = useState(0);
  const [charsPerMinute, setCharsPerMinute] = useState(0);
  const [isMonitoring, setIsMonitoring] = useState(false);

  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 处理键盘活动事件
  const handleKeyboardActivity = useCallback((data: {
    isActive: boolean;
    keyCount: number;
    wpm: number;
    charsPerMinute: number;
    mouseIdleTime: number;
    recentKeyCount: number;
  }) => {
    setIsKeyboardActive(data.isActive);
    setWpm(data.wpm || 0);
    setCharsPerMinute(data.charsPerMinute || 0);
    setMouseIdleTime(data.mouseIdleTime || 0);

    // 重置活动超时
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }

    if (data.isActive) {
      activityTimeoutRef.current = setTimeout(() => {
        setIsKeyboardActive(false);
      }, 3000);
    }
  }, []);

  // 启动感知监听
  const startPerception = useCallback(async () => {
    if (isMonitoring) return;

    setIsMonitoring(true);

    if (window.electron) {
      await window.electron.invoke('keyboard:start-monitor');
      window.electron.on('keyboard:activity', handleKeyboardActivity);
    }

    // MVP: 简化的疲劳检测 (基于鼠标空闲时间)
    // 不再依赖后端摄像头检测
  }, [isMonitoring, handleKeyboardActivity]);

  // 停止感知监听
  const stopPerception = useCallback(async () => {
    setIsMonitoring(false);

    if (window.electron) {
      await window.electron.invoke('keyboard:stop-monitor');
      window.electron.removeListener('keyboard:activity', handleKeyboardActivity);
    }

    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
      activityTimeoutRef.current = null;
    }
  }, [handleKeyboardActivity]);

  // 模拟按键 (用于窗口内的输入框)
  const simulateKeypress = useCallback(async () => {
    if (window.electron) {
      await window.electron.invoke('keyboard:simulate-keypress');
    }
  }, []);

  // 模拟鼠标移动
  const simulateMouseMove = useCallback(async () => {
    if (window.electron) {
      await window.electron.invoke('mouse:simulate-move');
    }
  }, []);

  // 请求截屏分析
  const captureAndAnalyze = useCallback(async (): Promise<string | null> => {
    try {
      const screenshot = await window.electron?.invoke('capture:screenshot');
      if (!screenshot) return null;

      const response = await fetch('http://127.0.0.1:8000/api/perception/analyze-screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: screenshot }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.analysis;
      }
      return null;
    } catch (error) {
      console.error('Screen analysis failed:', error);
      return null;
    }
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      stopPerception();
    };
  }, [stopPerception]);

  return {
    isKeyboardActive,
    fatigueLevel,
    mouseIdleTime,
    wpm,
    charsPerMinute,
    isMonitoring,
    startPerception,
    stopPerception,
    simulateKeypress,
    simulateMouseMove,
    captureAndAnalyze,
  };
}

// 扩展 Window 类型
declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, callback: (...args: any[]) => void) => void;
      removeListener: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}
