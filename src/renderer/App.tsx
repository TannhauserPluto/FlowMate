import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import UiScaleFrame from './components/UiScaleFrame';
import VoiceInput from './components/VoiceInput';
import ActionFloatingBtn from './components/ActionFloatingBtn';
import imgAudioWave from './assets/figma/audio-wave.png';
import imgPlusMath from './assets/figma/plus.png';
import imgGemini from './assets/figma/gemini.png';
import imgMute from './assets/figma/mute.png';
import imgInnerBg from './assets/figma/inner-bg.png';
import imgNavAvatar from './assets/figma/nav-avatar.png';
import imgInnerBgTask from './assets/figma/inner-bg-task.png';
import TimeWheelPicker, { TimeWheelValue } from './components/TimeWheelPicker';
import imgStars from './assets/figma/star.png';
import imgJourneyLineGraph from './assets/figma/journey-line-graph.png';
import starLv0 from './assets/star/star-lv0.png';
import starLv1 from './assets/star/star-lv1.png';
import starLv2 from './assets/star/star-lv2.png';
import starLv3 from './assets/star/stat-lv3.png';
import starLv4 from './assets/star/star-lv4.png';


type View = 'home' | 'task' | 'timer' | 'focus' | 'profile';
type ProfileTab = 'day' | 'month' | 'year';
type PrimaryView = Exclude<View, 'profile'>;

type TodoItem = {
  id: string;
  text: string;
};

const STAR_LEVELS = '32234312210322320'.split('').map((value) => Number.parseInt(value, 10));
const STAR_LEVEL_IMAGES = [starLv0, starLv1, starLv2, starLv3, starLv4];
const TIMER_WHEEL_SIZE = {
  viewHeight: 140,
  itemHeight: 116,
  columnWidth: 46,
  separatorHeight: 56,
};

const toTotalSeconds = (value: TimeWheelValue) =>
  value.hour * 3600
  + (value.minuteTens * 10 + value.minuteOnes) * 60
  + value.secondTens * 10
  + value.secondOnes;

const toTimeWheelValue = (totalSeconds: number): TimeWheelValue => {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  return {
    hour: Math.min(5, hours),
    minuteTens: Math.floor(minutes / 10),
    minuteOnes: minutes % 10,
    secondTens: Math.floor(seconds / 10),
    secondOnes: seconds % 10,
  };
};


