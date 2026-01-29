import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import UiScaleFrame from './components/UiScaleFrame';
import VoiceInput from './components/VoiceInput';
import imgAudioWave from './assets/figma/audio-wave.png';
import imgPlusMath from './assets/figma/plus.png';
import imgGemini from './assets/figma/gemini.png';
import imgMute from './assets/figma/mute.png';
import imgInnerBg from './assets/figma/inner-bg.png';
import imgNavAvatar from './assets/figma/nav-avatar.png';
import imgInnerBgTask from './assets/figma/inner-bg-task.png';
import TimeWheelPicker from './components/TimeWheelPicker';


type TodoItem = {
  id: string;
  text: string;
};

const App: React.FC = () => {
  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([
    { id: 'todo-1', text: '明确论文基本信息' },
    { id: 'todo-2', text: '头脑风暴 3–5 个可写选题' },
    { id: 'todo-3', text: '搜索并筛选文献' },
  ]);
  const [doneItems, setDoneItems] = useState<TodoItem[]>([]);
  const [transitioning, setTransitioning] = useState<Record<string, 'toDone' | 'toTodo'>>({});

  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const todoRefs = useRef(new Map<string, HTMLLIElement>());
  const doneRefs = useRef(new Map<string, HTMLLIElement>());
  const todoPositions = useRef(new Map<string, DOMRect>());
  const donePositions = useRef(new Map<string, DOMRect>());

  const activateTaskRunning = () => {
    if (!isTaskRunning) setIsTaskRunning(true);
  };

  const animateList = (
    items: TodoItem[],
    refs: React.MutableRefObject<Map<string, HTMLLIElement>>,
    positions: React.MutableRefObject<Map<string, DOMRect>>,
  ) => {
    const nextPositions = new Map<string, DOMRect>();
    items.forEach((item) => {
      const node = refs.current.get(item.id);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      nextPositions.set(item.id, rect);
      const prev = positions.current.get(item.id);
      if (prev) {
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;
        if (dx !== 0 || dy !== 0) {
          node.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'translate(0, 0)' },
            ],
            { duration: 220, easing: 'cubic-bezier(0.2, 0, 0.2, 1)' },
          );
        }
      }
    });
    positions.current = nextPositions;
  };

  useLayoutEffect(() => {
    animateList(todoItems, todoRefs, todoPositions);
  }, [todoItems]);

  useLayoutEffect(() => {
    animateList(doneItems, doneRefs, donePositions);
  }, [doneItems]);

  useEffect(() => {
    if (isTaskRunning) {
      taskInputRef.current?.focus();
    }
  }, [isTaskRunning]);

  const markTodoDone = (id: string) => {
    if (transitioning[id]) return;
    const item = todoItems.find((todo) => todo.id === id);
    if (!item) return;
    if (doneItems.some((todo) => todo.id === id)) return;

    setTransitioning((prev) => ({ ...prev, [id]: 'toDone' }));
    window.setTimeout(() => {
      setTodoItems((prevTodos) => prevTodos.filter((todo) => todo.id !== id));
      setDoneItems((prevDone) => [...prevDone.filter((todo) => todo.id !== id), item]);
      setTransitioning((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 220);
  };

  const restoreTodo = (id: string) => {
    if (transitioning[id]) return;
    const item = doneItems.find((todo) => todo.id === id);
    if (!item) return;
    if (todoItems.some((todo) => todo.id === id)) return;

    setTransitioning((prev) => ({ ...prev, [id]: 'toTodo' }));
    window.setTimeout(() => {
      setDoneItems((prevDone) => prevDone.filter((todo) => todo.id !== id));
      setTodoItems((prevTodos) => [...prevTodos.filter((todo) => todo.id !== id), item]);
      setTransitioning((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, 220);
  };

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
              <div className="countdown">
                <TimeWheelPicker />
              </div>
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
                    <div className="chat-bubble chat-bubble-user chat-bubble-glass glass-widget glass-widget--border glass-widget-surface">
                      我需要写一篇关于数字媒体交互的论文
                    </div>
                    <div className="chat-bubble chat-bubble-assistant">
                      根据任务难度和任务截止时间，你还有7天完成这个论文，以下是我对你的任务规划，已帮你同步到Todo-list
                      <span className="chat-bubble-assistant-secondary">好的！已经充分了解！</span>
                    </div>
                  </div>
                  <div className="todo-card">
                    <div className="todo-meta">
                      <span className="todo-date">1/26/2026</span>
                      <span className="todo-project">数字媒体论文</span>
                    </div>
                    <div className="todo-title-row">TO DO</div>
                    <ul className="todo-list todo-list--todo">
                      {todoItems.map((item) => {
                        const transition = transitioning[item.id];
                        return (
                          <li
                            key={item.id}
                            ref={(node) => {
                              if (node) {
                                todoRefs.current.set(item.id, node);
                              } else {
                                todoRefs.current.delete(item.id);
                              }
                            }}
                            className={`todo-item ${transition === 'toDone' ? 'is-completing' : ''}`}
                          >
                            <button
                              className="todo-check"
                              type="button"
                              aria-label="Mark done"
                              onClick={() => markTodoDone(item.id)}
                            >
                              <span className="todo-check-circle" />
                            </button>
                            <span className="todo-text">{item.text}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="todo-divider" />
                    <div className="todo-title-row todo-title-done">DONE</div>
                    <ul className="todo-list todo-list--done">
                      {doneItems.map((item) => {
                        const transition = transitioning[item.id];
                        return (
                          <li
                            key={item.id}
                            ref={(node) => {
                              if (node) {
                                doneRefs.current.set(item.id, node);
                              } else {
                                doneRefs.current.delete(item.id);
                              }
                            }}
                            className={`todo-item is-done ${transition === 'toTodo' ? 'is-restoring' : ''}`}
                          >
                            <button
                              className="todo-check"
                              type="button"
                              aria-label="Restore"
                              onClick={() => restoreTodo(item.id)}
                            >
                              <span className="todo-check-circle" />
                            </button>
                            <span className="todo-text">{item.text}</span>
                          </li>
                        );
                      })}
                    </ul>
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
