import React, { useState, useEffect, useCallback, useRef } from 'react';
import VideoAvatar from './components/VideoAvatar';
import TaskPanel from './components/TaskPanel';
import ChatPanel from './components/ChatPanel';
import FlowTimer from './components/FlowTimer';
import { usePerception } from './hooks/usePerception';
import { useFlowAI } from './hooks/useFlowAI';

// 数字人状态类型
type AvatarState = 'idle' | 'work' | 'focus' | 'shhh' | 'stretch';

// 心流状态类型
type FlowState = 'idle' | 'working' | 'flow' | 'immunity' | 'break';

// 面板类型
type PanelType = 'none' | 'task' | 'chat';

// 发呆检测阈值 (毫秒)
const IDLE_DETECTION_THRESHOLD = 5000;

const App: React.FC = () => {
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [activePanel, setActivePanel] = useState<PanelType>('none');
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
  const { 
    decomposeTasks,
    chat,
    clearChat,
    isLoading, 
    isChatLoading,
    messages,
  } = useFlowAI();

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
      setAvatarState('focus');
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
    
    if (shhhTimeoutRef.current) {
      clearTimeout(shhhTimeoutRef.current);
    }
    shhhTimeoutRef.current = setTimeout(() => {
      setAvatarState('work');
    }, 3000);
  }, []);

  // 任务全部完成时的回调
  const handleAllTasksCompleted = useCallback(async () => {
    // 自动发送完成消息给 FlowMate
    await chat('我做完了！');
  }, [chat]);

  // 切换面板
  const togglePanel = (panel: PanelType) => {
    setActivePanel(prev => prev === panel ? 'none' : panel);
  };

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
        <span className="title">FlowMate</span>
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

      {/* 面板切换按钮 */}
      <div className="panel-toggle-btns">
        <button
          className={`panel-btn ${activePanel === 'task' ? 'active' : ''}`}
          onClick={() => togglePanel('task')}
        >
          任务拆解
        </button>
        <button
          className={`panel-btn ${activePanel === 'chat' ? 'active' : ''}`}
          onClick={() => togglePanel('chat')}
        >
          聊天
        </button>
      </div>

      {/* 任务面板 */}
      {activePanel === 'task' && (
        <TaskPanel
          onGenerateTasks={decomposeTasks}
          isLoading={isLoading}
          onAllTasksCompleted={handleAllTasksCompleted}
        />
      )}

      {/* 聊天面板 */}
      {activePanel === 'chat' && (
        <ChatPanel
          messages={messages}
          onSendMessage={chat}
          isLoading={isChatLoading}
          onClearChat={clearChat}
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
    </div>
  );
};

export default App;