const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('home');
  const [profileTab, setProfileTab] = useState<ProfileTab>('day');
  const returnViewRef = useRef<PrimaryView>('home');
  const primaryView: PrimaryView = currentView === 'profile' ? returnViewRef.current : currentView;
  const isTaskRunning = primaryView === 'task';
  const isFocusView = primaryView === 'focus';
  const isTimerView = primaryView === 'timer' || isFocusView;
  const [isFocusRunning, setIsFocusRunning] = useState(false);
  const [timerValue, setTimerValue] = useState<TimeWheelValue>({
    hour: 0,
    minuteTens: 2,
    minuteOnes: 5,
    secondTens: 0,
    secondOnes: 0,
  });
  const [remainingSeconds, setRemainingSeconds] = useState(() => toTotalSeconds(timerValue));
  const countdownRef = useRef<number | null>(null);

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
    if (currentView !== 'task') setCurrentView('task');
  };

  const toggleProfilePanel = () => {
    if (currentView === 'profile') {
      setCurrentView(returnViewRef.current);
      return;
    }
    setProfileTab('day');
    returnViewRef.current = currentView as PrimaryView;
    setCurrentView('profile');
  };

  const handleGoToTimerConfig = () => {
    setCurrentView('timer');
  };

  const handleStartFocus = () => {
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setRemainingSeconds(toTotalSeconds(timerValue));
    setIsFocusRunning(true);
    setCurrentView('focus');
  };

  const handlePauseFocus = () => {
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
      setIsFocusRunning(false);
    } else if (remainingSeconds > 0) {
      setIsFocusRunning(true);
    }
  };

  const handleEndFocus = () => {
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setIsFocusRunning(false);
    setCurrentView('timer');
  };

  const handleWindowMinimize = () => {
    (window as any).electron?.invoke('window:minimize').catch(() => {});
  };

  const handleWindowClose = () => {
    (window as any).electron?.invoke('window:close').catch(() => {});
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

  useEffect(() => {
    if (!isFocusRunning) return;
    if (countdownRef.current) return;

    countdownRef.current = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) {
            window.clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          setIsFocusRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [isFocusRunning]);

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


  const focusValue = useMemo(() => toTimeWheelValue(remainingSeconds), [remainingSeconds]);

  return (
    <div className="app-shell">
      <div className={`app-layout ${currentView === 'profile' ? 'is-profile' : ''}`}>
        <UiScaleFrame>
          <div
            className={`window ${isTaskRunning ? 'is-task-running' : ''} ${isTimerView ? 'is-timer-view' : ''} ${isFocusView ? 'is-focus-view' : ''} ${currentView === 'profile' ? 'is-profile-view' : ''}`}
            data-name="Window"
            data-node-id="240:213"
          >
            <div className="nav-bar" data-name="Navigation Bar" data-node-id="403:419">
              <div className="nav-left" data-node-id="304:291">
                <button
                  type="button"
                  className="nav-avatar"
                  data-name="Avatar"
                  data-node-id="304:280"
                  onClick={toggleProfilePanel}
                  aria-label="User profile"
                >
                  <img src={imgNavAvatar} alt="" />
                </button>
                <div className="nav-title" data-node-id="304:272">
                  FlowMate
                </div>
              </div>
              <div className="nav-actions" data-node-id="400:266">
                <button type="button" className="nav-action" aria-label="Minimize" onClick={handleWindowMinimize}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <line x1="6" y1="12" x2="18" y2="12" />
                  </svg>
                </button>
                <button type="button" className="nav-action" aria-label="Close" onClick={handleWindowClose}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <line x1="7" y1="7" x2="17" y2="17" />
                    <line x1="17" y1="7" x2="7" y2="17" />
                  </svg>
                </button>
              </div>
            </div>
            {currentView === 'profile' ? (
              <div className="profile-view" role="region" aria-label="User profile">
                <div className="profile-panel__card glass-widget glass-widget--border glass-widget-surface">
                  <div className="profile-top">
                    <div className="profile-tabs">
                      <button
                        type="button"
                        className={`profile-tab ${profileTab === 'day' ? 'is-active' : ''}`}
                        onClick={() => setProfileTab('day')}
                      >
                        日
                      </button>
                      <button
                        type="button"
                        className={`profile-tab ${profileTab === 'month' ? 'is-active' : ''}`}
                        onClick={() => setProfileTab('month')}
                      >
                        月
                      </button>
                      <button
                        type="button"
                        className={`profile-tab ${profileTab === 'year' ? 'is-active' : ''}`}
                        onClick={() => setProfileTab('year')}
                      >
                        年
                      </button>
                    </div>
                    <div className="profile-filters">
                      <label className="profile-filter">
                        <span className="profile-filter__dot is-on" />
                        已完成
                      </label>
                      <label className="profile-filter">
                        <span className="profile-filter__dot" />
                        未完成
                      </label>
                    </div>
                  </div>
                  {profileTab === 'month' ? (
                    <div className="profile-month">
                      <p className="profile-month-date">
                        <span className="profile-month-date__year">2026.</span>
                        <span className="profile-month-date__month">1月</span>
                      </p>
                      <div className="profile-card profile-card--progress profile-month-progress">
                        <div className="profile-card__title">完成率</div>
                        <div className="profile-card__value">84%</div>
                      </div>
                      <div className="profile-card profile-card--chart profile-month-chart">
                        <img className="profile-chart-image" src={imgJourneyLineGraph} alt="" />
                      </div>
                      <div className="profile-month-grid">
                        {[
                          { day: 1, label: 'SUN' },
                          { day: 2, label: 'MON' },
                          { day: 3, label: 'TUE' },
                          { day: 4, label: 'WED' },
                          { day: 5, label: 'THU' },
                          { day: 6, label: 'FRI' },
                          { day: 7, label: 'SAT' },
                          { day: 8 },
                          { day: 9 },
                          { day: 10 },
                          { day: 11 },
                          { day: 12 },
                          { day: 13 },
                          { day: 14 },
                          { day: 15 },
                          { day: 16 },
                          { day: 17 },
                          { day: 18 },
                          { day: 19 },
                          { day: 20 },
                          { day: 21 },
                          { day: 22 },
                          { day: 23 },
                          { day: 24 },
                          { day: 25 },
                          { day: 26 },
                          { day: 27 },
                          { day: 28 },
                          { day: 29 },
                          { day: 30 },
                          { day: 31 },
                          { day: 1, dim: true, isNextMonth: true },
                          { day: 2, dim: true, isNextMonth: true },
                          { day: 3, dim: true, isNextMonth: true },
                          { day: 4, dim: true, isNextMonth: true },
                        ].map((item, index) => {
                          const level = item.isNextMonth
                            ? null
                            : (item.day - 1 < STAR_LEVELS.length ? STAR_LEVELS[item.day - 1] : null);
                          const starImage = level === null ? null : (STAR_LEVEL_IMAGES[level] || STAR_LEVEL_IMAGES[0]);
                          return (
                            <div
                              key={`${item.day}-${index}`}
                              className={`profile-month-cell ${item.dim ? 'is-dim' : ''}`}
                            >
                              {item.label && <span className="profile-month-cell__label">{item.label}</span>}
                              <span className="profile-month-cell__day">{item.day}</span>
                              {starImage && (
                                <img className="profile-month-cell__icon" src={starImage} alt="" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="profile-grid">
                      <div className="profile-card profile-card--progress">
                        <div className="profile-card__title">完成率</div>
                        <div className="profile-card__value">87%</div>
                      </div>
                      <div className="profile-card profile-card--stars">
                        <div className="profile-card__stars">
                          <img src={imgStars} alt="" />
                        </div>
                      </div>
                      <div className="profile-card profile-card--list profile-card--primary">
                        <div className="profile-card__status profile-card__status--done">☑️已完成</div>
                        <div className="profile-card__section">
                          <div className="profile-card__section-title">数字媒体论文</div>
                          <ul className="profile-list">
                            <li><span className="profile-dot" /> ip形象</li>
                            <li><span className="profile-dot" /> 头脑风暴 3–5 个方案</li>
                            <li><span className="profile-dot" /> 商业计划</li>
                          </ul>
                        </div>
                        <div className="profile-card__divider" />
                        <div className="profile-card__section">
                          <div className="profile-card__section-title">学校相关</div>
                          <ul className="profile-list">
                            <li><span className="profile-dot" /> 假期返乡计划表</li>
                            <li><span className="profile-dot" /> 毕设任务书</li>
                          </ul>
                        </div>
                      </div>
                      <div className="profile-card profile-card--list profile-card--secondary">
                        <div className="profile-card__status profile-card__status--todo">
                          <span className="profile-status-dot" />
                          未完成
                        </div>
                        <div className="profile-card__section">
                          <div className="profile-card__section-title">学校相关</div>
                          <ul className="profile-list">
                            <li><span className="profile-dot" /> 假期劳务活动报名</li>
                            <li><span className="profile-dot" /> 联系毕设老师</li>
                          </ul>
                        </div>
                      </div>
                      <div className="profile-card profile-card--chart">
                        <img className="profile-chart-image" src={imgJourneyLineGraph} alt="" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="inner-window" data-name="内窗" data-node-id="262:219">
                <img className="inner-bg" src={imgInnerBg} alt="" />
                <div className="inner-gradient" aria-hidden="true" />
                <div className="left-pane" data-name="左侧" data-node-id="262:230">
                  <div className="left-pane-bg" aria-hidden="true">
                    <img className="left-pane-bg-image" src={imgInnerBgTask} alt="" />
                    <div className="left-pane-bg-gradient" />
                  </div>
                  <div className="countdown">
                    <TimeWheelPicker
                      value={timerValue}
                      onChange={setTimerValue}
                      interactive={isTaskRunning}
                    />
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
                  {isTimerView ? (
                    <div className={`timer-countdown ${isFocusView ? 'is-running' : ''}`}>
                      <TimeWheelPicker
                        value={isFocusView ? focusValue : timerValue}
                        onChange={isFocusView ? undefined : setTimerValue}
                        interactive={!isFocusView}
                        animate={isFocusView}
                        size={isFocusView ? TIMER_WHEEL_SIZE : undefined}
                      />
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                  {isFocusView && (
                    <VoiceInput
                      placeholder="今天要完成什么呢？"
                      plusIcon={imgPlusMath}
                      audioIcon={imgAudioWave}
                    />
                  )}
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
            )}
          </div>
        </UiScaleFrame>
        <ActionFloatingBtn
          currentView={primaryView}
          onGoToTimerConfig={handleGoToTimerConfig}
          onStartWork={handleStartFocus}
          onPause={handlePauseFocus}
          onEnd={handleEndFocus}
          isFocusRunning={isFocusRunning}
        />
      </div>
    </div>
  );
};

export default App;
