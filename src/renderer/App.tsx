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
import {
  parseTodoState,
  serializeTodoState,
  MEMO_STORAGE_KEY,
  TODO_STORAGE_KEY,
  writeTodoState,
  type StoredTodoState,
} from './lib/storage';


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

type VoiceWsPage = 'home' | 'task' | 'focus';

type StreamingVoiceInteractionOptions = {
  page: VoiceWsPage;
  durationMs?: number;
  chunkMs?: number;
  message?: string;
  useUi?: boolean;
  fallbackHandler: (blob: Blob) => Promise<void> | void;
};

const DEFAULT_CHAT_USER_TEXT = '我需要写一篇关于数字媒体交互的论文';
const DEFAULT_CHAT_ASSISTANT_TEXT =
  '根据任务难度和任务截止时间，你还有7天完成这个论文，以下是我对你的任务规划，已帮你同步到Todo-list';
const HOME_WELCOME_TEXT =
  '你好呀，我是 FlowMate，你的心流维护小助手。你可以在输入框告诉我今天要完成的事，我会帮你拆解成待办；也可以点击麦克风直接告诉我你的闪念灵感。想进入专注计时就点下方的“番茄钟”，头像页可以查看进度。现在告诉我你的任务吧';
const HOME_WELCOME_AUDIO_SRC = '/audio/home_welcome.mp3';
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
const DEMO_SCREEN_CHECK_SHORTCUTS =
  String(import.meta.env.VITE_DEMO_SCREEN_CHECK_SHORTCUTS ?? '').toLowerCase() === 'true';
