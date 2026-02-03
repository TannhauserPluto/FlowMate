import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import UiScaleFrame from './components/UiScaleFrame';
import VoiceInput from './components/VoiceInput';
import ActionFloatingBtn from './components/ActionFloatingBtn';
import imgAudioWave from './assets/figma/audio-wave.png';
import imgPlusMath from './assets/figma/plus.png';
import imgMute from './assets/figma/mute.png';
import imgInnerBg from './assets/figma/inner-bg.png';
import imgNavAvatar from './assets/figma/nav-avatar.png';
import imgInnerBgTask from './assets/figma/inner-bg-task.png';
import imgStarBlink from './assets/figma/starblink.png';
import TimeWheelPicker, { TimeWheelValue } from './components/TimeWheelPicker';
import imgStars from './assets/figma/star.png';
import imgJourneyLineGraph from './assets/figma/Journey-line-graph.png';
import starLv0 from './assets/star/star-lv0.png';
import starLv1 from './assets/star/star-lv1.png';
import starLv2 from './assets/star/star-lv2.png';
import starLv3 from './assets/star/stat-lv3.png';
import starLv4 from './assets/star/star-lv4.png';
import vidIdle from './assets/video_loops/idle.webm';
import vidTalk from './assets/video_loops/talk.webm';
import vidFocus from './assets/video_loops/focus.webm';
import vidStretch from './assets/video_loops/Stretch.webm';


type View = 'home' | 'task' | 'timer' | 'focus' | 'break' | 'profile';
type ProfileTab = 'day' | 'month' | 'year';
type PrimaryView = Exclude<View, 'profile'>;

type TodoItem = {
  id: string;
  text: string;
};

type TaskBoard = {
  id: string;
  title: string;
  date: string;
  todoItems: TodoItem[];
  doneItems: TodoItem[];
};

type TaskTimelineItem =
  | { type: 'message'; id: string }
  | { type: 'board'; id: string };

type TaskMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

const DEFAULT_CHAT_USER_TEXT = '我需要写一篇关于数字媒体交互的论文';
const DEFAULT_CHAT_ASSISTANT_TEXT =
  '根据任务难度和任务截止时间，你还有7天完成这个论文，以下是我对你的任务规划，已帮你同步到Todo-list';
const HOME_WELCOME_TEXT =
  '你好呀，我是 FlowMate，你的心流维护小助手。你可以在输入框告诉我今天要完成的事，我会帮你拆解成待办；也可以点击麦克风直接说话。想进入专注计时就点下方的“番茄钟”，头像页可以查看进度。现在告诉我你的任务吧。';
const DEFAULT_TASK_TITLE = '数字媒体论文';
const DEFAULT_TODO_TEXTS = [
  '明确论文基本信息',
  '头脑风暴 3–5 个可写选题',
  '搜索并筛选文献',
];
const BREAK_DEFAULT_SECONDS = 5 * 60;
const BREAK_DEFAULT_MESSAGE = '恭喜你完成专注，休息五分钟吧';
const createBoardId = () => `board-${Date.now()}`;
const buildDefaultTodos = (seed = Date.now()) =>
  DEFAULT_TODO_TEXTS.map((text, index) => ({ id: `todo-${seed}-${index}`, text }));

