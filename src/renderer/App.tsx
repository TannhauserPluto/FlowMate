import React, { useState, useEffect, useCallback, useRef } from 'react';
import VideoAvatar from './components/VideoAvatar';
import TaskPanel from './components/TaskPanel';
import FlowTimer from './components/FlowTimer';
import { usePerception } from './hooks/usePerception';
import { useFlowAI } from './hooks/useFlowAI';

// 数字人状态类型
type AvatarState = 'idle' | 'work' | 'focus' | 'shhh' | 'stretch';

// 心流状态类型
type FlowState = 'idle' | 'working' | 'flow' | 'immunity' | 'break';

// 发呆检测阈值 (毫秒)
const IDLE_DETECTION_THRESHOLD = 5000;

const App: React.FC = () => {
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [wpm, setWpm] = useState(0);
  const [charsPerMinute, setCharsPerMinute] = useState(0);
  const [showIdlePrompt, setShowIdlePrompt] = useState(false);

  const shhhTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 感知钩子
  const { 
    isKeyboardActive, 
    mouseIdleTime,
    startPerception, 
    stopPerception 
  } = usePerception();

  // AI 钩子
  const { generateTasks, isLoading } = useFlowAI();

  // 监听键盘活动数据
  useEffect(() => {
    const handleKeyboardActivity = (data: any) => {
      setWpm(data.wpm || 0);
      setCharsPerMinute(data.charsPerMinute || 0);
    };

    if (window.electron) {
      window.electron.on('keyboard:activity', handleKeyboardActivity);
    }

    return () => {
      if (window.electron) {
        window.electron.removeListener('keyboard:activity', handleKeyboardActivity);
      }
    };
  }, []);

  // 发呆检测 (MVP: 鼠标不动 5 秒)
  useEffect(() => {
    if (flowState === 'working' && mouseIdleTime > IDLE_DETECTION_THRESHOLD && !isKeyboardActive) {
      setShowIdlePrompt(true);
      setAvatarState('focus'); // 抬头看镜头
      
      // 5 秒后自动隐藏提示
      setTimeout(() => setShowIdlePrompt(false), 5000);
    }
  }, [mouseIdleTime, isKeyboardActive, flowState]);

  // 监听演示快捷键
  useEffect(() => {
    const handleDemoIdle = () => {
      setShowIdlePrompt(true);
      setAvatarState('focus');
      setTimeout(() => {
        setShowIdlePrompt(false);
        setAvatarState(isKeyboardActive ? 'work' : 'idle');
      }, 3000);
    };

    const handleDemoTyping = () => {
      setAvatarState('work');
      setCharsPerMinute(80);
      setWpm(16);
    };

    if (window.electron) {
      window.electron.on('demo:trigger-idle', handleDemoIdle);
      window.electron.on('demo:simulate-typing', handleDemoTyping);
    }

    return () => {
      if (window.electron) {
        window.electron.removeListener('demo:trigger-idle', handleDemoIdle);
        window.electron.removeListener('demo:simulate-typing', handleDemoTyping);
      }
    };
  }, [isKeyboardActive]);

  // 根据感知数据更新数字人状态
  useEffect(() => {
    if (flowState === 'break') {
      setAvatarState('stretch');
    } else if (flowState === 'immunity') {
      // immunity 状态由 shhh 触发器控制
    } else if (showIdlePrompt) {
      setAvatarState('focus');
    } else if (isKeyboardActive) {
      setAvatarState('work');
    } else {
      setAvatarState('idle');
    }
  }, [isKeyboardActive, flowState, showIdlePrompt]);

  // 启动感知
  useEffect(() => {
    startPerception();
    return () => stopPerception();
  }, [startPerception, stopPerception]);

  // 进入工作状态
  const enterWorkState = useCallback(() => {
    setFlowState('working');
  }, []);

  // 进入心流豁免
  const enterImmunity = useCallback(() => {
    setFlowState('immunity');
  }, []);

  // 开始休息
  const takeBreak = useCallback(() => {
    setFlowState('break');
    setAvatarState('stretch');
  }, []);

  // 结束休息
  const endBreak = useCallback(() => {
    setFlowState('idle');
    setAvatarState('idle');
  }, []);

  // 触发嘘动画
  const triggerShhh = useCallback(() => {
    setAvatarState('shhh');
    
    // 3 秒后切回工作状态
    if (shhhTimeoutRef.current) {
      clearTimeout(shhhTimeoutRef.current);
    }
    shhhTimeoutRef.current = setTimeout(() => {
      setAvatarState('work');
    }, 3000);
  }, []);

  // 窗口控制
  const handleMinimize = () => {
    window.electron?.invoke('window:minimize');
  };

  const handleClose = () => {
    window.electron?.invoke('window:close');
  };

  return (
    <div className="app-container">
      {/* 标题栏 */}
      <div className="title-bar">
        <span className="title">FlowMate-Echo</span>
        <div className="window-controls">
          <button className="minimize-btn" onClick={handleMinimize}>-</button>
          <button className="close-btn" onClick={handleClose}>×</button>
        </div>
      </div>

      {/* 数字人视频 */}
      <VideoAvatar state={avatarState} />

      {/* 发呆提示 */}
      {showIdlePrompt && (
        <div className="idle-prompt">
          <span>卡住了吗？需要帮忙吗？</span>
        </div>
      )}

      {/* 心流计时器 */}
      <FlowTimer
        flowState={flowState}
        wpm={wpm}
        charsPerMinute={charsPerMinute}
        onFlowEnter={enterWorkState}
        onImmunityEnter={enterImmunity}
        onBreakStart={takeBreak}
        onBreakEnd={endBreak}
        onShhhTrigger={triggerShhh}
      />

      {/* 任务面板切换按钮 */}
      <button
        className="task-toggle-btn"
        onClick={() => setShowTaskPanel(!showTaskPanel)}
      >
        {showTaskPanel ? '收起任务' : '展开任务'}
      </button>

      {/* 任务面板 */}
      {showTaskPanel && (
        <TaskPanel
          onGenerateTasks={generateTasks}
          isLoading={isLoading}
        />
      )}

      {/* 状态指示器 */}
      <div className="status-indicator">
        <span className={`status-dot ${flowState}`} />
        <span className="status-text">
          {flowState === 'idle' && '待机中'}
          {flowState === 'working' && '工作中'}
          {flowState === 'flow' && '心流状态'}
          {flowState === 'immunity' && '心流保护'}
          {flowState === 'break' && '休息中'}
        </span>
        {flowState === 'working' && (
          <span className="wpm-display">{charsPerMinute} 字符/分</span>
        )}
      </div>

      {/* 演示快捷键提示 (开发模式) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="demo-shortcuts-hint">
          <small>
            演示快捷键: Ctrl+Shift+1 (跳到结束) | Ctrl+Shift+2 (模拟打字) | Ctrl+Shift+3 (触发发呆) | Ctrl+Shift+4 (触发嘘)
          </small>
        </div>
      )}
    </div>
  );
};

export default App;