if (import.meta.env.DEV) {
  console.log('[api] base', API_BASE);
}
const buildWsUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (API_BASE.startsWith('http://') || API_BASE.startsWith('https://')) {
    const url = new URL(API_BASE);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = url.pathname.replace(/\/$/, '');
    return `${protocol}//${url.host}${basePath}${normalizedPath}`;
  }
  const origin = window.location.origin.replace(/^http/, 'ws');
  const basePath = API_BASE.replace(/\/$/, '');
  return `${origin}${basePath}${normalizedPath}`;
};
const sanitizeText = (text: string) =>
  text
    .replace(/<\|.*?\|>/g, '')
    .replace(/<Speech\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const hasFlashIdeaKeyword = (text: string) =>
  text.includes('闪念') || text.includes('闪电');
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
const MEMO_BROADCAST_CHANNEL = 'flowmate:memos';
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
  return fallback;
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
  const initialTodoState = useMemo<StoredTodoState | null>(() => null, []);
  const [currentView, setCurrentView] = useState<View>('home');
  const [profileTab, setProfileTab] = useState<ProfileTab>('day');
  const [encouragement, setEncouragement] = useState('让我来拆解你的任务吧～');
  const [chatUserText, setChatUserText] = useState(DEFAULT_CHAT_USER_TEXT);
  const [chatAssistantText, setChatAssistantText] = useState(DEFAULT_CHAT_ASSISTANT_TEXT);
  const [homeChatBubble, setHomeChatBubble] = useState('');
  const [speechBubbleText, setSpeechBubbleText] = useState('');
  const initialBoardIdRef = useRef(createBoardId());
  const [taskTitle, setTaskTitle] = useState(initialTodoState?.taskTitle ?? '');
  const [taskMessages, setTaskMessages] = useState<TaskMessage[]>([]);
  const [isInitialTaskLocked, setIsInitialTaskLocked] = useState(false);
  const [taskDate, setTaskDate] = useState(initialTodoState?.taskDate ?? getBeijingDate());
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
  const hasPlayedHomeWelcomeAudioRef = useRef(false);
  const [isFocusRunning, setIsFocusRunning] = useState(false);
  const [isCountUp, setIsCountUp] = useState(false);
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null);
  const [focusTaskText, setFocusTaskText] = useState('');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [isAwaitingRestDecision, setIsAwaitingRestDecision] = useState(false);
  const [breakRemainingSeconds, setBreakRemainingSeconds] = useState(BREAK_DEFAULT_SECONDS);
  const [breakMessage, setBreakMessage] = useState(BREAK_DEFAULT_MESSAGE);
  const breakTimerRef = useRef<number | null>(null);
  const [breakPhase, setBreakPhase] = useState<'rest_idle' | 'rest_stretching' | 'rest_fact_speaking'>('rest_idle');
  const breakPhaseRef = useRef<'rest_idle' | 'rest_stretching' | 'rest_fact_speaking'>('rest_idle');
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
  const chatStreamStateRef = useRef<{
    id: number;
    controller: AbortController | null;
    reader: ReadableStreamDefaultReader<Uint8Array> | null;
  }>({ id: 0, controller: null, reader: null });
  const wsTestStateRef = useRef<{
    id: number;
    socket: WebSocket | null;
  }>({ id: 0, socket: null });
  const wsAudioStateRef = useRef<{
    id: number;
    socket: WebSocket | null;
    turnId: string | null;
    page: VoiceWsPage | null;
    recorder: MediaRecorder | null;
    stream: MediaStream | null;
    pcmContext: AudioContext | null;
    pcmProcessor: ScriptProcessorNode | null;
    pcmSource: MediaStreamAudioSourceNode | null;
    pcmWorkletNode: AudioWorkletNode | null;
    pcmActive: boolean;
    stopTimer: number | null;
    audio: HTMLAudioElement | null;
    stopRequested: boolean;
    useUi: boolean;
    watchdogTimer: number | null;
    turnActive: boolean;
    ttsDone: boolean;
    pendingAudio: number;
    endAudioSent: boolean;
  }>({
    id: 0,
    socket: null,
    turnId: null,
    page: null,
    recorder: null,
    stream: null,
    pcmContext: null,
    pcmProcessor: null,
    pcmSource: null,
    pcmWorkletNode: null,
    pcmActive: false,
    stopTimer: null,
    audio: null,
    stopRequested: false,
    useUi: false,
    watchdogTimer: null,
    turnActive: false,
    ttsDone: false,
    pendingAudio: 0,
    endAudioSent: false,
  });
  const speakChunksStateRef = useRef<{
    id: number;
    controller: AbortController | null;
    audio: HTMLAudioElement | null;
  }>({ id: 0, controller: null, audio: null });
  const [avatarSpeechState, setAvatarSpeechState] = useState<'idle' | 'speaking' | 'speaking_hold'>('idle');
  const avatarVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastViewRef = useRef<View | null>(null);
  const currentViewRef = useRef<View>(currentView);
  const [breakStretchPlayed, setBreakStretchPlayed] = useState(false);
  const [breakStretchQueued, setBreakStretchQueued] = useState(false);
  const BREAK_FACTS = [
  '休息一下，给你讲个有趣的冷知识：蜂鸟是唯一能向后飞的鸟。它还能悬停在空中，看起来就像一架迷你直升机，所以它采花蜜的时候总显得特别灵活。',

  '趁现在放松一下，分享你一个冷知识：章鱼其实有三颗心脏。两颗负责鳃部循环，一颗负责全身循环，所以它的身体结构比很多人想象中还要神奇。',

  '给你来个轻松的小知识：人眨眼的动作其实特别快，快到大脑经常会自动忽略掉。也就是说，你以为自己一直在盯着前方，其实中间已经悄悄眨了很多次眼。',

  '说个可爱的冷知识给你听：海獭睡觉时会牵着手，防止彼此漂散。想象一下它们在海面上抱团漂着睡觉，真的像天然自带治愈属性的小动物。',

  '来一个有意思的冷知识：香蕉在植物学上其实属于浆果。听起来有点反直觉，但这也说明，水果的日常叫法和科学分类有时候还真不是一回事。',

  '再分享你一个小知识：猫咪能发出超过一百种不同的声音。它们会用不同的叫声表达情绪，所以有些时候你会觉得，它们像是在认真和你聊天。'
  ];

  const [todoItems, setTodoItems] = useState<TodoItem[]>(() => initialTodoState?.todoItems ?? []);
  const [doneItems, setDoneItems] = useState<TodoItem[]>(() => initialTodoState?.doneItems ?? []);
  const [transitioning, setTransitioning] = useState<Record<string, 'toDone' | 'toTodo'>>({});
  const [archivedTransitions, setArchivedTransitions] = useState<Record<string, 'toDone' | 'toTodo'>>({});
  const todoStorageRef = useRef(initialTodoState ? serializeTodoState(initialTodoState) : '');

  const taskInputRef = useRef<HTMLInputElement | null>(null);
  const taskScrollRef = useRef<HTMLDivElement | null>(null);
  const finishRequestedRef = useRef(false);
  const todoRefs = useRef(new Map<string, HTMLLIElement>());
  const doneRefs = useRef(new Map<string, HTMLLIElement>());
  const todoPositions = useRef(new Map<string, DOMRect>());
  const donePositions = useRef(new Map<string, DOMRect>());

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== TODO_STORAGE_KEY) return;
      const next = parseTodoState(event.newValue);
      if (!next) return;
      const serialized = serializeTodoState(next);
      if (serialized === todoStorageRef.current) return;
      todoStorageRef.current = serialized;
      setTaskTitle(next.taskTitle);
      setTaskDate(next.taskDate);
      setTodoItems(next.todoItems);
      setDoneItems(next.doneItems);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.removeItem(MEMO_STORAGE_KEY);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(MEMO_BROADCAST_CHANNEL);
        channel.postMessage({ type: 'memo_update', memos: [] });
        channel.close();
      }
    } catch {
      // ignore memo reset failures
    }
  }, []);

  useEffect(() => {
    const nextState: StoredTodoState = {
      taskTitle,
      taskDate,
      todoItems,
      doneItems,
    };
    const serialized = serializeTodoState(nextState);
    if (serialized === todoStorageRef.current) return;
    todoStorageRef.current = serialized;
    writeTodoState(nextState);
  }, [taskTitle, taskDate, todoItems, doneItems]);

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

  const resetSessionState = (options?: { preserveTaskRecords?: boolean }) => {
    const preserveTaskRecords = options?.preserveTaskRecords ?? false;
    const newBoardId = createBoardId();
    if (!preserveTaskRecords) {
      initialBoardIdRef.current = newBoardId;
    }
    setChatUserText(DEFAULT_CHAT_USER_TEXT);
    setChatAssistantText(DEFAULT_CHAT_ASSISTANT_TEXT);
    if (!preserveTaskRecords) {
      setTaskTitle(DEFAULT_TASK_TITLE);
      setTaskMessages([]);
      setIsInitialTaskLocked(false);
      setTaskDate(getBeijingDate());
      setTaskBoards([]);
      setActiveBoardId(newBoardId);
      setTaskTimeline([{ type: 'board', id: newBoardId }]);
      setTodoItems(buildDefaultTodos());
      setDoneItems([]);
    }
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
    setBreakStretchQueued(true);
    setBreakStretchPlayed(false);
    setBreakPhase('rest_stretching');
    setBreakRemainingSeconds(BREAK_DEFAULT_SECONDS);
    setCurrentView('break');
  };

  const finishBreak = () => {
    if (breakTimerRef.current) {
      window.clearInterval(breakTimerRef.current);
      breakTimerRef.current = null;
    }
    resetSessionState({ preserveTaskRecords: true });
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
      const handleAudioEnd = () => {
        const isWsAudio = audio.dataset.source === 'ws_audio';
        const audioRunId = audio.dataset.wsRunId ? Number(audio.dataset.wsRunId) : null;
        if (isWsAudio && audioRunId !== wsAudioStateRef.current.id) {
          return;
        }
        if (isWsAudio) {
          if (wsAudioStateRef.current.turnActive) {
            if (wsAudioStateRef.current.pendingAudio > 0) {
              setAvatarSpeechState('speaking');
              return;
            }
            if (!wsAudioStateRef.current.ttsDone && wsAudioStateRef.current.pendingAudio === 0) {
              setAvatarSpeechState('speaking_hold');
              return;
            }
          }
          setAvatarSpeechState('idle');
          return;
        }
        if (currentViewRef.current === 'break' && breakPhaseRef.current === 'rest_fact_speaking') {
          setBreakPhase('rest_idle');
        }
        setAvatarSpeechState('idle');
      };
      audio.addEventListener('play', () => setAvatarSpeechState('speaking'));
      audio.addEventListener('ended', () => {
        handleAudioEnd();
      });
      audio.addEventListener('pause', () => {
        if (audio.ended || audio.currentTime === 0) {
          handleAudioEnd();
        }
      });
      audio.addEventListener('error', () => setAvatarSpeechState('idle'));
    }
    return audioPlayerRef.current;
  };

  const isWsAudioActive = () =>
    wsAudioStateRef.current.useUi &&
    (wsAudioStateRef.current.socket ||
      wsAudioStateRef.current.recorder ||
      wsAudioStateRef.current.stopRequested);

  const setSpeechBubble = (text?: string) => {
    if (!text) return;
    setSpeechBubbleText(wrapTextByWidth(sanitizeText(text)));
  };

  const playHomeWelcomeAudio = async () => {
    const fallbackToTts = () => {
      console.log('[HomeWelcome] using_dynamic_tts_fallback');
      void speakText(HOME_WELCOME_TEXT, 'home_welcome');
    };
    if (!HOME_WELCOME_AUDIO_SRC) {
      console.log('[HomeWelcome] local_audio_missing_fallback_to_tts');
      fallbackToTts();
      return;
    }
    const src = /^https?:\/\//.test(HOME_WELCOME_AUDIO_SRC)
      ? HOME_WELCOME_AUDIO_SRC
      : HOME_WELCOME_AUDIO_SRC.startsWith('/')
        ? `${window.location.origin}${HOME_WELCOME_AUDIO_SRC}`
        : HOME_WELCOME_AUDIO_SRC;
    let response: Response;
    try {
      response = await fetch(src, { cache: 'no-store' });
    } catch (error) {
      console.log('[HomeWelcome] local_audio_missing_fallback_to_tts', error);
      fallbackToTts();
      return;
    }
    if (!response.ok) {
      console.log('[HomeWelcome] local_audio_missing_fallback_to_tts');
      fallbackToTts();
      return;
    }
    const audio = ensureAudioPlayer();
    audio.dataset.source = 'other';
    audio.dataset.wsRunId = '';
    let blob = await response.blob();
    if (!blob.type) {
      const buffer = await blob.arrayBuffer();
      blob = new Blob([buffer], { type: 'audio/mpeg' });
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    const objectUrl = URL.createObjectURL(blob);
    audioUrlRef.current = objectUrl;
    console.log('[HomeWelcome] using_local_audio', { src, blob_type: blob.type, size: blob.size });
    audio.pause();
    audio.currentTime = 0;
    audio.src = objectUrl;
    try {
      console.log('[HomeWelcome] play_local_audio');
      await audio.play();
    } catch (error) {
      console.warn('[HomeWelcome] local_audio_load_error_fallback_to_tts', error);
      fallbackToTts();
    }
  };

  const speakText = async (
    text: string,
    source = 'other',
    options?: { allowDuringWs?: boolean },
  ) => {
    if (!text) return;
    const snippet = text.replace(/\s+/g, ' ').slice(0, 80);
    if (isWsAudioActive() && !options?.allowDuringWs) {
      console.log('[speak_api] suppressed_during_ws', { source, text: snippet });
      return;
    }
    console.log('[speak_api] request', { source, text: snippet });
    setSpeechBubble(text);
    try {
      const response = await fetch(`${API_BASE}/interaction/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, emotion: 'neutral' }),
      });
      if (!response.ok) return;
      const payload = await response.json();
      playAudioFromBase64(
        payload?.data?.audio?.base64,
        payload?.data?.audio?.format,
        `speak_api:${source}`,
        snippet,
      );
    } catch {
      // ignore speak errors
    }
  };

  const playAudioFromBase64 = async (
    base64?: string,
    format?: string,
    source = 'other',
    text?: string,
  ) => {
    if (!base64) return;
    const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    const audio = ensureAudioPlayer();
    const dataUrl = `data:${mime};base64,${base64}`;
    audio.dataset.source = 'other';
    audio.dataset.wsRunId = '';
    console.log('[audio] src_set', { source, text, audio_len: base64.length });
    audio.pause();
    audio.currentTime = 0;
    audio.src = dataUrl;
    try {
      console.log('[audio] play', { source, text });
      await audio.play();
    } catch (error) {
      console.warn('[audio] HTMLAudio (data URL) play failed', error);
    }
  };

  const playAudioFromUrl = async (url?: string, source = 'other') => {
    if (!url) return;
    const audio = ensureAudioPlayer();
    const src = url.startsWith('http')
      ? url
      : url.startsWith('/api')
        ? url
        : `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
    audio.dataset.source = 'other';
    audio.dataset.wsRunId = '';
    console.log('[audio] src_set', { source, url: src });
    audio.src = src;
    try {
      console.log('[audio] play', { source });
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

  const setScreenCheckOverride = async (mode: 'related' | 'unrelated') => {
    try {
      await fetch(`${API_BASE}/focus/screen-check-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch (error) {
      console.warn('[screen-check-demo] override_set_failed', error);
    }
  };

  const setFatigueCheckOverride = async (mode: 'sleepy') => {
    try {
      await fetch(`${API_BASE}/focus/fatigue-check-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch (error) {
      console.warn('[fatigue-check-demo] override_set_failed', error);
    }
  };

  const triggerDemoScreenCheck = (mode: 'related' | 'unrelated') => {
    if (!DEMO_SCREEN_CHECK_SHORTCUTS) return;
    const label = mode === 'related' ? 'ctrl+shift+q' : 'ctrl+e';
    console.log(`[screen-check-demo] shortcut ${label} triggered`);
    void (async () => {
      await setScreenCheckOverride(mode);
      console.log('[screen-check-demo] detection_requested', { mode });
      scheduleScreenCheck(0);
    })();
  };

  const triggerDemoFatigueCheck = () => {
    console.log('[fatigue-check-demo] shortcut ctrl+q triggered');
    void (async () => {
      await setFatigueCheckOverride('sleepy');
      console.log('[fatigue-check-demo] detection_requested', { mode: 'sleepy' });
      scheduleFatigueCheck(0);
    })();
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
        if (DEMO_SCREEN_CHECK_SHORTCUTS) {
          console.log('[screen-check-demo] detection_finished', {
            related: data?.is_focused,
            score: data?.score,
          });
        }
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
      console.log('[FocusUI] prompt payload', data);
      if (data?.prompt) {
        setFocusPrompt(data.prompt);
        setSpeechBubble(data.prompt);
        console.log('[FocusUI] bubble_text', data.prompt);
      }
      if (data?.audio?.base64) {
        console.log('[FocusUI] audio_source', 'focus_prompt');
        playAudioFromBase64(data.audio.base64, data.audio.format, 'focus_prompt', data.prompt);
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
    if (hasFlashIdeaKeyword(cleaned)) {
      try {
        const interaction = await requestIntent(cleaned);
        if (interaction?.type === 'command' && interaction.ui_payload?.command === 'save_memo') {
          await applyInteraction(interaction, cleaned);
          return;
        }
      } catch {
        // ignore memo intent errors
      }
    }
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
    return id;
  };

  const updateTaskMessage = (id: string, text: string) => {
    setTaskMessages((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, text } : entry)),
    );
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

  const runChatStream = async (
    message: string,
    handlers: {
      logPrefix: string;
      onStreamStart?: () => void;
      onPartial?: (text: string) => void;
      onDone?: () => void | Promise<void>;
      onError?: (message?: string) => void;
    },
  ) => {
    const text = (message ?? '').trim();
    if (!text) {
      console.warn(`[${handlers.logPrefix}] empty message`);
      return;
    }
    const requestStart = performance.now();
    console.log(`[${handlers.logPrefix}] request_start_ms`, Math.round(requestStart));
    const streamId = chatStreamStateRef.current.id + 1;
    chatStreamStateRef.current.id = streamId;
    if (chatStreamStateRef.current.controller) {
      chatStreamStateRef.current.controller.abort();
    }
    if (chatStreamStateRef.current.reader) {
      chatStreamStateRef.current.reader.cancel().catch(() => {});
    }

    let firstChunkLogged = false;
    let shouldStop = false;
    let buffer = '';
    let doneLogged = false;
    let errorLogged = false;

    const controller = new AbortController();
    chatStreamStateRef.current.controller = controller;
    if (handlers.onStreamStart) {
      handlers.onStreamStart();
    }

    const response = await fetch(`${API_BASE}/interaction/chat-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      console.warn(`[${handlers.logPrefix}] request_failed`, { status: response.status });
      if (!errorLogged) {
        errorLogged = true;
        console.log(`[${handlers.logPrefix}] stream_error_ms`, Math.round(performance.now() - requestStart));
      }
      if (handlers.onError) {
        handlers.onError('request_failed');
      }
      return;
    }

    const reader = response.body.getReader();
    chatStreamStateRef.current.reader = reader;
    const decoder = new TextDecoder();
    const handleEvent = (payload: any) => {
      if (chatStreamStateRef.current.id !== streamId) return;
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'partial_text') {
        if (!firstChunkLogged) {
          firstChunkLogged = true;
          console.log(`[${handlers.logPrefix}] first_chunk_ms`, Math.round(performance.now() - requestStart));
        }
        if (handlers.onPartial) {
          handlers.onPartial(String(payload.text ?? ''));
        }
        return;
      }
      if (payload.type === 'error') {
        console.error(`[${handlers.logPrefix}] error`, payload.message);
        if (!errorLogged) {
          errorLogged = true;
          console.log(`[${handlers.logPrefix}] stream_error_ms`, Math.round(performance.now() - requestStart));
        }
        if (handlers.onError) {
          handlers.onError(payload.message);
        }
        shouldStop = true;
        return;
      }
      if (payload.type === 'done') {
        if (!doneLogged) {
          doneLogged = true;
          console.log(`[${handlers.logPrefix}] stream_done_ms`, Math.round(performance.now() - requestStart));
        }
        if (handlers.onDone) {
          void handlers.onDone();
        }
        shouldStop = true;
      }
    };

    try {
      while (!shouldStop) {
        if (chatStreamStateRef.current.id !== streamId) break;
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            try {
              handleEvent(JSON.parse(data));
            } catch (error) {
              console.warn(`[${handlers.logPrefix}] parse_error`, error);
            }
          }
          if (shouldStop) break;
        }
      }
    } catch (error) {
      if (!errorLogged && chatStreamStateRef.current.id === streamId) {
        errorLogged = true;
        console.log(`[${handlers.logPrefix}] stream_error_ms`, Math.round(performance.now() - requestStart));
        console.warn(`[${handlers.logPrefix}] read_error`, error);
      }
      if (handlers.onError && chatStreamStateRef.current.id === streamId) {
        handlers.onError(String((error as Error)?.message ?? 'stream_error'));
      }
    } finally {
      if (!doneLogged && !errorLogged && chatStreamStateRef.current.id === streamId) {
        doneLogged = true;
        console.log(`[${handlers.logPrefix}] stream_done_ms`, Math.round(performance.now() - requestStart));
        if (handlers.onDone) {
          void handlers.onDone();
        }
      }
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      if (chatStreamStateRef.current.id === streamId) {
        chatStreamStateRef.current.reader = null;
        chatStreamStateRef.current.controller = null;
      }
    }
  };

  const sendChatMessage = async (message: string) => {
    const cleaned = sanitizeText(message);
    if (!cleaned) return;
    const assistantId = appendTaskMessage('assistant', '');
    let accumulated = '';
    let firstChunkSeen = false;

    await runChatStream(cleaned, {
      logPrefix: 'text-stream',
      onPartial: (chunk) => {
        accumulated += chunk;
        updateTaskMessage(assistantId, accumulated);
        if (!isInitialTaskLocked) {
          setChatAssistantText(accumulated);
          setIsInitialTaskLocked(true);
        }
        if (!firstChunkSeen) {
          firstChunkSeen = true;
        }
      },
      onDone: async () => {
        if (!accumulated) return;
        try {
          const snippet = accumulated.replace(/\s+/g, ' ').slice(0, 80);
          const source = 'chat_stream';
          if (isWsAudioActive()) {
            console.log('[speak_api] suppressed_during_ws', { source, text: snippet });
            return;
          }
          console.log('[speak_api] request', { source, text: snippet });
          const speakResponse = await fetch(`${API_BASE}/interaction/speak`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: accumulated, emotion: 'neutral' }),
          });
          if (!speakResponse.ok) return;
          const payload = await speakResponse.json();
          playAudioFromBase64(
            payload?.data?.audio?.base64,
            payload?.data?.audio?.format,
            `speak_api:${source}`,
            snippet,
          );
        } catch {
          // ignore fallback speech errors
        }
      },
      onError: () => {
        if (!firstChunkSeen) {
          updateTaskMessage(assistantId, accumulated);
        }
      },
    });
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
        const prev = safeJsonParse(
          window.localStorage.getItem(MEMO_STORAGE_KEY),
          [] as Array<{ content: string; created_at: string }>,
        );
        const next = [
          ...prev,
          {
            content: interaction.ui_payload.content,
            created_at: new Date().toISOString(),
          },
        ].slice(-3);
        window.localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(next));
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            const channel = new BroadcastChannel(MEMO_BROADCAST_CHANNEL);
            channel.postMessage({ type: 'memo_update', memos: next });
            channel.close();
          }
        } catch {
          // ignore broadcast failures
        }
      } catch {
        // ignore storage failures
      }
      const confirmText = sanitizeText(
        interaction.audio_text
        || interaction.ui_payload?.display_text
        || '记下来了，我已经帮你保存这条闪念。',
      );
      if (confirmText && isHomeView) {
        setHomeChatBubble(wrapTextByWidth(confirmText));
      } else if (confirmText && isTimerView) {
        setSpeechBubble(confirmText);
      }
      return;
    }

    if (interaction.type === 'chat') {
      const assistantText = sanitizeText(interaction.audio_text || '');
      if (isHomeView) {
        if (assistantText) {
          setHomeChatBubble(wrapTextByWidth(assistantText));
          void speakText(assistantText, 'apply_interaction_home');
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
        void speakText(assistantText, 'apply_interaction_task');
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
    const cleaned = sanitizeText(text);
    if (!cleaned) return null;
    const interaction = await requestIntent(cleaned);
    if (interaction?.type === 'chat' && isHomeView) {
      let accumulated = '';
      await runChatStream(cleaned, {
        logPrefix: 'text-stream',
        onStreamStart: () => {
          setHomeChatBubble('');
        },
        onPartial: (chunk) => {
          accumulated += chunk;
          const nextText = sanitizeText(accumulated);
          if (nextText) {
            setHomeChatBubble(wrapTextByWidth(nextText));
          }
        },
        onDone: async () => {
          const finalText = sanitizeText(accumulated);
          if (finalText) {
            setHomeChatBubble(wrapTextByWidth(finalText));
            void speakText(finalText, 'home_text_stream');
          }
        },
        onError: () => {
          const finalText = sanitizeText(accumulated);
          if (finalText) {
            setHomeChatBubble(wrapTextByWidth(finalText));
          }
        },
      });
      return interaction;
    }
    await applyInteraction(interaction, cleaned);
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
      const requestStart = performance.now();
      const form = new FormData();
      form.append('audio', audioBlob, 'voice.webm');
      const response = await fetch(`${API_BASE}/interaction/voice`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        const elapsed = Math.round(performance.now() - requestStart);
        console.warn('[voice] request_failed', { status: response.status, elapsed_ms: elapsed });
        throw new Error('Voice request failed');
      }
      const payload = await response.json();
      const timings = payload?.timings;
      if (timings) {
        console.log('[voice] timings', timings);
      }
      console.log('[voice] request_ms', Math.round(performance.now() - requestStart));
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

  const stopActiveVoiceCapture = () => {
    if (mediaRecorderRef.current) {
      stopRecording();
      return;
    }
    stopWsAudioRecording();
  };

  const handleHomeAudioClick = () => {
    if (isRecording) {
      stopActiveVoiceCapture();
    } else {
      void startStreamingVoiceInteraction({
        page: 'home',
        durationMs: 0,
        chunkMs: 300,
        message: 'home_voice',
        useUi: true,
        fallbackHandler: sendVoiceIntent,
      });
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
                const snippet = String(interaction.audio_text ?? '').replace(/\s+/g, ' ').slice(0, 80);
                const source = 'task_breakdown';
                  if (isWsAudioActive()) {
                    console.log('[speak_api] suppressed_during_ws', { source, text: snippet });
                  } else {
                    console.log('[speak_api] request', { source, text: snippet });
                    const speakResponse = await fetch(`${API_BASE}/interaction/speak`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ text: interaction.audio_text, emotion: 'neutral' }),
                    });
                    if (speakResponse.ok) {
                      const payload = await speakResponse.json();
                      playAudioFromBase64(
                        payload?.data?.audio?.base64,
                        payload?.data?.audio?.format,
                        `speak_api:${source}`,
                        snippet,
                      );
                    }
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
      const requestStart = performance.now();
      const form = new FormData();
      form.append('audio', audioBlob, 'voice.webm');
      const response = await fetch(`${API_BASE}/interaction/voice`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        const elapsed = Math.round(performance.now() - requestStart);
        console.warn('[voice-chat] request_failed', { status: response.status, elapsed_ms: elapsed });
        return;
      }
      const payload = await response.json();
      const timings = payload?.timings;
      if (timings) {
        console.log('[voice-chat] timings', timings);
      }
      console.log('[voice-chat] request_ms', Math.round(performance.now() - requestStart));
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
      stopActiveVoiceCapture();
    } else {
      void startStreamingVoiceInteraction({
        page: 'task',
        durationMs: 0,
        chunkMs: 300,
        message: 'task_voice',
        useUi: true,
        fallbackHandler: sendVoiceChat,
      });
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
      const requestStart = performance.now();
      const form = new FormData();
      form.append('audio', audioBlob, 'voice.webm');
      const response = await fetch(`${API_BASE}/interaction/voice`, {
        method: 'POST',
        body: form,
      });
      if (!response.ok) {
        const elapsed = Math.round(performance.now() - requestStart);
        console.warn('[voice-focus] request_failed', { status: response.status, elapsed_ms: elapsed });
        return;
      }
      const payload = await response.json();
      const timings = payload?.timings;
      if (timings) {
        console.log('[voice-focus] timings', timings);
      }
      console.log('[voice-focus] request_ms', Math.round(performance.now() - requestStart));
      const userText = sanitizeText(payload?.data?.user?.text || '');
      const interaction = payload?.data?.interaction;
      if (interaction?.type === 'command' && interaction.ui_payload?.command === 'save_memo') {
        await applyInteraction(interaction, userText);
        return;
      }
      await handleFocusUserText(userText);
    } finally {
      endThinking();
    }
  };

  // streaming test path (text-only SSE)
  const runChatStreamTest = async (message?: string) => {
    let accumulated = '';
    await runChatStream(message ?? '', {
      logPrefix: 'chat-stream',
      onPartial: (chunk) => {
        accumulated += chunk;
        console.log('[chat-stream] partial', accumulated);
      },
    });
  };

  // chunked TTS test path (text only)
  const runSpeakChunksTest = async (message?: string, emotion?: string) => {
    const text = (message ?? '').trim();
    if (!text) {
      console.warn('[speak-chunks] empty text');
      return;
    }
    const requestStart = performance.now();
    console.log('[speak-chunks] request_start_ms', Math.round(requestStart));

    const runId = speakChunksStateRef.current.id + 1;
    speakChunksStateRef.current.id = runId;
    if (speakChunksStateRef.current.controller) {
      speakChunksStateRef.current.controller.abort();
    }
    const controller = new AbortController();
    speakChunksStateRef.current.controller = controller;

    if (speakChunksStateRef.current.audio) {
      speakChunksStateRef.current.audio.pause();
      speakChunksStateRef.current.audio.currentTime = 0;
      speakChunksStateRef.current.audio.src = '';
    }

    let payload: any;
    try {
      const response = await fetch(`${API_BASE}/interaction/speak-chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          emotion: (emotion || 'neutral').trim() || 'neutral',
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        console.warn('[speak-chunks] request_failed', { status: response.status });
        return;
      }
      payload = await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        console.warn('[speak-chunks] aborted');
        return;
      }
      console.warn('[speak-chunks] request_error', error);
      return;
    }

    console.log('[speak-chunks] response_received_ms', Math.round(performance.now() - requestStart));
    const chunks = Array.isArray(payload?.chunks) ? payload.chunks : [];
    if (!chunks.length) {
      console.warn('[speak-chunks] empty chunks');
      return;
    }

    const audio = new Audio();
    audio.preload = 'auto';
    speakChunksStateRef.current.audio = audio;

    const playChunk = (src: string) =>
      new Promise<void>((resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const onEnded = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('audio error'));
        };
        const onAbort = () => {
          cleanup();
          audio.pause();
          audio.src = '';
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const cleanup = () => {
          audio.removeEventListener('ended', onEnded);
          audio.removeEventListener('error', onError);
          controller.signal.removeEventListener('abort', onAbort);
        };
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('error', onError);
        controller.signal.addEventListener('abort', onAbort);
        audio.src = src;
        audio.currentTime = 0;
        audio.play().catch((error) => {
          cleanup();
          reject(error);
        });
      });

    let firstChunkLogged = false;
    for (const chunk of chunks) {
      if (controller.signal.aborted || speakChunksStateRef.current.id !== runId) return;
      const audioBase64 = chunk?.audio_base64;
      if (!audioBase64) {
        console.warn('[speak-chunks] missing audio', { index: chunk?.index });
        return;
      }
      const mime = chunk?.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
      const dataUrl = `data:${mime};base64,${audioBase64}`;
      console.log('[speak-chunks] play_start', { index: chunk?.index, text: chunk?.text });
      if (!firstChunkLogged) {
        firstChunkLogged = true;
        console.log('[speak-chunks] first_chunk_play_start_ms', Math.round(performance.now() - requestStart));
      }
      try {
        await playChunk(dataUrl);
      } catch (error) {
        if (controller.signal.aborted || speakChunksStateRef.current.id !== runId) {
          console.warn('[speak-chunks] aborted');
          return;
        }
        console.warn('[speak-chunks] play_error', error);
        return;
      }
      console.log('[speak-chunks] play_end', { index: chunk?.index });
    }
    console.log('[speak-chunks] final_chunk_play_end_ms', Math.round(performance.now() - requestStart));
    if (speakChunksStateRef.current.id === runId) {
      speakChunksStateRef.current.controller = null;
    }
  };

  // WebSocket test path (mock protocol only)
  const runWsTest = (message?: string) => {
    const text = (message ?? '').trim();
    const requestStart = performance.now();
    console.log('[ws-test] request_start_ms', Math.round(requestStart));

    const runId = wsTestStateRef.current.id + 1;
    wsTestStateRef.current.id = runId;
    if (wsTestStateRef.current.socket) {
      wsTestStateRef.current.socket.close(1000, 'replaced');
    }

    const socket = new WebSocket(buildWsUrl('/interaction/ws'));
    wsTestStateRef.current.socket = socket;
    const turnId = `turn-${Date.now()}`;
    let firstMessageLogged = false;
    let firstPartialLogged = false;
    let doneLogged = false;
    let errorLogged = false;

    socket.addEventListener('open', () => {
      if (wsTestStateRef.current.id !== runId) {
        socket.close(1000, 'stale');
        return;
      }
      console.log('[ws-test] ws_connect_ms', Math.round(performance.now() - requestStart));
      socket.send(JSON.stringify({ type: 'start_turn', turn_id: turnId, text }));
      socket.send(JSON.stringify({ type: 'end_audio', turn_id: turnId }));
    });

    socket.addEventListener('message', (event) => {
      if (wsTestStateRef.current.id !== runId) return;
      if (!firstMessageLogged) {
        firstMessageLogged = true;
        console.log('[ws-test] first_message_ms', Math.round(performance.now() - requestStart));
      }
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        console.warn('[ws-test] parse_error', error);
        return;
      }
      console.log('[ws-test] message', payload);
      if (payload?.type === 'partial_text' && !firstPartialLogged) {
        firstPartialLogged = true;
        console.log('[ws-test] first_partial_text_ms', Math.round(performance.now() - requestStart));
      }
      if (payload?.type === 'done') {
        if (!doneLogged) {
          doneLogged = true;
          console.log('[ws-test] ws_done_ms', Math.round(performance.now() - requestStart));
        }
        socket.close(1000, 'done');
        return;
      }
      if (payload?.type === 'error') {
        if (!errorLogged) {
          errorLogged = true;
          console.log('[ws-test] ws_error_ms', Math.round(performance.now() - requestStart));
        }
        socket.close(1000, 'error');
      }
    });

    socket.addEventListener('error', () => {
      if (wsTestStateRef.current.id !== runId) return;
      if (!errorLogged) {
        errorLogged = true;
        console.log('[ws-test] ws_error_ms', Math.round(performance.now() - requestStart));
      }
    });

    socket.addEventListener('close', () => {
      if (wsTestStateRef.current.id !== runId) return;
      if (!doneLogged && !errorLogged) {
        console.log('[ws-test] ws_done_ms', Math.round(performance.now() - requestStart));
      }
      wsTestStateRef.current.socket = null;
    });
  };

  // WS audio full loop test path (audio -> ASR fallback -> LLM -> chunked TTS)
  const startStreamingVoiceInteraction = async ({
      page,
      durationMs = 3000,
      chunkMs = 300,
      message = 'ws audio test',
      useUi = false,
      fallbackHandler,
    }: StreamingVoiceInteractionOptions) => {
    const logTag = `[VoiceWS][${page}]`;
    if (isRecording || mediaRecorderRef.current || wsAudioStateRef.current.recorder) {
      console.warn(`${logTag} recording_already_active`);
      return;
    }
    const requestStart = performance.now();
    console.log(`${logTag} start`, { durationMs, chunkMs, message, useUi });
    console.log('[ws-audio] ws_audio_record_start_ms', Math.round(performance.now() - requestStart));
    if (audioPlayerRef.current) {
      console.log('[ws-audio] audio_player_reset', {
        hadSrc: Boolean(audioPlayerRef.current.src),
        paused: audioPlayerRef.current.paused,
      });
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
      audioPlayerRef.current.src = '';
    }
    let assistantBuffer = '';
    let thinkingStarted = false;
    let recorderStarted = false;
    let allowEnd = true;
    let interactionHandled = false;
    let focusTranscriptHandled = false;
    let finalTranscript = '';
    let pendingFocusEndAfterReply = false;
    let taskUserCommitted = false;
    let taskAssistantMessageId: string | null = null;
    let queuedInteractionSpeech: { text: string; source: string } | null = null;
    const watchdogMs = 30000;
    const queueInteractionSpeech = (interaction: any) => {
      const text = sanitizeText(String(interaction?.audio_text ?? ''));
      if (!text) return;
      queuedInteractionSpeech = {
        text,
        source: `voice_ws_${page}_${String(interaction?.type ?? 'other')}`,
      };
    };
    const flushQueuedInteractionSpeech = () => {
      if (!queuedInteractionSpeech) return;
      const nextSpeech = queuedInteractionSpeech;
      queuedInteractionSpeech = null;
      window.setTimeout(() => {
        void speakText(nextSpeech.text, nextSpeech.source, { allowDuringWs: true });
      }, 120);
    };
    const commitTaskUserMessage = (text: string) => {
      if (page !== 'task' || taskUserCommitted) return;
      const cleaned = sanitizeText(text);
      if (!cleaned) return;
      appendTaskMessage('user', cleaned);
      taskUserCommitted = true;
    };
    const ensureTaskAssistantMessage = () => {
      if (page !== 'task') return null;
      if (!taskAssistantMessageId) {
        taskAssistantMessageId = appendTaskMessage('assistant', '');
      }
      return taskAssistantMessageId;
    };
    const applyFocusStreamState = (state: any) => {
      if (page !== 'focus' || !state || typeof state !== 'object') return;
      const nextSessionId = typeof state.session_id === 'string' ? state.session_id : '';
      const nextTaskText = sanitizeText(String(state.task_text ?? ''));
      if (nextSessionId) {
        setFocusSessionId(nextSessionId);
        focusSessionIdRef.current = nextSessionId;
      }
      if (nextTaskText) {
        setFocusTaskText(nextTaskText);
        focusTaskTextRef.current = nextTaskText;
      }
      if (typeof state.awaiting_rest_response === 'boolean') {
        setIsAwaitingRestDecision(state.awaiting_rest_response);
      }
      if (state.start_focus_monitors) {
        scheduleScreenCheck(0);
        scheduleFatigueCheck(6 * 60 * 1000);
      }
      if (state.end_focus_after_reply) {
        pendingFocusEndAfterReply = true;
      }
      console.log(`${logTag} focus_state_applied`, state);
    };
    const maybeFinishFocusAfterReply = () => {
      if (page !== 'focus' || !pendingFocusEndAfterReply) return;
      pendingFocusEndAfterReply = false;
      handleEndFocus();
    };
    const fallbackToUploadVoice = (reason: string) => {
      if (!useUi) return;
      console.warn(`${logTag} fallback_to_upload`, { reason });
      void startRecording(fallbackHandler);
    };
    const closeWsAudio = (reason: string) => {
      const ws = wsAudioStateRef.current.socket;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      console.log(`${logTag} close_requested`, {
        turnId: wsAudioStateRef.current.turnId,
        reason,
      });
      console.log('[ws-audio] ws_close_called', {
        turnId: wsAudioStateRef.current.turnId,
        reason,
      });
      ws.close(1000, reason);
    };
    const clearWatchdog = () => {
      if (wsAudioStateRef.current.watchdogTimer) {
        window.clearTimeout(wsAudioStateRef.current.watchdogTimer);
        wsAudioStateRef.current.watchdogTimer = null;
      }
    };
    const triggerWatchdog = (reason: string) => {
      if (!useUi || wsAudioStateRef.current.watchdogTimer) return;
      wsAudioStateRef.current.watchdogTimer = window.setTimeout(() => {
        console.warn('[ws-audio] watchdog_timeout_triggered', { reason });
        allowEnd = false;
        wsAudioStateRef.current.stopRequested = false;
        setIsRecording(false);
        endThinkingOnce();
        if (wsAudioStateRef.current.recorder && wsAudioStateRef.current.recorder.state !== 'inactive') {
          wsAudioStateRef.current.recorder.stop();
        }
        closeWsAudio('watchdog_timeout');
        setAvatarSpeechState('idle');
        if (useUi) {
          const hint = '响应超时，请重试。';
          setChatAssistantText(hint);
          if (page === 'home') {
            setHomeChatBubble(wrapTextByWidth(hint));
          } else if (page === 'focus') {
            setSpeechBubble(hint);
          }
        }
      }, watchdogMs);
    };
      const startThinkingOnce = () => {
        if (!useUi || thinkingStarted) return;
        thinkingStarted = true;
        beginThinking();
      };
      const endThinkingOnce = () => {
      if (!useUi || !thinkingStarted) return;
      thinkingStarted = false;
        endThinking();
      };
      if (useUi) {
        setChatAssistantText('');
        if (page === 'home') {
          setHomeChatBubble('');
        } else if (page === 'focus') {
          setSpeechBubble('');
        }
      }

    const runId = wsAudioStateRef.current.id + 1;
    wsAudioStateRef.current.id = runId;
    wsAudioStateRef.current.page = page;
    wsAudioStateRef.current.stopRequested = false;
    wsAudioStateRef.current.useUi = useUi;
    wsAudioStateRef.current.turnActive = true;
    wsAudioStateRef.current.ttsDone = false;
    wsAudioStateRef.current.pendingAudio = 0;
    wsAudioStateRef.current.endAudioSent = false;
    clearWatchdog();
    if (wsAudioStateRef.current.socket) {
      console.log('[ws-audio] ws_close_called', {
        turnId: wsAudioStateRef.current.turnId,
        reason: 'replaced',
      });
      wsAudioStateRef.current.socket.close(1000, 'replaced');
    }
    if (wsAudioStateRef.current.recorder && wsAudioStateRef.current.recorder.state !== 'inactive') {
      wsAudioStateRef.current.recorder.stop();
    }
    if (wsAudioStateRef.current.stream) {
      wsAudioStateRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    if (wsAudioStateRef.current.stopTimer) {
      window.clearTimeout(wsAudioStateRef.current.stopTimer);
      wsAudioStateRef.current.stopTimer = null;
    }
    if (wsAudioStateRef.current.audio) {
      wsAudioStateRef.current.audio.pause();
      wsAudioStateRef.current.audio.currentTime = 0;
      wsAudioStateRef.current.audio.src = '';
      wsAudioStateRef.current.audio.dataset.source = 'other';
      wsAudioStateRef.current.audio.dataset.wsRunId = '';
      wsAudioStateRef.current.audio = null;
    }

    const socket = new WebSocket(buildWsUrl('/interaction/ws'));
    wsAudioStateRef.current.socket = socket;
    const turnId = `turn-audio-${Date.now()}`;
    wsAudioStateRef.current.turnId = turnId;
    let firstChunkLogged = false;
    let totalChunks = 0;
    let pendingSends = 0;
    let firstPartialLogged = false;
    let firstPartialTextLogged = false;
    let doneLogged = false;
    let errorLogged = false;
    let firstAudioChunkReceivedLogged = false;
    let firstAudioPlayLogged = false;
    let finalAudioPlayLogged = false;
    let expectedSeq = 0;
    let seq = 0;
    let lastStableAsrText = '';
    let currentPlayingSeq: number | null = null;
    const audioQueue = new Map<number, { audio: string; format?: string; text?: string }>();
    const audioPlayer = ensureAudioPlayer();
    wsAudioStateRef.current.audio = audioPlayer;
    const updateAudioQueueState = () => {
      wsAudioStateRef.current.pendingAudio = audioQueue.size;
    };
    const isNoisyPartial = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return true;
      if (/^\d$/.test(trimmed)) return true;
      if (/^\d{1,2}$/.test(trimmed)) return true;
      const hasLetters = /[A-Za-z\u4e00-\u9fff]/.test(trimmed);
      if (!hasLetters && trimmed.length <= 1) return true;
      return false;
    };

    const sendEndAudioOnce = (reason: string) => {
      const alreadySent = wsAudioStateRef.current.endAudioSent;
      console.log('[ws-audio] end_audio_send_attempt', { turnId, alreadySent, reason });
      if (alreadySent) {
        console.log('[ws-audio] end_audio_send_skipped_duplicate', { turnId, reason });
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      wsAudioStateRef.current.endAudioSent = true;
      socket.send(JSON.stringify({ type: 'end_audio', turn_id: turnId }));
      console.log('[ws-audio] end_audio_sent', { turnId, reason });
      triggerWatchdog('await_done');
    };

    const maybeSendEnd = (reason: string) => {
      if (!allowEnd) return;
      if (!wsAudioStateRef.current.stopRequested || pendingSends > 0) return;
      startThinkingOnce();
      sendEndAudioOnce(reason);
    };

    const blobToBase64 = async (blob: Blob) => {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    };
    const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    };
    const resampleTo16k = (input: Float32Array, inputRate: number) => {
      if (inputRate === 16000) return input;
      const ratio = inputRate / 16000;
      const length = Math.max(1, Math.floor(input.length / ratio));
      const output = new Float32Array(length);
      for (let i = 0; i < length; i += 1) {
        const origin = i * ratio;
        const left = Math.floor(origin);
        const right = Math.min(left + 1, input.length - 1);
        const weight = origin - left;
        output[i] = input[left] * (1 - weight) + input[right] * weight;
      }
      return output;
    };
    const floatToInt16 = (input: Float32Array) => {
      const output = new Int16Array(input.length);
      for (let i = 0; i < input.length; i += 1) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return output;
    };

    socket.addEventListener('open', async () => {
      if (wsAudioStateRef.current.id !== runId) {
        closeWsAudio('stale');
        return;
      }
      console.log('[ws-audio] ws_open', { turnId });
      if (useUi) {
        console.log('[ws-audio] ws_connect_ms', Math.round(performance.now() - requestStart));
      }
      socket.send(JSON.stringify({
        type: 'start_turn',
        turn_id: turnId,
        text: message,
        mode: 'audio',
        page,
        context: page === 'focus'
          ? {
            focus_session_id: focusSessionIdRef.current,
            remaining_seconds: remainingSecondsRef.current,
          }
          : undefined,
      }));

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        console.warn('[ws-audio] getUserMedia failed', error);
        closeWsAudio('mic_failed');
        fallbackToUploadVoice('mic_failed');
        return;
      }

      if (wsAudioStateRef.current.id !== runId) {
        stream.getTracks().forEach((track) => track.stop());
        closeWsAudio('stale');
        return;
      }
      wsAudioStateRef.current.stream = stream;

      const stopPcmCapture = async () => {
        if (!wsAudioStateRef.current.pcmActive) return;
        wsAudioStateRef.current.pcmActive = false;
        const processor = wsAudioStateRef.current.pcmProcessor;
        const source = wsAudioStateRef.current.pcmSource;
        const workletNode = wsAudioStateRef.current.pcmWorkletNode;
        const context = wsAudioStateRef.current.pcmContext;
        wsAudioStateRef.current.pcmProcessor = null;
        wsAudioStateRef.current.pcmSource = null;
        wsAudioStateRef.current.pcmWorkletNode = null;
        wsAudioStateRef.current.pcmContext = null;
        try {
          if (workletNode?.port) {
            workletNode.port.postMessage({ type: 'flush' });
            await new Promise((resolve) => window.setTimeout(resolve, 20));
          }
          if (socket.readyState === WebSocket.OPEN) {
            flushPendingPcm(true);
          }
          processor?.disconnect();
          source?.disconnect();
          workletNode?.port?.close?.();
          workletNode?.disconnect();
        } catch {
          // ignore
        }
        try {
          wsAudioStateRef.current.stream?.getTracks().forEach((track) => track.stop());
        } catch {
          // ignore
        }
        wsAudioStateRef.current.stream = null;
        setIsRecording(false);
        try {
          await context?.close();
        } catch {
          // ignore
        }
      };

      const enablePcmCapture = useUi;
      let pcmInitOk = false;
      const pcmChunkSize = 1024;
      const pcmSendTargetFrames = 1600;
      const pcmSendTargetBytes = pcmSendTargetFrames * 2;
      const pcmSendTargetMs = Math.round((pcmSendTargetFrames / 16000) * 1000);
      let pendingPcm = new Int16Array(0);
      const sendPcmChunkNow = (pcm16: Int16Array) => {
        if (!pcm16.length) return;
        try {
          pendingSends += 1;
          if (!firstChunkLogged) {
            firstChunkLogged = true;
            console.log('[ws-audio] first_audio_chunk_sent_ms', Math.round(performance.now() - requestStart));
          }
          totalChunks += 1;
          const currentSeq = seq;
          seq += 1;
          socket.send(JSON.stringify({
            type: 'audio_chunk',
            turn_id: turnId,
            seq: currentSeq,
            audio: arrayBufferToBase64(pcm16.buffer),
            mime_type: 'audio/pcm;codec=s16le',
            sample_rate: 16000,
            mock: false,
          }));
          console.log('[ws-audio] audio_chunk_sent', { seq: currentSeq, bytes: pcm16.byteLength });
        } catch (error) {
          console.warn('[ws-audio] pcm_chunk_send_failed', error);
        } finally {
          pendingSends -= 1;
          maybeSendEnd('pcm_chunk_sent');
        }
      };
      const flushPendingPcm = (force: boolean) => {
        while (pendingPcm.length >= pcmSendTargetFrames || (force && pendingPcm.length > 0)) {
          const frames = pendingPcm.length >= pcmSendTargetFrames ? pcmSendTargetFrames : pendingPcm.length;
          const chunk = new Int16Array(frames);
          chunk.set(pendingPcm.subarray(0, frames));
          sendPcmChunkNow(chunk);
          if (pendingPcm.length <= frames) {
            pendingPcm = new Int16Array(0);
          } else {
            pendingPcm = pendingPcm.subarray(frames);
          }
        }
      };
      const queuePcmChunk = (pcm16: Int16Array, forceFlush = false) => {
        if (pcm16.length) {
          if (!pendingPcm.length) {
            pendingPcm = pcm16.slice();
          } else {
            const merged = new Int16Array(pendingPcm.length + pcm16.length);
            merged.set(pendingPcm, 0);
            merged.set(pcm16, pendingPcm.length);
            pendingPcm = merged;
          }
        }
        flushPendingPcm(forceFlush);
      };

      if (enablePcmCapture) {
        try {
          const AudioContextRef = window.AudioContext || (window as any).webkitAudioContext;
          const context = new AudioContextRef({ sampleRate: 16000 });
          if (!context.audioWorklet) {
            throw new Error('audioWorklet_unavailable');
          }
          await context.audioWorklet.addModule(new URL('./worklets/pcm-worklet.ts', import.meta.url));
          const actualRate = context.sampleRate;
          console.log('[ws-audio] audio_worklet_init_ok');
          console.log('[ws-audio] pcm_capture_init_ok');
          console.log('[ws-audio] pcm_sample_rate', { actual: actualRate, target: 16000 });
          console.log('[ws-audio] pcm_chunk_size', {
            capture_frames: pcmChunkSize,
            send_target_frames: pcmSendTargetFrames,
            send_target_bytes: pcmSendTargetBytes,
            approx_ms: pcmSendTargetMs,
          });
          const source = context.createMediaStreamSource(stream);
          const workletNode = new AudioWorkletNode(context, 'pcm-capture', {
            processorOptions: { chunkSize: pcmChunkSize },
          });
          const silence = context.createGain();
          silence.gain.value = 0;
          workletNode.port.onmessage = (event) => {
            if (wsAudioStateRef.current.id !== runId) return;
            if (socket.readyState !== WebSocket.OPEN) return;
            const payload = event.data as { type?: string; buffer?: ArrayBuffer };
            if (!payload?.type || !payload.buffer) return;
            if (!wsAudioStateRef.current.pcmActive && payload.type !== 'flush') return;
            if (wsAudioStateRef.current.stopRequested && payload.type !== 'flush') return;
            const floatData = new Float32Array(payload.buffer);
            const resampled = resampleTo16k(floatData, actualRate);
            const pcm16 = floatToInt16(resampled);
            if (payload.type === 'flush') {
              if (floatData.length) {
                console.log('[ws-audio] pcm_tail_flush', {
                  frames: floatData.length,
                  resampled_frames: resampled.length,
                });
                console.log('[ws-audio] final_audio_chunk_sent_ms', Math.round(performance.now() - requestStart));
              }
              queuePcmChunk(pcm16, true);
              return;
            }
            queuePcmChunk(pcm16);
          };
          source.connect(workletNode);
          workletNode.connect(silence);
          silence.connect(context.destination);
          await context.resume().catch(() => {});
          wsAudioStateRef.current.pcmContext = context;
          wsAudioStateRef.current.pcmSource = source;
          wsAudioStateRef.current.pcmWorkletNode = workletNode;
          wsAudioStateRef.current.pcmActive = true;
          pcmInitOk = true;
          recorderStarted = true;
          setIsRecording(true);
        } catch (error) {
          console.warn('[ws-audio] audio_worklet_init_failed', error);
          console.warn('[ws-audio] audio_worklet_fallback_triggered');
          await stopPcmCapture();
        }
      }

      if (pcmInitOk) {
        if (durationMs > 0) {
          wsAudioStateRef.current.stopTimer = window.setTimeout(() => {
          wsAudioStateRef.current.stopRequested = true;
            stopPcmCapture().finally(() => {
              maybeSendEnd('pcm_stop_timer');
            });
          }, durationMs);
        }
        return;
      }

      if (enablePcmCapture) {
        try {
          const AudioContextRef = window.AudioContext || (window as any).webkitAudioContext;
          const context = new AudioContextRef({ sampleRate: 16000 });
          const actualRate = context.sampleRate;
          console.log('[ws-audio] pcm_capture_init_ok');
          console.log('[ws-audio] pcm_sample_rate', { actual: actualRate, target: 16000 });
          console.log('[ws-audio] pcm_chunk_size', {
            capture_frames: pcmChunkSize,
            send_target_frames: pcmSendTargetFrames,
            send_target_bytes: pcmSendTargetBytes,
            approx_ms: pcmSendTargetMs,
          });
          const source = context.createMediaStreamSource(stream);
          const processor = context.createScriptProcessor(pcmChunkSize, 1, 1);
          const silence = context.createGain();
          silence.gain.value = 0;
          processor.onaudioprocess = (event) => {
            if (wsAudioStateRef.current.id !== runId) return;
            if (!wsAudioStateRef.current.pcmActive) return;
            if (wsAudioStateRef.current.stopRequested) return;
            if (socket.readyState !== WebSocket.OPEN) return;
            const input = event.inputBuffer.getChannelData(0);
            const resampled = resampleTo16k(input, actualRate);
            const pcm16 = floatToInt16(resampled);
            queuePcmChunk(pcm16);
          };
          source.connect(processor);
          processor.connect(silence);
          silence.connect(context.destination);
          wsAudioStateRef.current.pcmContext = context;
          wsAudioStateRef.current.pcmSource = source;
          wsAudioStateRef.current.pcmProcessor = processor;
          wsAudioStateRef.current.pcmActive = true;
          recorderStarted = true;
          setIsRecording(true);
          pcmInitOk = true;
        } catch (error) {
          console.warn('[ws-audio] pcm_capture_init_failed', error);
          console.warn('[ws-audio] pcm_capture_fallback_triggered');
          await stopPcmCapture();
        }
      }

      const preferredMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm;codecs=pcm',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ];
      const selectedMimeType = preferredMimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type),
      ) || '';
      const recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);
      wsAudioStateRef.current.recorder = recorder;
      wsAudioStateRef.current.stream = stream;
      recorderStarted = true;
      let mediaSeq = 0;
      const mimeType = recorder.mimeType || selectedMimeType || 'audio/webm';
      const codecMatch = mimeType.match(/codecs=([^;]+)/);
      console.log('[ws-audio] recorder_mime', {
        selected: selectedMimeType || 'default',
        actual: mimeType,
      });
      console.log('[ws-audio] recorder_codec', { codec: codecMatch ? codecMatch[1] : 'unknown' });

      recorder.ondataavailable = async (event) => {
        if (wsAudioStateRef.current.id !== runId) return;
        if (!event.data || event.data.size === 0) return;
        if (socket.readyState !== WebSocket.OPEN) return;
        pendingSends += 1;
        const currentSeq = mediaSeq;
        mediaSeq += 1;
        try {
          const audio = await blobToBase64(event.data);
          if (!firstChunkLogged) {
            firstChunkLogged = true;
            console.log('[ws-audio] first_audio_chunk_sent_ms', Math.round(performance.now() - requestStart));
          }
          totalChunks += 1;
          socket.send(JSON.stringify({
            type: 'audio_chunk',
            turn_id: turnId,
            seq: currentSeq,
            audio,
            mime_type: mimeType,
            mock: false,
          }));
        } catch (error) {
          console.warn('[ws-audio] chunk_encode_failed', error);
        } finally {
          pendingSends -= 1;
          maybeSendEnd('media_chunk_sent');
        }
      };

      recorder.onstop = () => {
        if (wsAudioStateRef.current.id !== runId) return;
        wsAudioStateRef.current.stopRequested = true;
        stream.getTracks().forEach((track) => track.stop());
        wsAudioStateRef.current.stream = null;
        wsAudioStateRef.current.recorder = null;
        setIsRecording(false);
        console.log('[ws-audio] ws_audio_record_stop_ms', Math.round(performance.now() - requestStart));
        console.log('[ws-audio] total_chunks_sent', totalChunks);
        maybeSendEnd('recorder_stop');
      };

      recorder.start(chunkMs);
      setIsRecording(true);
      if (durationMs > 0) {
        wsAudioStateRef.current.stopTimer = window.setTimeout(() => {
          if (recorder.state !== 'inactive') {
            recorder.stop();
          }
        }, durationMs);
      }
    });

    socket.addEventListener('close', (event) => {
      if (wsAudioStateRef.current.id !== runId) return;
      const closeReason = event?.reason || 'socket_close';
      console.log(`${logTag} closed`, {
        turnId,
        code: event?.code,
        reason: closeReason,
      });
      console.log('[ws-audio] ws_onclose', {
        turnId,
        code: event?.code,
        reason: closeReason,
        hadFirstAudioChunk: firstAudioChunkReceivedLogged,
      });
      console.log('[ws-audio] turn_cleanup', { turnId, reason: closeReason });
      clearWatchdog();
      if (audioQueue.size > 0) {
        audioQueue.clear();
        updateAudioQueueState();
        console.log('[ws-audio] audio_queue_cleared', { reason: 'socket_close' });
      }
      if (wsAudioStateRef.current.stopTimer) {
        window.clearTimeout(wsAudioStateRef.current.stopTimer);
        wsAudioStateRef.current.stopTimer = null;
      }
      if (wsAudioStateRef.current.recorder && wsAudioStateRef.current.recorder.state !== 'inactive') {
        wsAudioStateRef.current.recorder.stop();
      }
      if (wsAudioStateRef.current.stream) {
        wsAudioStateRef.current.stream.getTracks().forEach((track) => track.stop());
      }
      if (wsAudioStateRef.current.pcmActive) {
        wsAudioStateRef.current.stopRequested = true;
        wsAudioStateRef.current.pcmActive = false;
        wsAudioStateRef.current.pcmProcessor?.disconnect();
        wsAudioStateRef.current.pcmSource?.disconnect();
        wsAudioStateRef.current.pcmContext?.close().catch(() => {});
        wsAudioStateRef.current.pcmProcessor = null;
        wsAudioStateRef.current.pcmSource = null;
        wsAudioStateRef.current.pcmContext = null;
      }
      if (wsAudioStateRef.current.audio) {
        const currentAudio = wsAudioStateRef.current.audio;
        const isCurrentWsAudio =
          currentAudio.dataset.source === 'ws_audio'
          && currentAudio.dataset.wsRunId === String(runId);
        if (isCurrentWsAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio.src = '';
          currentAudio.dataset.source = 'other';
          currentAudio.dataset.wsRunId = '';
        }
      }
      wsAudioStateRef.current.recorder = null;
      wsAudioStateRef.current.stream = null;
      wsAudioStateRef.current.pcmActive = false;
      wsAudioStateRef.current.socket = null;
      wsAudioStateRef.current.turnId = null;
      wsAudioStateRef.current.page = null;
      wsAudioStateRef.current.audio = null;
      wsAudioStateRef.current.stopRequested = false;
      wsAudioStateRef.current.useUi = false;
      wsAudioStateRef.current.watchdogTimer = null;
      wsAudioStateRef.current.turnActive = false;
      wsAudioStateRef.current.ttsDone = false;
      wsAudioStateRef.current.pendingAudio = 0;
      wsAudioStateRef.current.endAudioSent = false;
      setIsRecording(false);
      setAvatarSpeechState('idle');
      endThinkingOnce();
    });

    socket.addEventListener('message', async (event) => {
      if (wsAudioStateRef.current.id !== runId) return;
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch (error) {
        console.warn('[ws-audio] parse_error', error);
        return;
      }
      console.log('[ws-audio] message', payload);
      if (payload?.type === 'partial_asr') {
        if (!firstPartialLogged) {
          firstPartialLogged = true;
          console.log('[ws-audio] first_partial_asr_ms', Math.round(performance.now() - requestStart));
        }
        console.log('[ws-audio] partial_asr', payload.text);
        const asrText = String(payload?.text ?? '').trim();
        const isFinal = payload?.phase === 'final';
        const noisyPartial = isNoisyPartial(asrText);
        if (isFinal) {
          console.log('[ws-audio] final_asr_ms', Math.round(performance.now() - requestStart));
        }
        if (useUi) {
          if (isFinal) {
            const nextFinalText = (!noisyPartial && asrText) ? asrText : lastStableAsrText;
            if (nextFinalText) {
              setChatUserText(nextFinalText);
              lastStableAsrText = nextFinalText;
            }
          } else if (asrText && !noisyPartial) {
            setChatUserText(asrText);
            lastStableAsrText = asrText;
          } else if (asrText && noisyPartial) {
            console.log('[ws-audio] partial_asr_suppressed', { text: asrText });
          }
        }
        const effectiveText = isFinal
          ? ((asrText && !noisyPartial) ? asrText : lastStableAsrText)
          : '';
        if (isFinal && effectiveText) {
          finalTranscript = effectiveText;
          console.log(`${logTag} final_asr`, {
            turnId,
            text: effectiveText.replace(/\s+/g, ' ').slice(0, 80),
          });
        }
      }
      if (payload?.type === 'focus_state') {
        applyFocusStreamState(payload?.state);
        return;
      }
      if (payload?.type === 'interaction') {
        interactionHandled = true;
        const interaction = payload?.interaction;
        const userText = sanitizeText(String(payload?.user_text ?? finalTranscript ?? ''));
        console.log(`${logTag} interaction_received`, {
          turnId,
          type: interaction?.type,
          userText: userText.slice(0, 80),
        });
        if (page === 'task' && interaction?.type === 'breakdown') {
          commitTaskUserMessage(userText);
          const assistantText = sanitizeText(String(interaction?.audio_text ?? ''));
          if (assistantText) {
            appendTaskMessage('assistant', assistantText);
          }
        }
        try {
          await applyInteraction(interaction, userText);
          queueInteractionSpeech(interaction);
        } catch (error) {
          console.warn(`${logTag} interaction_apply_failed`, error);
        }
        return;
      }
      if (payload?.type === 'partial_text') {
        if (interactionHandled) return;
        if (!firstPartialTextLogged) {
          firstPartialTextLogged = true;
          console.log('[ws-audio] first_partial_text_ms', Math.round(performance.now() - requestStart));
        }
        const fragment = String(payload.text ?? '');
        assistantBuffer += fragment;
        console.log('[ws-audio] partial_text', fragment);
        if (useUi) {
          setChatAssistantText(assistantBuffer);
          if (page === 'home') {
            setHomeChatBubble(wrapTextByWidth(assistantBuffer));
          } else if (page === 'task') {
            if (finalTranscript) {
              commitTaskUserMessage(finalTranscript);
            }
            const assistantId = ensureTaskAssistantMessage();
            if (assistantId) {
              updateTaskMessage(assistantId, assistantBuffer);
            }
            if (!isInitialTaskLocked) {
              setIsInitialTaskLocked(true);
            }
          } else if (page === 'focus') {
            setSpeechBubble(assistantBuffer);
          }
        }
      }
      if (payload?.type === 'audio_chunk') {
        if (interactionHandled) return;
          const seq = typeof payload.seq === 'number' ? payload.seq : null;
          if (seq === null) {
            console.warn('[ws-audio] audio_chunk missing seq');
            return;
        }
          if (!payload.audio) {
            console.warn('[ws-audio] audio_chunk missing audio', { seq });
            return;
          }
          console.log('[ws-audio] audio_chunk_received', {
            seq,
            text: payload.text,
            len: typeof payload.audio === 'string' ? payload.audio.length : 0,
            source: payload.source,
            turnId,
          });
          if (!firstAudioChunkReceivedLogged) {
            firstAudioChunkReceivedLogged = true;
            console.log('[ws-audio] first_audio_chunk_received_ms', Math.round(performance.now() - requestStart));
          }
        if (seq < expectedSeq) {
          console.warn('[ws-audio] audio_chunk out_of_order', { expectedSeq, seq });
        } else if (seq > expectedSeq && !audioQueue.has(expectedSeq)) {
          console.warn('[ws-audio] audio_chunk gap_detected', { expectedSeq, seq });
        }
        audioQueue.set(seq, {
          audio: payload.audio,
          format: payload.format,
          text: payload.text,
        });
        updateAudioQueueState();
        console.log('[ws-audio] audio_chunk_enqueued', { seq, queueLength: audioQueue.size });

        const playNext = async () => {
          const isPlaying = Boolean(audioPlayer.src) && !audioPlayer.paused;
          console.log('[ws-audio] audio_playback_start_attempt', {
            seq: expectedSeq,
            queueLength: audioQueue.size,
            isPlaying,
            avatarSpeechState,
          });
          if (isPlaying) return;
            const next = audioQueue.get(expectedSeq);
            if (!next) return;
            audioQueue.delete(expectedSeq);
            expectedSeq += 1;
            updateAudioQueueState();
            console.log('[ws-audio] audio_chunk_play', {
              seq: expectedSeq - 1,
              text: next.text,
              audio_len: typeof next.audio === 'string' ? next.audio.length : 0,
            });
            const mime = next.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
            console.log('[audio] src_set', {
              source: 'ws_audio',
              seq: expectedSeq - 1,
              text: next.text,
              audio_len: typeof next.audio === 'string' ? next.audio.length : 0,
            });
            audioPlayer.dataset.source = 'ws_audio';
            audioPlayer.dataset.wsRunId = String(runId);
            audioPlayer.src = `data:${mime};base64,${next.audio}`;
            audioPlayer.currentTime = 0;
            setAvatarSpeechState('speaking');
            const playSeq = expectedSeq - 1;
            currentPlayingSeq = playSeq;
            if (!firstAudioPlayLogged) {
              firstAudioPlayLogged = true;
              console.log('[ws-audio] first_audio_play_start_ms', Math.round(performance.now() - requestStart));
            }
            try {
              console.log('[audio] play', { source: 'ws_audio', seq: playSeq, text: next.text });
              await audioPlayer.play();
              console.log('[ws-audio] audio_playback_started', { seq: playSeq });
          } catch (error) {
            console.warn('[ws-audio] playback_error', error);
            console.warn('[ws-audio] audio_playback_error', { seq: playSeq, error });
            console.warn('[ws-audio] audio_play_error', error);
            endThinkingOnce();
            if (socket.readyState === WebSocket.OPEN) {
              closeWsAudio('play_error');
            }
            return;
          }
          audioPlayer.onended = () => {
            if (wsAudioStateRef.current.id !== runId) return;
            console.log('[ws-audio] audio_playback_ended', {
              seq: currentPlayingSeq,
              queueLength: audioQueue.size,
              turnDone: doneLogged,
            });
            if (audioQueue.size === 0 && doneLogged && !finalAudioPlayLogged) {
              finalAudioPlayLogged = true;
              console.log('[ws-audio] final_audio_play_end_ms', Math.round(performance.now() - requestStart));
            }
            if (audioQueue.size === 0 && !doneLogged) {
              setAvatarSpeechState('speaking_hold');
            } else if (audioQueue.size === 0 && doneLogged) {
              setAvatarSpeechState('idle');
              wsAudioStateRef.current.turnActive = false;
              wsAudioStateRef.current.pendingAudio = 0;
              maybeFinishFocusAfterReply();
            }
            currentPlayingSeq = null;
            playNext();
          };
        };

        playNext();
      }
      if (payload?.type === 'done') {
        if (!doneLogged) {
          doneLogged = true;
          console.log('[ws-audio] ws_done_ms', Math.round(performance.now() - requestStart));
        }
        console.log(`${logTag} done`, {
          turnId,
          reason: payload?.reason,
          pendingAudio: audioQueue.size,
        });
        wsAudioStateRef.current.ttsDone = true;
        clearWatchdog();
        if (
          page === 'focus'
          && payload?.reason === 'transcript_ready'
          && finalTranscript
          && !focusTranscriptHandled
        ) {
          focusTranscriptHandled = true;
          console.log(`${logTag} transcript_ready`, {
            turnId,
            text: finalTranscript.replace(/\s+/g, ' ').slice(0, 80),
          });
          try {
            await handleFocusUserText(finalTranscript);
          } catch (error) {
            console.warn(`${logTag} focus_transcript_apply_failed`, error);
          }
        }
        if (audioQueue.size > 0) {
          const pendingSeqs = Array.from(audioQueue.keys()).sort((a, b) => a - b);
          console.warn('[ws-audio] audio_chunks_pending', { expectedSeq, pendingSeqs });
        }
        if (audioQueue.size === 0 && audioPlayer.paused && !finalAudioPlayLogged) {
          finalAudioPlayLogged = true;
          console.log('[ws-audio] final_audio_play_end_ms', Math.round(performance.now() - requestStart));
          setAvatarSpeechState('idle');
          wsAudioStateRef.current.turnActive = false;
          wsAudioStateRef.current.pendingAudio = 0;
          if (page === 'focus' && assistantBuffer) {
            setFocusPrompt(assistantBuffer);
          }
          maybeFinishFocusAfterReply();
        }
        if (payload?.reason === 'interaction') {
          flushQueuedInteractionSpeech();
          if (socket.readyState === WebSocket.OPEN) {
            closeWsAudio('interaction_done');
          }
        }
        if (page === 'focus' && assistantBuffer) {
          setFocusPrompt(assistantBuffer);
        }
        if (payload?.reason === 'transcript_ready' && socket.readyState === WebSocket.OPEN) {
          closeWsAudio('transcript_ready');
        }
        endThinkingOnce();
      }
      if (payload?.type === 'error') {
        if (!errorLogged) {
          errorLogged = true;
          console.log('[ws-audio] ws_error_ms', Math.round(performance.now() - requestStart));
        }
        clearWatchdog();
        setAvatarSpeechState('idle');
        wsAudioStateRef.current.turnActive = false;
        wsAudioStateRef.current.pendingAudio = 0;
        wsAudioStateRef.current.ttsDone = false;
        if (payload?.error_stage === 'tts') {
          console.warn('[ws-audio] tts_error', payload.message);
        }
        if (payload?.message === 'empty_asr_text') {
          console.warn('[ws-audio] empty_asr_detected');
        }
        if (useUi && payload?.message === 'empty_asr_text') {
          const hint = '刚才没听清楚，请再试一次。';
          setChatAssistantText(hint);
          if (page === 'home') {
            setHomeChatBubble(wrapTextByWidth(hint));
          } else if (page === 'focus') {
            setSpeechBubble(hint);
          }
        }
        allowEnd = false;
        endThinkingOnce();
        if (socket.readyState === WebSocket.OPEN) {
          closeWsAudio('error');
        }
      }
    });

    socket.addEventListener('error', (event) => {
      if (wsAudioStateRef.current.id !== runId) return;
      if (!errorLogged) {
        errorLogged = true;
        console.log('[ws-audio] ws_error_ms', Math.round(performance.now() - requestStart));
      }
      allowEnd = false;
      clearWatchdog();
      endThinkingOnce();
      setAvatarSpeechState('idle');
      wsAudioStateRef.current.turnActive = false;
      wsAudioStateRef.current.pendingAudio = 0;
      wsAudioStateRef.current.ttsDone = false;
      console.warn('[ws-audio] socket_error', event);
      if (useUi && !recorderStarted) {
        fallbackToUploadVoice('socket_error');
      }
      if (socket.readyState === WebSocket.OPEN) {
        closeWsAudio('error');
      }
    });
  };

  const runWsAudioTest = async (
    durationMs = 3000,
    chunkMs = 300,
    message = 'ws audio test',
    useUi = false,
  ) => startStreamingVoiceInteraction({
    page: 'home',
    durationMs,
    chunkMs,
    message,
    useUi,
    fallbackHandler: sendVoiceIntent,
  });

  const stopWsAudioRecording = () => {
    const sendEndAudioOnce = (reason: string) => {
      const turnId = wsAudioStateRef.current.turnId;
      const alreadySent = wsAudioStateRef.current.endAudioSent;
      console.log('[ws-audio] end_audio_send_attempt', { turnId, alreadySent, reason });
      if (alreadySent) {
        console.log('[ws-audio] end_audio_send_skipped_duplicate', { turnId, reason });
        return;
      }
      const ws = wsAudioStateRef.current.socket;
      if (!ws || ws.readyState !== WebSocket.OPEN || !turnId) return;
      wsAudioStateRef.current.endAudioSent = true;
      ws.send(JSON.stringify({
        type: 'end_audio',
        turn_id: turnId,
      }));
      console.log('[ws-audio] end_audio_sent', { turnId, reason });
    };
    if (wsAudioStateRef.current.recorder && wsAudioStateRef.current.recorder.state !== 'inactive') {
      wsAudioStateRef.current.stopRequested = true;
      wsAudioStateRef.current.recorder.stop();
      return;
    }
    if (wsAudioStateRef.current.pcmActive) {
      wsAudioStateRef.current.stopRequested = true;
      wsAudioStateRef.current.pcmActive = false;
      const cleanup = () => {
        wsAudioStateRef.current.pcmProcessor?.disconnect();
        wsAudioStateRef.current.pcmSource?.disconnect();
        wsAudioStateRef.current.pcmWorkletNode?.port?.close?.();
        wsAudioStateRef.current.pcmWorkletNode?.disconnect();
        wsAudioStateRef.current.pcmContext?.close().catch(() => {});
        wsAudioStateRef.current.pcmProcessor = null;
        wsAudioStateRef.current.pcmSource = null;
        wsAudioStateRef.current.pcmWorkletNode = null;
        wsAudioStateRef.current.pcmContext = null;
        wsAudioStateRef.current.stream?.getTracks().forEach((track) => track.stop());
        wsAudioStateRef.current.stream = null;
        setIsRecording(false);
        if (
          wsAudioStateRef.current.socket?.readyState === WebSocket.OPEN
          && wsAudioStateRef.current.turnId
        ) {
          sendEndAudioOnce('manual_stop');
          return;
        }
        if (wsAudioStateRef.current.socket?.readyState === WebSocket.OPEN) {
          console.log('[ws-audio] ws_close_called', {
            turnId: wsAudioStateRef.current.turnId,
            reason: 'manual_stop',
          });
          wsAudioStateRef.current.socket.close(1000, 'manual_stop');
        }
      };

      if (wsAudioStateRef.current.pcmWorkletNode?.port) {
        wsAudioStateRef.current.pcmWorkletNode.port.postMessage({ type: 'flush' });
        window.setTimeout(cleanup, 20);
      } else {
        cleanup();
      }
      return;
    }
    if (wsAudioStateRef.current.socket) {
      if (wsAudioStateRef.current.socket.readyState === WebSocket.OPEN) {
        console.log('[ws-audio] ws_close_called', {
          turnId: wsAudioStateRef.current.turnId,
          reason: 'manual_stop',
        });
      }
      wsAudioStateRef.current.socket.close(1000, 'manual_stop');
    }
  };

  const handleFocusAudioClick = () => {
    if (isRecording) {
      stopActiveVoiceCapture();
    } else {
      void startStreamingVoiceInteraction({
        page: 'focus',
        durationMs: 0,
        chunkMs: 300,
        message: 'focus_voice',
        useUi: true,
        fallbackHandler: sendFocusVoice,
      });
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
      const isCtrlQ = !event.shiftKey && (key === 'q' || code === 'KeyQ');
      const isCtrlShiftQ = event.shiftKey && (key === 'q' || code === 'KeyQ');
      const isCtrlE = key === 'e' || code === 'KeyE';
      if (isCtrlQ) {
        event.preventDefault();
        event.stopPropagation();
        triggerDemoFatigueCheck();
        return;
      }
      if (DEMO_SCREEN_CHECK_SHORTCUTS && (isCtrlShiftQ || isCtrlE)) {
        event.preventDefault();
        event.stopPropagation();
        triggerDemoScreenCheck(isCtrlShiftQ ? 'related' : 'unrelated');
        return;
      }
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

  useEffect(() => {
    (window as any).__flowmateChatStreamTest = runChatStreamTest;
    return () => {
      delete (window as any).__flowmateChatStreamTest;
    };
  }, []);

  useEffect(() => {
    (window as any).__flowmateSpeakChunksTest = runSpeakChunksTest;
    return () => {
      delete (window as any).__flowmateSpeakChunksTest;
    };
  }, []);

  useEffect(() => {
    (window as any).__flowmateWsTest = runWsTest;
    return () => {
      delete (window as any).__flowmateWsTest;
    };
  }, []);

  useEffect(() => {
    (window as any).__flowmateWsAudioTest = runWsAudioTest;
    return () => {
      delete (window as any).__flowmateWsAudioTest;
    };
  }, []);

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
    if (isWsAudioActive()) {
      console.log('[home] welcome_suppressed_during_ws');
      return;
    }
    setHomeChatBubble(wrapTextByWidth(HOME_WELCOME_TEXT));
    if (!hasPlayedHomeWelcomeAudioRef.current) {
      hasPlayedHomeWelcomeAudioRef.current = true;
      console.log('[HomeWelcome] first_entry_play_audio');
      void playHomeWelcomeAudio();
    } else {
      console.log('[HomeWelcome] reentry_skip_audio_show_bubble_only');
    }
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
    const activeVoicePage = wsAudioStateRef.current.page;
    const hasActiveVoiceWs = Boolean(
      activeVoicePage
      && (
        wsAudioStateRef.current.socket
        || wsAudioStateRef.current.recorder
        || wsAudioStateRef.current.pcmActive
        || wsAudioStateRef.current.stopRequested
      ),
    );
    if (hasActiveVoiceWs && activeVoicePage !== currentView) {
      console.log(`[VoiceWS][${activeVoicePage}] stop_on_view_change`, {
        nextView: currentView,
      });
      stopWsAudioRecording();
    }
    if (currentView !== 'break') {
      setBreakStretchQueued(false);
      setBreakStretchPlayed(false);
      setBreakPhase('rest_idle');
    }
  }, [currentView]);

  useEffect(() => {
    breakPhaseRef.current = breakPhase;
  }, [breakPhase]);

  useEffect(() => {
    if (currentView !== 'break') {
      if (breakPhaseRef.current !== 'rest_idle') {
        setBreakPhase('rest_idle');
      }
      if (audioPlayerRef.current && !audioPlayerRef.current.paused) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.currentTime = 0;
        audioPlayerRef.current.src = '';
      }
      return;
    }
    if (!breakStretchPlayed || breakPhase !== 'rest_stretching') return;
    if (!BREAK_FACTS.length) {
      setBreakPhase('rest_idle');
      return;
    }
    const fact = BREAK_FACTS[Math.floor(Math.random() * BREAK_FACTS.length)];
    console.log('[break] fact_ready', { fact });
    setBreakPhase('rest_fact_speaking');
    void speakText(fact, 'break_fact', { allowDuringWs: true });
  }, [currentView, breakStretchPlayed, breakPhase, BREAK_FACTS.length]);
  const isAvatarSpeaking = avatarSpeechState === 'speaking';
  const isAvatarHold = avatarSpeechState === 'speaking_hold';
  const isAvatarSpeechActive = avatarSpeechState !== 'idle';

  useEffect(() => {
    if (primaryView !== 'home' || currentView === 'profile' || isAvatarSpeechActive) return;
    const intervalId = window.setInterval(() => {
      setHomeIdleTick((prev) => prev + 1);
    }, 6000);
    return () => window.clearInterval(intervalId);
  }, [primaryView, currentView, isAvatarSpeechActive]);

  useEffect(() => {
    const video = avatarVideoRef.current;
    if (!video) return;
    const handleEnded = () => {
      if (video.dataset.state === 'stretch') {
        console.log('[break] stretch_ended');
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
    const shouldExitTalk = avatarSpeechState === 'idle' && video.dataset.state === 'talk';
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
    const holdAvatar = () => {
      if (video.dataset.state !== 'talk') {
        video.src = vidTalk;
        video.dataset.state = 'talk';
      }
      video.loop = false;
      try {
        video.currentTime = 0;
      } catch {
        // ignore seek errors
      }
      video.pause();
    };

    if (isBreakView) {
      if (isAvatarSpeaking) {
        playAvatar('talk', vidTalk, true, prevView !== currentView || video.dataset.state !== 'talk');
        return;
      }
      if (isAvatarHold) {
        holdAvatar();
        return;
      }
      if (breakStretchQueued && !breakStretchPlayed) {
        playAvatar('stretch', vidStretch, false, shouldResetBase || video.dataset.state !== 'stretch');
        return;
      }
      if (breakPhase === 'rest_idle') {
        playAvatar('idle', vidIdle, true, shouldResetBase || video.dataset.state !== 'idle');
      } else if (shouldResetBase) {
        playAvatar('idle', vidIdle, false, true);
      } else {
        video.pause();
      }
      return;
    }

    if (isFocusView) {
      if (isAvatarSpeaking) {
        playAvatar('talk', vidTalk, true, video.dataset.state !== 'talk');
      } else if (isAvatarHold) {
        holdAvatar();
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
      if (isAvatarHold) {
        holdAvatar();
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
      if (isAvatarHold) {
        holdAvatar();
        return;
      }
      if (shouldResetBase || homeIdleTick > 0) {
        playAvatar('idle', vidIdle, false, true);
      }
    }
  }, [
    currentView,
    avatarSpeechState,
    isBreakView,
    isFocusView,
    isTaskRunning,
    primaryView,
    breakStretchPlayed,
    breakStretchQueued,
    breakPhase,
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
      let continuePositiveTimer = false;
      try {
        const response = await fetch(`${API_BASE}/focus/finish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: focusSessionId }),
        });
        if (response.ok) {
          const data = await response.json();
          continuePositiveTimer = Boolean(data?.start_positive_timer);
        }
      } catch {
        // ignore finish errors
      }
      if (continuePositiveTimer) {
        setIsCountUp(true);
        console.log('[Focus] positive_timer_continue', { sessionId: focusSessionId });
        return;
      }
      enterBreakView();
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