const STAR_LEVELS = '32234312210322320'.split('').map((value) => Number.parseInt(value, 10));
const STAR_LEVEL_IMAGES = [starLv0, starLv1, starLv2, starLv3, starLv4];
const TIMER_WHEEL_SIZE = {
  viewHeight: 140,
  itemHeight: 116,
  columnWidth: 46,
  separatorHeight: 56,
};
const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/$/, '');
const sanitizeText = (text: string) =>
  text
    .replace(/<\|.*?\|>/g, '')
    .replace(/<Speech\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const DEFAULT_BUBBLE_FONT =
  "400 12.183px/1.6 'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
const DEFAULT_BUBBLE_TEXT_WIDTH = 228;
let bubbleMetricsCache: { font: string; maxTextWidth: number } | null = null;
let measureContext: CanvasRenderingContext2D | null = null;

const getTextMeasureContext = () => {
  if (measureContext) return measureContext;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  measureContext = canvas.getContext('2d');
  return measureContext;
};

const getBubbleMetrics = () => {
  if (bubbleMetricsCache) return bubbleMetricsCache;
  if (typeof document === 'undefined' || !document.body) {
    bubbleMetricsCache = {
      font: DEFAULT_BUBBLE_FONT,
      maxTextWidth: DEFAULT_BUBBLE_TEXT_WIDTH,
    };
    return bubbleMetricsCache;
  }
  const probe = document.createElement('span');
  probe.className = 'home-chat-bubble chat-bubble';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.whiteSpace = 'pre';
  probe.style.top = '-9999px';
  probe.textContent = 'M';
  document.body.appendChild(probe);
  const style = window.getComputedStyle(probe);
  const font = `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
  const maxWidth = Number.parseFloat(style.maxWidth || '');
  const paddingLeft = Number.parseFloat(style.paddingLeft || '');
  const paddingRight = Number.parseFloat(style.paddingRight || '');
  const padding = (Number.isFinite(paddingLeft) ? paddingLeft : 0)
    + (Number.isFinite(paddingRight) ? paddingRight : 0);
  const maxTextWidth = Number.isFinite(maxWidth) && maxWidth > 0
    ? Math.max(0, maxWidth - padding)
    : DEFAULT_BUBBLE_TEXT_WIDTH;
  document.body.removeChild(probe);
  bubbleMetricsCache = { font, maxTextWidth };
  return bubbleMetricsCache;
};

const wrapLineByWidth = (
  line: string,
  maxWidth: number,
  ctx: CanvasRenderingContext2D,
) => {
  if (!line) return [''];
  const result: string[] = [];
  let current = '';
  for (const char of line) {
    const next = current + char;
    if (ctx.measureText(next).width > maxWidth && current) {
      result.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) result.push(current);
  return result;
};

const wrapTextByWidth = (text: string) => {
  if (!text) return '';
  const ctx = getTextMeasureContext();
  const { font, maxTextWidth } = getBubbleMetrics();
  if (!ctx || !maxTextWidth) return text;
  ctx.font = font;
  return text
    .split('\n')
    .flatMap((line) => wrapLineByWidth(line, maxTextWidth, ctx))
    .join('\n');
};
const safeJsonParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const getBeijingDate = () =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date());

const summarizeTopic = (userText: string, tasks: string[]) => {
  const combined = `${userText} ${tasks.join(' ')}`;
  const has = (keyword: string) => combined.includes(keyword);
  if (has('雅思') && has('听力')) return '雅思听力复习';
  if (has('雅思') && has('口语')) return '雅思口语练习';
  if (has('雅思') && has('阅读')) return '雅思阅读复习';
  if (has('雅思')) return '雅思复习';
  if (has('论文')) return '论文任务';
  if (has('考研')) return '考研复习';
  if (has('项目')) return '项目任务';
  const fallback = sanitizeText(userText || tasks[0] || '任务');
  if (!fallback) return '任务';
  return fallback.length > 8 ? `${fallback.slice(0, 8)}...` : fallback;
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
  const [encouragement, setEncouragement] = useState('让我来拆解你的任务吧～');
  const [chatUserText, setChatUserText] = useState(DEFAULT_CHAT_USER_TEXT);
  const [chatAssistantText, setChatAssistantText] = useState(DEFAULT_CHAT_ASSISTANT_TEXT);
  const [homeChatBubble, setHomeChatBubble] = useState('');
  const [speechBubbleText, setSpeechBubbleText] = useState('');
  const initialBoardIdRef = useRef(createBoardId());
  const [taskTitle, setTaskTitle] = useState(DEFAULT_TASK_TITLE);
  const [taskMessages, setTaskMessages] = useState<TaskMessage[]>([]);
  const [isInitialTaskLocked, setIsInitialTaskLocked] = useState(false);
  const [taskDate, setTaskDate] = useState(getBeijingDate());
  const [taskBoards, setTaskBoards] = useState<TaskBoard[]>([]);
  const [activeBoardId, setActiveBoardId] = useState(initialBoardIdRef.current);
  const [taskTimeline, setTaskTimeline] = useState<TaskTimelineItem[]>([
    { type: 'board', id: initialBoardIdRef.current },
  ]);
  const returnViewRef = useRef<PrimaryView>('home');
  const primaryView: PrimaryView = currentView === 'profile' ? returnViewRef.current : currentView;
  const isTaskRunning = primaryView === 'task';
  const isFocusView = primaryView === 'focus';
  const isBreakView = primaryView === 'break';
  const isTimerView = primaryView === 'timer' || isFocusView || isBreakView;
  const isHomeView = primaryView === 'home';
  const [isFocusRunning, setIsFocusRunning] = useState(false);
  const [isCountUp, setIsCountUp] = useState(false);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const [focusTaskText, setFocusTaskText] = useState('');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [isAwaitingRestDecision, setIsAwaitingRestDecision] = useState(false);
  const [breakRemainingSeconds, setBreakRemainingSeconds] = useState(BREAK_DEFAULT_SECONDS);
  const [breakMessage, setBreakMessage] = useState(BREAK_DEFAULT_MESSAGE);
  const breakTimerRef = useRef<number | null>(null);
  const focusSessionIdRef = useRef<string | null>(null);
  const focusTaskTextRef = useRef('');
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenCheckTimeoutRef = useRef<number | null>(null);
  const fatigueTimeoutRef = useRef<number | null>(null);
  const [timerValue, setTimerValue] = useState<TimeWheelValue>({
    hour: 0,
    minuteTens: 2,
    minuteOnes: 5,
    secondTens: 0,
    secondOnes: 0,
  });
  const [remainingSeconds, setRemainingSeconds] = useState(() => toTotalSeconds(timerValue));
  const remainingSecondsRef = useRef(remainingSeconds);
  const countdownRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [homeIdleTick, setHomeIdleTick] = useState(0);
  const recordingHandlerRef = useRef<((blob: Blob) => Promise<void> | void) | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioEventsBoundRef = useRef(false);
  const thinkingCountRef = useRef(0);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const avatarVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastViewRef = useRef<View | null>(null);
  const currentViewRef = useRef<View>(currentView);
  const [breakStretchPlayed, setBreakStretchPlayed] = useState(false);
  const [breakStretchQueued, setBreakStretchQueued] = useState(false);

  const [todoItems, setTodoItems] = useState<TodoItem[]>(() => buildDefaultTodos());
  const [doneItems, setDoneItems] = useState<TodoItem[]>([]);
  const [transitioning, setTransitioning] = useState<Record<string, 'toDone' | 'toTodo'>>({});
  const [archivedTransitions, setArchivedTransitions] = useState<Record<string, 'toDone' | 'toTodo'>>({});

  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const taskScrollRef = useRef<HTMLDivElement | null>(null);
  const finishRequestedRef = useRef(false);
  const todoRefs = useRef(new Map<string, HTMLLIElement>());
  const doneRefs = useRef(new Map<string, HTMLLIElement>());
  const todoPositions = useRef(new Map<string, DOMRect>());
  const donePositions = useRef(new Map<string, DOMRect>());

  const renderTodoCard = (
    board: TaskBoard,
    interactive: boolean,
    onMarkDone: (id: string) => void,
    onRestore: (id: string) => void,
  ) => (
    <div className={`todo-card ${interactive ? '' : 'todo-card--archived'}`}>
      <div className="todo-meta">
        <span className="todo-date">{board.date}</span>
        <span className="todo-project">{board.title}</span>
      </div>
      <div className="todo-title-row">TO DO</div>
      <ul className="todo-list todo-list--todo">
        {board.todoItems.map((item) => {
          const transitionKey = board.id === activeBoardId ? item.id : `${board.id}:${item.id}`;
          const transition = board.id === activeBoardId
            ? transitioning[item.id]
            : archivedTransitions[transitionKey];
          return (
            <li
              key={item.id}
              ref={(node) => {
                if (board.id !== activeBoardId) return;
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
                onClick={() => onMarkDone(item.id)}
                disabled={!interactive}
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
        {board.doneItems.map((item) => {
          const transitionKey = board.id === activeBoardId ? item.id : `${board.id}:${item.id}`;
          const transition = board.id === activeBoardId
            ? transitioning[item.id]
            : archivedTransitions[transitionKey];
          return (
            <li
              key={item.id}
              ref={(node) => {
                if (board.id !== activeBoardId) return;
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
                onClick={() => onRestore(item.id)}
                disabled={!interactive}
              >
                <span className="todo-check-circle" />
              </button>
              <span className="todo-text">{item.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const beginThinking = () => {
    thinkingCountRef.current += 1;
    if (thinkingCountRef.current === 1) {
      setIsThinking(true);
    }
  };

  const endThinking = () => {
    thinkingCountRef.current = Math.max(0, thinkingCountRef.current - 1);
    if (thinkingCountRef.current === 0) {
      setIsThinking(false);
    }
  };

  const markBoardTodoDone = (boardId: string, itemId: string) => {
    const key = `${boardId}:${itemId}`;
    if (archivedTransitions[key]) return;
    setArchivedTransitions((prev) => ({ ...prev, [key]: 'toDone' }));
    window.setTimeout(() => {
      setTaskBoards((prev) => prev.map((board) => {
        if (board.id !== boardId) return board;
        const item = board.todoItems.find((todo) => todo.id === itemId);
        if (!item) return board;
        if (board.doneItems.some((todo) => todo.id === itemId)) return board;
        return {
          ...board,
          todoItems: board.todoItems.filter((todo) => todo.id !== itemId),
          doneItems: [...board.doneItems.filter((todo) => todo.id !== itemId), item],
        };
      }));
      setArchivedTransitions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 220);
  };

  const restoreBoardTodo = (boardId: string, itemId: string) => {
    const key = `${boardId}:${itemId}`;
    if (archivedTransitions[key]) return;
    setArchivedTransitions((prev) => ({ ...prev, [key]: 'toTodo' }));
    window.setTimeout(() => {
      setTaskBoards((prev) => prev.map((board) => {
        if (board.id !== boardId) return board;
        const item = board.doneItems.find((todo) => todo.id === itemId);
        if (!item) return board;
        if (board.todoItems.some((todo) => todo.id === itemId)) return board;
        return {
          ...board,
          doneItems: board.doneItems.filter((todo) => todo.id !== itemId),
          todoItems: [...board.todoItems.filter((todo) => todo.id !== itemId), item],
        };
      }));
      setArchivedTransitions((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 220);
  };

  const getBoardById = (boardId: string): TaskBoard | null => {
    if (boardId === activeBoardId) {
      return {
        id: boardId,
        title: taskTitle,
        date: taskDate,
        todoItems,
        doneItems,
      };
    }
    return taskBoards.find((board) => board.id === boardId) ?? null;
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

  const resetSessionState = () => {
    const newBoardId = createBoardId();
    initialBoardIdRef.current = newBoardId;
    setChatUserText(DEFAULT_CHAT_USER_TEXT);
    setChatAssistantText(DEFAULT_CHAT_ASSISTANT_TEXT);
    setTaskTitle(DEFAULT_TASK_TITLE);
    setTaskMessages([]);
    setIsInitialTaskLocked(false);
    setTaskDate(getBeijingDate());
    setTaskBoards([]);
    setActiveBoardId(newBoardId);
    setTaskTimeline([{ type: 'board', id: newBoardId }]);
    setTodoItems(buildDefaultTodos());
    setDoneItems([]);
    setTransitioning({});
    setArchivedTransitions({});
    setFocusSessionId(null);
    setFocusTaskText('');
    setFocusPrompt('');
    setIsAwaitingRestDecision(false);
    setIsFocusRunning(false);
    setIsCountUp(false);
    setRemainingSeconds(toTotalSeconds(timerValue));
    finishRequestedRef.current = false;
  };

  const enterBreakView = (message?: string) => {
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    resetFocusMonitors();
    setIsFocusRunning(false);
    setIsCountUp(false);
    finishRequestedRef.current = false;
    setFocusSessionId(null);
    setFocusTaskText('');
    setIsAwaitingRestDecision(false);
    const nextMessage = message ?? BREAK_DEFAULT_MESSAGE;
    setBreakMessage(nextMessage);
    setBreakStretchQueued(false);
    setBreakStretchPlayed(false);
    setBreakRemainingSeconds(BREAK_DEFAULT_SECONDS);
    setCurrentView('break');
    speakText(nextMessage);
  };

  const finishBreak = () => {
    if (breakTimerRef.current) {
      window.clearInterval(breakTimerRef.current);
      breakTimerRef.current = null;
    }
    resetSessionState();
    setBreakRemainingSeconds(BREAK_DEFAULT_SECONDS);
    setCurrentView('home');
  };

  const handleSkipBreak = () => {
    finishBreak();
  };

  const handleStartFocus = async () => {
    try {
      await ensureScreenStream();
    } catch (error) {
      console.warn('[focus] screen capture permission denied', error);
    }
    if (primaryView === 'task') {
      try {
        await fetch(`${API_BASE}/brain/audit/reset`, { method: 'POST' });
      } catch {
        // ignore audit reset failure
      }
    }
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    resetFocusMonitors();
    setIsCountUp(false);
    finishRequestedRef.current = false;
    setFocusSessionId(null);
    setFocusTaskText('');
    setIsAwaitingRestDecision(false);
    setRemainingSeconds(toTotalSeconds(timerValue));
    setIsFocusRunning(true);
    setCurrentView('focus');
    const inferredTask = primaryView === 'task' ? (taskTitle || chatUserText) : '';
    if (inferredTask) {
      startFocusSession(inferredTask);
    } else {
      requestFocusPrompt();
    }
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
    enterBreakView();
  };

  const handleWindowMinimize = () => {
    (window as any).electron?.invoke('window:minimize').catch(() => {});
  };

  const handleWindowClose = () => {
    (window as any).electron?.invoke('window:close').catch(() => {});
  };

  const ensureAudioPlayer = () => {
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio();
      audioPlayerRef.current.preload = 'auto';
      audioPlayerRef.current.volume = 1;
    }
    if (audioPlayerRef.current && !audioEventsBoundRef.current) {
      const audio = audioPlayerRef.current;
      audioEventsBoundRef.current = true;
      audio.addEventListener('play', () => setIsAvatarSpeaking(true));
      audio.addEventListener('ended', () => {
        setIsAvatarSpeaking(false);
        if (currentViewRef.current === 'break') {
          setBreakStretchQueued(true);
          setBreakStretchPlayed(false);
        }
      });
      audio.addEventListener('pause', () => {
        if (audio.ended || audio.currentTime === 0) {
          setIsAvatarSpeaking(false);
        }
      });
      audio.addEventListener('error', () => setIsAvatarSpeaking(false));
    }
    return audioPlayerRef.current;
  };

  const setSpeechBubble = (text?: string) => {
    if (!text) return;
    setSpeechBubbleText(wrapTextByWidth(sanitizeText(text)));
  };

  const speakText = async (text: string) => {
    if (!text) return;
    setSpeechBubble(text);
    try {
      const response = await fetch(`${API_BASE}/interaction/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, emotion: 'neutral' }),
      });
      if (!response.ok) return;
      const payload = await response.json();
      playAudioFromBase64(payload?.data?.audio?.base64, payload?.data?.audio?.format);
    } catch {
      // ignore speak errors
    }
  };

  const playAudioFromBase64 = async (base64?: string, format?: string) => {
    if (!base64) return;
    const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    const audio = ensureAudioPlayer();
    const dataUrl = `data:${mime};base64,${base64}`;
    audio.pause();
    audio.currentTime = 0;
    audio.src = dataUrl;
    try {
      await audio.play();
    } catch (error) {
      console.warn('[audio] HTMLAudio (data URL) play failed', error);
    }
  };

  const playAudioFromUrl = async (url?: string) => {
    if (!url) return;
    const audio = ensureAudioPlayer();
    const src = url.startsWith('http')
      ? url
      : url.startsWith('/api')
        ? url
        : `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
    audio.src = src;
    try {
      await audio.play();
    } catch (error) {
      console.warn('[audio] URL play failed', error);
    }
  };

  const resetFocusMonitors = () => {
    if (screenCheckTimeoutRef.current) {
      window.clearTimeout(screenCheckTimeoutRef.current);
      screenCheckTimeoutRef.current = null;
    }
    if (fatigueTimeoutRef.current) {
      window.clearTimeout(fatigueTimeoutRef.current);
      fatigueTimeoutRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    screenVideoRef.current = null;
    screenCanvasRef.current = null;
  };

  const ensureScreenStream = async () => {
    if (
      screenStreamRef.current
      && screenVideoRef.current
      && screenStreamRef.current.active
    ) return;
    const ipcCapture = (window as any).electron?.invoke;
    if (ipcCapture) {
      // In Electron we use main-process capture; no MediaStream needed.
      return;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' } as any,
      audio: false,
    } as any);

    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    screenStreamRef.current = stream;
    screenVideoRef.current = video;
    screenCanvasRef.current = document.createElement('canvas');
  };

  const captureScreenBase64 = async (): Promise<string | null> => {
    const ipcCapture = (window as any).electron?.invoke ? (window as any).electron.invoke : null;
    if (ipcCapture) {
      try {
        const dataUrl = await ipcCapture('screen:capture');
        if (dataUrl) return dataUrl as string;
      } catch (error) {
        console.warn('[focus] ipc screen capture failed', error);
      }
    }
    const video = screenVideoRef.current;
    const canvas = screenCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0 || video.videoHeight === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const scheduleScreenCheck = (delayMs: number) => {
    if (screenCheckTimeoutRef.current) {
      window.clearTimeout(screenCheckTimeoutRef.current);
    }
    screenCheckTimeoutRef.current = window.setTimeout(async () => {
      const sessionId = focusSessionIdRef.current;
      const taskText = focusTaskTextRef.current;
      if (!sessionId || !taskText) {
        requestFocusPrompt();
        return;
      }
      try {
        await ensureScreenStream();
        const image = await captureScreenBase64();
        if (!image) {
          scheduleScreenCheck(8 * 60 * 1000);
          return;
        }
        const response = await fetch(`${API_BASE}/focus/screen-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            image,
            task_text: taskText,
          }),
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data?.reply) {
          setSpeechBubble(data.reply);
        }
        if (data?.audio?.base64) {
          playAudioFromBase64(data.audio.base64, data.audio.format);
        }
        const nextInterval = Number(data?.next_interval_seconds ?? 480) * 1000;
        scheduleScreenCheck(nextInterval);
      } catch (error) {
        console.warn('[focus] screen check failed', error);
      }
    }, delayMs);
  };

  const scheduleFatigueCheck = (delayMs: number) => {
    if (fatigueTimeoutRef.current) {
      window.clearTimeout(fatigueTimeoutRef.current);
    }
    fatigueTimeoutRef.current = window.setTimeout(async () => {
      const sessionId = focusSessionIdRef.current;
      if (!sessionId) return;
      try {
        const response = await fetch(`${API_BASE}/focus/fatigue-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            remaining_seconds: remainingSecondsRef.current,
          }),
        });
        if (!response.ok) return;
        const data = await response.json();
        if (data?.action === 'ask_rest') {
          setIsAwaitingRestDecision(true);
          if (data?.reply) {
            setSpeechBubble(data.reply);
          }
          if (data?.audio?.base64) {
            playAudioFromBase64(data.audio.base64, data.audio.format);
          }
        } else if (data?.action === 'shorten') {
          if (typeof data?.new_remaining_seconds === 'number') {
            setRemainingSeconds(data.new_remaining_seconds);
          }
          if (data?.reply) {
            setSpeechBubble(data.reply);
          }
          if (data?.audio?.base64) {
            playAudioFromBase64(data.audio.base64, data.audio.format);
          }
        }
      } catch (error) {
        console.warn('[focus] fatigue check failed', error);
      } finally {
        if (isFocusRunning) {
          scheduleFatigueCheck(6 * 60 * 1000);
        }
      }
    }, delayMs);
  };

  const requestFocusPrompt = async () => {
    try {
      const response = await fetch(`${API_BASE}/focus/prompt`, { method: 'POST' });
      if (!response.ok) return;
      const data = await response.json();
      if (data?.prompt) {
        setFocusPrompt(data.prompt);
        setSpeechBubble(data.prompt);
      }
      if (data?.audio?.base64) {
        playAudioFromBase64(data.audio.base64, data.audio.format);
      }
    } catch {
      // ignore prompt errors
    }
  };

  const parseRestDecision = (text: string) => {
    const normalized = text.replace(/\s+/g, '');
    if (!normalized) return null;
    if (/(不用|不想|继续|不休息|先不)/.test(normalized)) return false;
    if (/(好|休息|可以|行|嗯|要|好的)/.test(normalized)) return true;
    return null;
  };

  const startFocusSession = async (taskText: string) => {
    const response = await fetch(`${API_BASE}/focus/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_text: taskText,
        duration_seconds: remainingSeconds,
      }),
    });
    if (!response.ok) return;
    const data = await response.json();
    setFocusSessionId(data.session_id);
    focusSessionIdRef.current = data.session_id;
    setFocusTaskText(taskText);
    focusTaskTextRef.current = taskText;
    setIsAwaitingRestDecision(false);
    if (data?.reply) {
      setFocusPrompt(data.reply);
      setSpeechBubble(data.reply);
    }
    if (data?.audio?.base64) {
      playAudioFromBase64(data.audio.base64, data.audio.format);
    }
    scheduleScreenCheck(0);
    scheduleFatigueCheck(6 * 60 * 1000);
  };

  const handleFocusUserText = async (text: string) => {
    const cleaned = sanitizeText(text);
    if (!cleaned) return;
    if (!focusSessionId) {
      await startFocusSession(cleaned);
      return;
    }
    if (isAwaitingRestDecision) {
      const decision = parseRestDecision(cleaned);
      const acceptRest = decision === null ? false : decision;
      const response = await fetch(`${API_BASE}/focus/fatigue-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: focusSessionId,
          accept_rest: acceptRest,
          user_text: cleaned,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.reply) {
          setSpeechBubble(data.reply);
        }
        if (data?.audio?.base64) {
          playAudioFromBase64(data.audio.base64, data.audio.format);
        }
        if (data?.action === 'end_focus') {
          handleEndFocus();
          return;
        }
      }
      setIsAwaitingRestDecision(false);
    }
  };

  const appendTaskMessage = (role: TaskMessage['role'], text: string) => {
    const id = `task-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setTaskMessages((prev) => [...prev, { id, role, text }]);
    setTaskTimeline((prev) => [...prev, { type: 'message', id }]);
  };

  const generateTasks = async (description: string, archiveExisting: boolean) => {
    if (!description.trim()) return;
    setIsGeneratingTasks(true);
    try {
      const response = await fetch(`${API_BASE}/interaction/generate-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_description: description }),
      });
      if (!response.ok) return;
      const data = await response.json();
      const tasks: string[] = data?.tasks ?? [];
      if (archiveExisting) {
        setTaskBoards((prev) => [
          ...prev,
          {
            id: activeBoardId,
            title: taskTitle,
            date: taskDate,
            todoItems: [...todoItems],
            doneItems: [...doneItems],
          },
        ]);
      }
      const baseId = Date.now();
      const newBoardId = `board-${baseId}`;
      setTaskTitle(data?.topic || summarizeTopic(description, tasks));
      setTodoItems(tasks.map((text, index) => ({ id: `todo-${baseId}-${index}`, text })));
      setDoneItems([]);
      setTaskDate(getBeijingDate());
      setTransitioning({});
      setActiveBoardId(newBoardId);
      setTaskTimeline((prev) => [...prev, { type: 'board', id: newBoardId }]);
    } finally {
      setIsGeneratingTasks(false);
    }
  };

  const sendChatMessage = async (message: string) => {
    const response = await fetch(`${API_BASE}/interaction/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.reply) {
      const reply = sanitizeText(data.reply);
      if (!isInitialTaskLocked) {
        setChatAssistantText(reply);
        setIsInitialTaskLocked(true);
      }
      appendTaskMessage('assistant', reply);
    }
    if (data?.audio_url) {
      playAudioFromUrl(data.audio_url);
    } else if (data?.reply) {
      try {
        const speakResponse = await fetch(`${API_BASE}/interaction/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: data.reply, emotion: 'neutral' }),
        });
        if (!speakResponse.ok) return;
        const payload = await speakResponse.json();
        playAudioFromBase64(payload?.data?.audio?.base64, payload?.data?.audio?.format);
      } catch {
        // ignore fallback speech errors
      }
    }
  };

  const applyInteraction = async (interaction: any, userText?: string) => {
    if (!interaction) return;
    const cleanedUserText = userText ? sanitizeText(userText) : '';
    const isHomeChat = isHomeView && interaction.type === 'chat';
    if (!isInitialTaskLocked && !isHomeChat) {
      if (userText) setChatUserText(cleanedUserText);
      if (interaction.audio_text) setChatAssistantText(sanitizeText(interaction.audio_text));
    }

    if (interaction.type === 'command' && interaction.ui_payload?.command === 'save_memo') {
      try {
        const key = 'flowmate.memos';
        const prev = safeJsonParse(
          window.localStorage.getItem(key),
          [] as Array<{ content: string; created_at: string }>,
        );
        prev.push({
          content: interaction.ui_payload.content,
          created_at: new Date().toISOString(),
        });
        window.localStorage.setItem(key, JSON.stringify(prev));
      } catch {
        // ignore storage failures
      }
      return;
    }

    if (interaction.type === 'chat') {
      const assistantText = sanitizeText(interaction.audio_text || '');
      if (isHomeView) {
        if (assistantText) {
          setHomeChatBubble(wrapTextByWidth(assistantText));
          void speakText(assistantText);
        }
        return;
      }
      if (cleanedUserText) {
        setChatUserText(cleanedUserText);
        appendTaskMessage('user', cleanedUserText);
      }
      if (assistantText) {
        setChatAssistantText(assistantText);
        appendTaskMessage('assistant', assistantText);
        void speakText(assistantText);
      }
      setIsInitialTaskLocked(true);
      return;
    }

    if (interaction.type === 'breakdown') {
      if (cleanedUserText) {
        setChatUserText(cleanedUserText);
      }
      if (interaction.audio_text) {
        setChatAssistantText(sanitizeText(interaction.audio_text));
      }
      const title = interaction.ui_payload?.content?.title ?? cleanedUserText ?? '任务拆解';
      setTaskTitle(title);
      if (cleanedUserText) {
        await generateTasks(cleanedUserText, isInitialTaskLocked);
      }
      if (cleanedUserText) setIsInitialTaskLocked(true);
      setCurrentView('task');
    }
  };

  const sendTextIntent = async (text: string) => {
    const response = await fetch(`${API_BASE}/interaction/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error('Intent request failed');
    }
    const interaction = await response.json();
    await applyInteraction(interaction, text);
    return interaction;
  };

  const requestIntent = async (text: string) => {
    const response = await fetch(`${API_BASE}/interaction/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error('Intent request failed');
    }
    return response.json();
  };

  const sendVoiceIntent = async (audioBlob: Blob) => {
    beginThinking();
    try {
      const form = new FormData();
      form.append('audio', audioBlob, 'voice.webm');
      const response = await fetch(`${API_BASE}/interaction/voice`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        throw new Error('Voice request failed');
      }
      const payload = await response.json();
      const interaction = payload?.data?.interaction;
      const userText = payload?.data?.user?.text;
      await applyInteraction(interaction, userText);
      playAudioFromBase64(payload?.data?.audio?.base64, payload?.data?.audio?.format);
    } finally {
      endThinking();
    }
  };

  const handleHomeTextSubmit = async (text: string) => {
    beginThinking();
    try {
      await sendTextIntent(text);
    } catch {
      // ignore for now
    } finally {
      endThinking();
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const startRecording = async (handler: (blob: Blob) => Promise<void> | void) => {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingHandlerRef.current = handler;
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        audioChunksRef.current = [];
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (blob.size > 0) {
          const handlerRef = recordingHandlerRef.current;
          recordingHandlerRef.current = null;
          if (handlerRef) {
            await handlerRef(blob);
          }
        }
      };
      recorder.start();
      setIsRecording(true);
    } catch {
      setIsRecording(false);
    }
  };

  const handleHomeAudioClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording(sendVoiceIntent);
    }
  };

  const handleTaskInputSubmit = async (text: string) => {
    beginThinking();
    try {
      const cleaned = sanitizeText(text);
      const shouldArchive = isInitialTaskLocked;
      appendTaskMessage('user', cleaned);
      try {
        const interaction = await requestIntent(cleaned);
        if (interaction?.type === 'command') {
          await applyInteraction(interaction, cleaned);
          return;
        }
        if (interaction?.type === 'breakdown') {
          if (interaction?.audio_text) {
            const assistantText = sanitizeText(interaction.audio_text);
            if (!isInitialTaskLocked) {
              setChatUserText(cleaned);
              setChatAssistantText(assistantText);
              setIsInitialTaskLocked(true);
            }
            appendTaskMessage('assistant', assistantText);
            try {
              const speakResponse = await fetch(`${API_BASE}/interaction/speak`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: interaction.audio_text, emotion: 'neutral' }),
              });
              if (speakResponse.ok) {
                const payload = await speakResponse.json();
                playAudioFromBase64(payload?.data?.audio?.base64, payload?.data?.audio?.format);
              }
            } catch {
              // ignore speak errors
            }
          }
          await generateTasks(cleaned, shouldArchive);
          return;
        }
      } catch {
        // ignore intent errors
      }
      await sendChatMessage(cleaned);
    } finally {
      endThinking();
    }
  };

  const sendVoiceChat = async (audioBlob: Blob) => {
    beginThinking();
    try {
      const form = new FormData();
      form.append('audio', audioBlob, 'voice.webm');
      const response = await fetch(`${API_BASE}/interaction/voice`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) return;
      const payload = await response.json();
      const userText = sanitizeText(payload?.data?.user?.text || '');
      const assistantText = sanitizeText(payload?.data?.assistant?.text || '');
      const interaction = payload?.data?.interaction;
      const shouldArchive = isInitialTaskLocked;
      if (interaction?.type === 'command') {
        await applyInteraction(interaction, userText);
        return;
      }
      if (userText) {
        if (!isInitialTaskLocked) {
          setChatUserText(userText);
        }
        appendTaskMessage('user', userText);
      }
      if (assistantText) {
        if (!isInitialTaskLocked) {
          setChatAssistantText(assistantText);
          setIsInitialTaskLocked(true);
        }
        appendTaskMessage('assistant', assistantText);
      }
      if (interaction?.type === 'breakdown' && userText) {
        await generateTasks(userText, shouldArchive);
      }
      playAudioFromBase64(payload?.data?.audio?.base64, payload?.data?.audio?.format);
    } finally {
      endThinking();
    }
  };

  const handleTaskAudioClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording(sendVoiceChat);
    }
  };

  const handleFocusTextSubmit = async (text: string) => {
    beginThinking();
    try {
      await handleFocusUserText(text);
    } finally {
      endThinking();
    }
  };

  const sendFocusVoice = async (audioBlob: Blob) => {
    beginThinking();
    try {
      const form = new FormData();
      form.append('audio', audioBlob, 'voice.webm');
      const response = await fetch(`${API_BASE}/interaction/voice`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) return;
      const payload = await response.json();
      const userText = sanitizeText(payload?.data?.user?.text || '');
      await handleFocusUserText(userText);
    } finally {
      endThinking();
    }
  };

  const handleFocusAudioClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording(sendFocusVoice);
    }
  };

  const triggerFocusShortcut = (action: 'screen' | 'fatigue' | 'final10') => {
    if (!isFocusView) return;
    console.log('[focus] shortcut received', action);
    if (action === 'screen') {
      scheduleScreenCheck(0);
    } else if (action === 'fatigue') {
      scheduleFatigueCheck(0);
    } else if (action === 'final10') {
      setIsCountUp(false);
      setRemainingSeconds(10);
      setIsFocusRunning(true);
    }
  };

  useEffect(() => {
    if (!isFocusView) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      const code = event.code;
      const isDigit1 = key === '1' || code === 'Digit1' || code === 'Numpad1';
      const isDigit2 = key === '2' || code === 'Digit2' || code === 'Numpad2';
      const isDigit3 = key === '3' || code === 'Digit3' || code === 'Numpad3';
      if (isDigit1) {
        event.preventDefault();
        event.stopPropagation();
        triggerFocusShortcut('screen');
      } else if (isDigit2) {
        event.preventDefault();
        event.stopPropagation();
        triggerFocusShortcut('fatigue');
      } else if (isDigit3) {
        event.preventDefault();
        event.stopPropagation();
        triggerFocusShortcut('final10');
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isFocusView]);

  useEffect(() => {
    const off = (window as any).electron?.on?.('focus:shortcut', (action: string) => {
      console.log('[focus] ipc shortcut event', action, 'isFocusView=', isFocusView);
      triggerFocusShortcut(action === 'fatigue' ? 'fatigue' : action === 'final10' ? 'final10' : 'screen');
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [isFocusView]);

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
    if (!isFocusRunning) {
      resetFocusMonitors();
    }
  }, [isFocusRunning]);

  useEffect(() => {
    if (!isTaskRunning) return;
    const container = taskScrollRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    });
  }, [isTaskRunning, taskTimeline.length, todoItems.length, doneItems.length, taskBoards.length]);

  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/interaction/encouragement`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!mounted || !data?.encouragement) return;
        setEncouragement(data.encouragement);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHomeView || homeChatBubble) return;
    setHomeChatBubble(wrapTextByWidth(HOME_WELCOME_TEXT));
    void speakText(HOME_WELCOME_TEXT);
  }, [isHomeView, homeChatBubble]);

  useEffect(() => {
    remainingSecondsRef.current = remainingSeconds;
  }, [remainingSeconds]);

  useEffect(() => {
    focusSessionIdRef.current = focusSessionId;
  }, [focusSessionId]);

  useEffect(() => {
    focusTaskTextRef.current = focusTaskText;
  }, [focusTaskText]);

  useEffect(() => {
    if (!isFocusRunning) return;
    if (countdownRef.current) return;

    countdownRef.current = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (isCountUp) {
          return prev + 1;
        }
        if (prev <= 1) {
          return 0;
        }
        return Math.max(0, prev - 1);
      });
    }, 1000);

    return () => {
      if (countdownRef.current) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [isFocusRunning, isCountUp]);

  useEffect(() => {
    if (!isBreakView) return;
    if (breakTimerRef.current) {
      window.clearInterval(breakTimerRef.current);
      breakTimerRef.current = null;
    }
    breakTimerRef.current = window.setInterval(() => {
      setBreakRemainingSeconds((prev) => {
        if (prev <= 1) {
          window.setTimeout(() => finishBreak(), 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (breakTimerRef.current) {
        window.clearInterval(breakTimerRef.current);
        breakTimerRef.current = null;
      }
    };
  }, [isBreakView]);

  useEffect(() => {
    currentViewRef.current = currentView;
    if (currentView !== 'break') {
      setBreakStretchQueued(false);
      setBreakStretchPlayed(false);
    }
  }, [currentView]);

  useEffect(() => {
    if (isBreakView && isAvatarSpeaking) {
      setBreakStretchPlayed(false);
      setBreakStretchQueued(false);
    }
  }, [isBreakView, isAvatarSpeaking]);

  useEffect(() => {
    if (primaryView !== 'home' || currentView === 'profile' || isAvatarSpeaking) return;
    const intervalId = window.setInterval(() => {
      setHomeIdleTick((prev) => prev + 1);
    }, 6000);
    return () => window.clearInterval(intervalId);
  }, [primaryView, currentView, isAvatarSpeaking]);

  useEffect(() => {
    const video = avatarVideoRef.current;
    if (!video) return;
    const handleEnded = () => {
      if (video.dataset.state === 'stretch') {
        setBreakStretchPlayed(true);
      }
    };
    video.addEventListener('ended', handleEnded);
    return () => video.removeEventListener('ended', handleEnded);
  }, []);

  useEffect(() => {
    const video = avatarVideoRef.current;
    if (!video) return;
    const prevView = lastViewRef.current;
    if (prevView !== currentView) {
      lastViewRef.current = currentView;
    }
    if (currentView === 'break' && prevView !== 'break') {
      setBreakStretchPlayed(false);
    }

    const returningFromProfile = prevView === 'profile' && currentView !== 'profile';
    const shouldExitTalk = !isAvatarSpeaking && video.dataset.state === 'talk';
    const shouldResetBase = prevView !== currentView || returningFromProfile || shouldExitTalk;

    const playAvatar = (state: string, src: string, loop: boolean, restart: boolean) => {
      if (video.dataset.state !== state) {
        video.src = src;
        video.dataset.state = state;
      }
      video.loop = loop;
      if (restart) {
        try {
          video.currentTime = 0;
        } catch {
          // ignore seek errors
        }
      }
      if (loop || restart) {
        video.play().catch(() => {});
      }
    };

    if (isBreakView) {
      if (isAvatarSpeaking) {
        playAvatar('talk', vidTalk, true, prevView !== currentView || video.dataset.state !== 'talk');
        return;
      }
      if (breakStretchQueued && !breakStretchPlayed) {
        playAvatar('stretch', vidStretch, false, shouldResetBase || video.dataset.state !== 'stretch');
        return;
      }
      if (shouldResetBase) {
        playAvatar('idle', vidIdle, false, true);
      } else {
        video.pause();
      }
      return;
    }

    if (isFocusView) {
      if (isAvatarSpeaking) {
        playAvatar('talk', vidTalk, true, video.dataset.state !== 'talk');
      } else {
        playAvatar('focus', vidFocus, true, shouldResetBase || video.dataset.state !== 'focus');
      }
      return;
    }

    if (isTaskRunning || primaryView === 'timer') {
      if (isAvatarSpeaking) {
        playAvatar('talk', vidTalk, true, video.dataset.state !== 'talk');
        return;
      }
      if (shouldResetBase) {
        playAvatar('idle', vidIdle, false, true);
      }
      return;
    }

    if (primaryView === 'home') {
      if (isAvatarSpeaking) {
        playAvatar('talk', vidTalk, true, video.dataset.state !== 'talk');
        return;
      }
      if (shouldResetBase || homeIdleTick > 0) {
        playAvatar('idle', vidIdle, false, true);
      }
    }
  }, [
    currentView,
    isAvatarSpeaking,
    isBreakView,
    isFocusView,
    isTaskRunning,
    primaryView,
    breakStretchPlayed,
    breakStretchQueued,
    homeIdleTick,
  ]);

  useEffect(() => {
    if (!isFocusRunning || isCountUp) return;
    if (remainingSeconds !== 0) return;
    if (finishRequestedRef.current) return;
    finishRequestedRef.current = true;
    const finishFocus = async () => {
      if (!focusSessionId) {
        enterBreakView();
        return;
      }
      try {
        await fetch(`${API_BASE}/focus/finish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: focusSessionId }),
        });
      } catch {
        // ignore finish errors
      } finally {
        enterBreakView();
      }
    };
    finishFocus();
  }, [remainingSeconds, isFocusRunning, isCountUp, focusSessionId]);

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
  const breakValue = useMemo(() => toTimeWheelValue(breakRemainingSeconds), [breakRemainingSeconds]);

  return (
    <div className="app-shell">
      <div className={`app-layout ${currentView === 'profile' ? 'is-profile' : ''}`}>
        <UiScaleFrame>
          <div
            className={`window ${isTaskRunning ? 'is-task-running' : ''} ${isTimerView ? 'is-timer-view' : ''} ${isFocusView ? 'is-focus-view' : ''} ${isBreakView ? 'is-break-view' : ''} ${currentView === 'profile' ? 'is-profile-view' : ''} ${currentView === 'home' ? 'is-home-view' : ''}`}
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
                {isBreakView && (
                  <div className="break-star-field" aria-hidden="true">
                    <img src={imgStarBlink} alt="" />
                  </div>
                )}
                {isHomeView && homeChatBubble && (
                  <div className="home-chat-bubble chat-bubble chat-bubble-user chat-bubble-glass glass-widget glass-widget--border glass-widget-surface">
                    {homeChatBubble}
                  </div>
                )}
                {isTimerView && isAvatarSpeaking && speechBubbleText && (
                  <div className="home-chat-bubble chat-bubble chat-bubble-user chat-bubble-glass glass-widget glass-widget--border glass-widget-surface">
                    {speechBubbleText}
                  </div>
                )}
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
                    <video ref={avatarVideoRef} muted playsInline preload="auto" />
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
                    <div className={`timer-countdown ${isFocusView ? 'is-running' : ''} ${isBreakView ? 'is-break' : ''}`}>
                      <TimeWheelPicker
                        value={isBreakView ? breakValue : isFocusView ? focusValue : timerValue}
                        onChange={isFocusView || isBreakView ? undefined : setTimerValue}
                        interactive={!isFocusView && !isBreakView}
                        animate={isFocusView || isBreakView}
                        size={isFocusView || isBreakView ? TIMER_WHEEL_SIZE : undefined}
                      />
                    </div>
                  ) : (
                    <>
                      <p className="headline" data-node-id="262:229">
                        {isHomeView ? encouragement : '让我来拆解你的任务吧～'}
                      </p>
                      <VoiceInput
                        placeholder={isThinking ? 'FlowMate正在思考...' : '今天要完成什么呢？'}
                        plusIcon={imgPlusMath}
                        audioIcon={imgAudioWave}
                        isRecording={isRecording}
                        onSubmit={isHomeView ? handleHomeTextSubmit : undefined}
                        onAudioClick={isHomeView ? handleHomeAudioClick : undefined}
                      />
                    </>
                  )}
                  {isFocusView && (
                    <VoiceInput
                      placeholder={isThinking ? 'FlowMate正在思考...' : (focusTaskText ? "需要补充什么吗？" : "这次专注准备完成什么任务呢？")}
                      plusIcon={imgPlusMath}
                      audioIcon={imgAudioWave}
                      isRecording={isRecording}
                      onSubmit={handleFocusTextSubmit}
                      onAudioClick={handleFocusAudioClick}
                    />
                  )}
                </div>
                <div className="task-panel" data-name="对话" data-node-id="310:264">
                  <div className="task-panel-content">
                    <div className="task-scroll" ref={taskScrollRef}>
                      <div className="chat-block">
                        <div className="chat-bubble chat-bubble-user chat-bubble-glass glass-widget glass-widget--border glass-widget-surface">
                          {chatUserText}
                        </div>
                        <div className="chat-bubble chat-bubble-assistant">
                          {chatAssistantText}
                        </div>
                      </div>
                      <div className="task-timeline">
                        {taskTimeline.map((item) => {
                          if (item.type === 'message') {
                            const message = taskMessages.find((entry) => entry.id === item.id);
                            if (!message) return null;
                            return (
                              <div
                                key={item.id}
                                className={`task-history-item ${message.role === 'user' ? 'is-user glass-widget glass-widget--border glass-widget-surface' : 'is-assistant'}`}
                              >
                                {message.text}
                              </div>
                            );
                          }
                          const board = getBoardById(item.id);
                          if (!board) return null;
                          return (
                            <React.Fragment key={item.id}>
                              {renderTodoCard(
                                board,
                                true,
                                board.id === activeBoardId
                                  ? markTodoDone
                                  : (itemId) => markBoardTodoDone(board.id, itemId),
                                board.id === activeBoardId
                                  ? restoreTodo
                                  : (itemId) => restoreBoardTodo(board.id, itemId),
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                    <div className="task-input">
                      <VoiceInput
                        ref={taskInputRef}
                        placeholder={isThinking ? 'FlowMate正在思考...' : '今天要完成什么呢？'}
                        plusIcon={imgPlusMath}
                        audioIcon={imgAudioWave}
                        isRecording={isRecording}
                        onSubmit={handleTaskInputSubmit}
                        onAudioClick={handleTaskAudioClick}
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
          onBreakEnd={handleSkipBreak}
          isFocusRunning={isFocusRunning}
        />
      </div>
    </div>
  );
};

export default App;
