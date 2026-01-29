import React, { useEffect, useRef, useState } from 'react';
import UiScaleFrame from './components/UiScaleFrame';
import VoiceInput from './components/VoiceInput';
import imgAudioWave from './assets/figma/audio-wave.png';
import imgPlusMath from './assets/figma/plus.png';
import imgGemini from './assets/figma/gemini.png';
import imgMute from './assets/figma/mute.png';
import imgInnerBg from './assets/figma/inner-bg.png';
import imgNavAvatar from './assets/figma/nav-avatar.png';
import imgInnerBgTask from './assets/figma/inner-bg-task.png';
import imgTodoDot from './assets/figma/todo-dot.png';
import imgTodoLine from './assets/figma/todo-line.png';

const App: React.FC = () => {
  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const taskInputRef = useRef<HTMLInputElement | null>(null);

  const activateTaskRunning = () => {
    if (!isTaskRunning) setIsTaskRunning(true);
  };

  useEffect(() => {
    if (isTaskRunning) {
      taskInputRef.current?.focus();
    }
  }, [isTaskRunning]);

  return (
    <div className="app-shell">
      <UiScaleFrame>
        <div
          className={`window ${isTaskRunning ? 'is-task-running' : ''}`}
          data-name="Window"
          data-node-id="240:213"
        >
          <div className="nav-bar" data-name="Navigation Bar" data-node-id="235:2089">
            <div className="nav-title" data-node-id="I235:2089;127:82612">
              FlowMate
            </div>
            <div className="nav-avatar" data-name="Icons - Avatar" data-node-id="I235:2089;127:82627">
              <img src={imgNavAvatar} alt="" />
            </div>
          </div>
          <div className="inner-window" data-name="内窗" data-node-id="262:219">
            <img className="inner-bg" src={imgInnerBg} alt="" />
            <div className="inner-gradient" aria-hidden="true" />
            <div className="left-pane" data-name="左侧" data-node-id="262:230">
              <div className="left-pane-bg" aria-hidden="true">
                <img className="left-pane-bg-image" src={imgInnerBgTask} alt="" />
                <div className="left-pane-bg-gradient" />
              </div>
              <div className="countdown">0:25:00</div>
              <div className="avatar-image" data-name="Gemini" data-node-id="262:231">
                <img src={imgGemini} alt="" />
              </div>
              <button className="mute-button" type="button" data-node-id="262:232">
                <span className="mute-button-bg glass-widget glass-widget--border glass-widget-surface" aria-hidden="true" />
                <span className="mute-icon">
                  <img src={imgMute} alt="" />
                </span>
              </button>
            </div>
            <div className="right-pane" data-name="右侧" data-node-id="262:220">
              <p className="headline" data-node-id="262:229">
                让我来拆解你的任务吧～
              </p>
              <VoiceInput
                placeholder="今天要完成什么呢？"
                plusIcon={imgPlusMath}
                audioIcon={imgAudioWave}
                onActivate={activateTaskRunning}
                onFocusCapture={activateTaskRunning}
              />
            </div>
            <div className="task-panel" data-name="对话" data-node-id="310:264">
              <div className="task-panel-content">
                <div className="task-scroll">
                  <div className="chat-block">
                    <div className="chat-bubble chat-bubble-user">
                      我需要写一篇关于数字媒体交互的论文
                    </div>
                    <div className="chat-bubble chat-bubble-assistant">
                      根据任务难度和任务截止时间，你还有7天完成这个论文，以下是我对你的任务规划，已帮你同步到Todo-list
                      <span className="chat-bubble-assistant-secondary">好的！已经充分了解！</span>
                    </div>
                  </div>
                  <div className="todo-card">
                    <div className="todo-header">
                      <div className="todo-date">1/26/2026</div>
                      <div className="todo-title">TO DO</div>
                      <div className="todo-title todo-title-done">DONE</div>
                      <div className="todo-project">数字媒体论文</div>
                    </div>
                    <div className="todo-body">
                      <div className="todo-line">
                        <img src={imgTodoLine} alt="" />
                      </div>
                      <ul className="todo-list">
                        <li>
                          <img src={imgTodoDot} alt="" />
                          明确论文基本信息
                        </li>
                        <li>
                          <img src={imgTodoDot} alt="" />
                          头脑风暴 3–5 个可写选题
                        </li>
                        <li>
                          <img src={imgTodoDot} alt="" />
                          搜索并筛选文献
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div className="task-input">
                  <VoiceInput
                    ref={taskInputRef}
                    placeholder="今天要完成什么呢？"
                    plusIcon={imgPlusMath}
                    audioIcon={imgAudioWave}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </UiScaleFrame>
    </div>
  );
};

export default App;



