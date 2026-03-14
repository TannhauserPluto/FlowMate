import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MEMO_STORAGE_KEY,
  TODO_STORAGE_KEY,
  parseMemos,
  parseTodoState,
  readMemos,
  serializeTodoState,
  writeTodoState,
  type MemoItem,
  type StoredTodoState,
  type TodoEntry,
} from './lib/storage';

type MiniPanel = 'todo' | 'memo';
type MemoListItem = MemoItem & { id: string };
type Bounds = { x: number; y: number; width: number; height: number };
type ResizeState = {
  handle: string;
  startX: number;
  startY: number;
  startBounds: Bounds;
  axis?: 'width' | 'height';
};

const getBeijingDate = () =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date());


const MINI_DESIGN_WIDTH = 266;
const MINI_DESIGN_HEIGHT = 241;
const MINI_ASPECT_RATIO = MINI_DESIGN_WIDTH / MINI_DESIGN_HEIGHT;
const MINI_MIN_WIDTH = 220;
const MINI_MAX_WIDTH = 420;
const MINI_MIN_HEIGHT = Math.round(MINI_MIN_WIDTH / MINI_ASPECT_RATIO);
const MINI_MAX_HEIGHT = Math.round(MINI_MAX_WIDTH / MINI_ASPECT_RATIO);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const computeBounds = (state: ResizeState, dx: number, dy: number): Bounds => {
  const start = state.startBounds;
  let width = start.width;
  let height = start.height;
  let x = start.x;
  let y = start.y;

  const handle = state.handle;
  const fromLeft = handle.includes('left');
  const fromRight = handle.includes('right');
  const fromTop = handle.includes('top');
  const fromBottom = handle.includes('bottom');

  if (handle === 'left' || handle === 'right') {
    const delta = fromLeft ? -dx : dx;
    width = clamp(start.width + delta, MINI_MIN_WIDTH, MINI_MAX_WIDTH);
    height = Math.round(width / MINI_ASPECT_RATIO);
    if (fromLeft) x = start.x + (start.width - width);
    return { x, y, width, height };
  }

  if (handle === 'top' || handle === 'bottom') {
    const delta = fromTop ? -dy : dy;
    height = clamp(start.height + delta, MINI_MIN_HEIGHT, MINI_MAX_HEIGHT);
    width = Math.round(height * MINI_ASPECT_RATIO);
    if (fromTop) y = start.y + (start.height - height);
    return { x, y, width, height };
  }

  const preferWidth = state.axis === 'width';
  const preferHeight = state.axis === 'height';
  const useDx = preferWidth || (!preferHeight && Math.abs(dx) >= Math.abs(dy) * MINI_ASPECT_RATIO);
  if (useDx) {
    const delta = fromLeft ? -dx : dx;
    width = clamp(start.width + delta, MINI_MIN_WIDTH, MINI_MAX_WIDTH);
    height = Math.round(width / MINI_ASPECT_RATIO);
  } else {
    const delta = fromTop ? -dy : dy;
    height = clamp(start.height + delta, MINI_MIN_HEIGHT, MINI_MAX_HEIGHT);
    width = Math.round(height * MINI_ASPECT_RATIO);
  }

  if (fromLeft) x = start.x + (start.width - width);
  if (fromTop) y = start.y + (start.height - height);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
};

const MiniTodoCard = ({
  date,
  title,
  todoItems,
  doneItems,
  isActive,
  onActivate,
  onMarkDone,
  onRestore,
}: {
  date: string;
  title: string;
  todoItems: TodoEntry[];
  doneItems: TodoEntry[];
  isActive: boolean;
  onActivate: () => void;
  onMarkDone: (id: string) => void;
  onRestore: (id: string) => void;
}) => (
  <div
    className={`mini-card ${isActive ? 'is-front' : 'is-back'}`}
    role="button"
    tabIndex={0}
    aria-pressed={isActive}
    onClick={onActivate}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    }}
  >
    <div className="todo-meta">
      <span className="todo-date">{date}</span>
      <span className="todo-project">{title}</span>
    </div>
    <div className="todo-title-row">TO DO</div>
    <ul className="todo-list todo-list--todo">
      {todoItems.map((item) => (
        <li key={item.id} className="todo-item">
          <button
            className="todo-check"
            type="button"
            aria-label="Mark done"
            onClick={(event) => {
              event.stopPropagation();
              onMarkDone(item.id);
            }}
            disabled={!isActive}
          >
            <span className="todo-check-circle" />
          </button>
          <span className="todo-text">{item.text}</span>
        </li>
      ))}
    </ul>
    <div className="todo-divider" />
    <div className="todo-title-row todo-title-done">DONE</div>
    <ul className="todo-list todo-list--done">
      {doneItems.map((item) => (
        <li key={item.id} className="todo-item is-done">
          <button
            className="todo-check"
            type="button"
            aria-label="Restore"
            onClick={(event) => {
              event.stopPropagation();
              onRestore(item.id);
            }}
            disabled={!isActive}
          >
            <span className="todo-check-circle" />
          </button>
          <span className="todo-text">{item.text}</span>
        </li>
      ))}
    </ul>
  </div>
);

const MiniMemoCard = ({
  date,
  todoMemos,
  doneMemos,
  isActive,
  onActivate,
  onMarkDone,
  onRestore,
}: {
  date: string;
  todoMemos: MemoListItem[];
  doneMemos: MemoListItem[];
  isActive: boolean;
  onActivate: () => void;
  onMarkDone: (id: string) => void;
  onRestore: (id: string) => void;
}) => (
  <div
    className={`mini-card ${isActive ? 'is-front' : 'is-back'}`}
    role="button"
    tabIndex={0}
    aria-pressed={isActive}
    onClick={onActivate}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    }}
  >
    <div className="todo-meta">
      <span className="todo-date">{date}</span>
      <span className="todo-project">⚡️闪念</span>
    </div>
    <div className="todo-title-row">TO DO</div>
    <ul className="todo-list todo-list--todo">
      {todoMemos.length ? (
        todoMemos.map((memo) => (
          <li key={memo.id} className="todo-item">
            <button
              className="todo-check"
              type="button"
              aria-label="Mark done"
              onClick={(event) => {
                event.stopPropagation();
                onMarkDone(memo.id);
              }}
              disabled={!isActive}
            >
              <span className="todo-check-circle" />
            </button>
            <span className="todo-text">{memo.content}</span>
          </li>
        ))
      ) : (
        <li className="todo-item todo-item--empty">暂无闪念</li>
      )}
    </ul>
    <div className="todo-divider" />
    <div className="todo-title-row todo-title-done">DONE</div>
    <ul className="todo-list todo-list--done">
      {doneMemos.map((memo) => (
        <li key={memo.id} className="todo-item is-done">
          <button
            className="todo-check"
            type="button"
            aria-label="Restore"
            onClick={(event) => {
              event.stopPropagation();
              onRestore(memo.id);
            }}
            disabled={!isActive}
          >
            <span className="todo-check-circle" />
          </button>
          <span className="todo-text">{memo.content}</span>
        </li>
      ))}
    </ul>
  </div>
);

const MiniApp: React.FC = () => {
  const initialTodoState = useMemo<StoredTodoState | null>(() => null, []);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startBounds: Bounds;
    isDragging: boolean;
  } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const dragSuppressClickRef = useRef(false);
  const [taskTitle, setTaskTitle] = useState(initialTodoState?.taskTitle ?? '');
  const [taskDate, setTaskDate] = useState(initialTodoState?.taskDate ?? getBeijingDate());
  const [todoItems, setTodoItems] = useState<TodoEntry[]>(
    () => initialTodoState?.todoItems ?? [],
  );
  const [doneItems, setDoneItems] = useState<TodoEntry[]>(() => initialTodoState?.doneItems ?? []);
  const [memos, setMemos] = useState<MemoItem[]>(() => readMemos().slice(-3));
  const [memoDoneIds, setMemoDoneIds] = useState<Set<string>>(() => new Set());
  const [activePanel, setActivePanel] = useState<MiniPanel>('todo');
  const todoStorageRef = useRef(initialTodoState ? serializeTodoState(initialTodoState) : '');
  const memoItems = useMemo<MemoListItem[]>(
    () => memos.map((memo) => ({ ...memo, id: `${memo.created_at}-${memo.content}` })),
    [memos],
  );
  const memoTodoItems = useMemo(
    () => memoItems.filter((memo) => !memoDoneIds.has(memo.id)),
    [memoDoneIds, memoItems],
  );
  const memoDoneItems = useMemo(
    () => memoItems.filter((memo) => memoDoneIds.has(memo.id)),
    [memoDoneIds, memoItems],
  );

  useEffect(() => {
    document.body.classList.add('mini-mode');
    return () => document.body.classList.remove('mini-mode');
  }, []);

  useEffect(() => {
    if (!frameRef.current) return;

    const updateScale = () => {
      if (!frameRef.current) return;
      const { width, height } = frameRef.current.getBoundingClientRect();
      const scale = Math.min(width / MINI_DESIGN_WIDTH, height / MINI_DESIGN_HEIGHT);
      frameRef.current.style.setProperty('--mini-scale', String(scale));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frameRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!frameRef.current) return;
    const target = frameRef.current;
    const dragThreshold = 4;

    const onPointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const { startX, startY, startBounds } = dragStateRef.current;
      const dx = event.screenX - startX;
      const dy = event.screenY - startY;
      if (!dragStateRef.current.isDragging) {
        if (Math.hypot(dx, dy) < dragThreshold) return;
        dragStateRef.current.isDragging = true;
      }

      if (dragRafRef.current !== null) return;
      dragRafRef.current = window.requestAnimationFrame(() => {
        dragRafRef.current = null;
        const nextBounds = {
          x: Math.round(startBounds.x + dx),
          y: Math.round(startBounds.y + dy),
          width: startBounds.width,
          height: startBounds.height,
        };
        (window as any).electron?.invoke('mini-window:set-bounds', nextBounds).catch(() => {});
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      const targetEl = event.target as HTMLElement | null;
      targetEl?.releasePointerCapture?.(event.pointerId);
      if (dragStateRef.current?.isDragging) {
        dragSuppressClickRef.current = true;
      }
      dragStateRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    const onPointerDown = async (event: PointerEvent) => {
      const targetEl = event.target as HTMLElement | null;
      if (!targetEl) return;
      if (targetEl.closest('[data-mini-resize-handle]')) return;
      if (event.button !== 0) return;
      const bounds = await (window as any).electron?.invoke('mini-window:get-bounds');
      if (!bounds) return;
      dragStateRef.current = {
        startX: event.screenX,
        startY: event.screenY,
        startBounds: {
          x: Math.round(Number(bounds.x)),
          y: Math.round(Number(bounds.y)),
          width: Math.round(Number(bounds.width)),
          height: Math.round(Number(bounds.height)),
        },
        isDragging: false,
      };
      targetEl.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    target.addEventListener('pointerdown', onPointerDown);
    return () => {
      target.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  useEffect(() => {
    const handles = document.querySelectorAll('[data-mini-resize-handle]');
    const resizeState = { current: null as ResizeState | null };
    const rafId = { current: null as number | null };

    const onPointerMove = (event: PointerEvent) => {
      if (!resizeState.current) return;
      const { startX, startY } = resizeState.current;
      const dx = event.screenX - startX;
      const dy = event.screenY - startY;
      const handle = resizeState.current.handle;
      const isCorner = (handle.includes('left') || handle.includes('right'))
        && (handle.includes('top') || handle.includes('bottom'));
      if (isCorner && !resizeState.current.axis) {
        const delta = Math.abs(dx) + Math.abs(dy);
        if (delta >= 6) {
          resizeState.current.axis =
            Math.abs(dx) >= Math.abs(dy) * MINI_ASPECT_RATIO ? 'width' : 'height';
        }
      }
      const nextBounds = computeBounds(resizeState.current, dx, dy);

      if (rafId.current !== null) return;
      rafId.current = window.requestAnimationFrame(() => {
        rafId.current = null;
        if (
          Number.isFinite(nextBounds.x) &&
          Number.isFinite(nextBounds.y) &&
          Number.isFinite(nextBounds.width) &&
          Number.isFinite(nextBounds.height)
        ) {
          (window as any).electron?.invoke('mini-window:set-bounds', nextBounds).catch(() => {});
        }
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      target?.releasePointerCapture?.(event.pointerId);
      resizeState.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    const onPointerDown = async (event: Event) => {
      const pointerEvent = event as PointerEvent;
      const target = pointerEvent.currentTarget as HTMLElement | null;
      if (!target) return;
      const handle = target.dataset.miniResizeHandle || '';
      const bounds = await (window as any).electron?.invoke('mini-window:get-bounds');
      if (!bounds) return;

      resizeState.current = {
        handle,
        startX: pointerEvent.screenX,
        startY: pointerEvent.screenY,
        startBounds: {
          x: Math.round(Number(bounds.x)),
          y: Math.round(Number(bounds.y)),
          width: Math.round(Number(bounds.width)),
          height: Math.round(Number(bounds.height)),
        },
        axis: undefined,
      };

      target.setPointerCapture(pointerEvent.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      pointerEvent.preventDefault();
    };

    handles.forEach((handle) => {
      handle.addEventListener('pointerdown', onPointerDown);
    });

    return () => {
      handles.forEach((handle) => {
        handle.removeEventListener('pointerdown', onPointerDown);
      });
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === TODO_STORAGE_KEY) {
        const next = parseTodoState(event.newValue);
        if (!next) return;
        const serialized = serializeTodoState(next);
        if (serialized === todoStorageRef.current) return;
        todoStorageRef.current = serialized;
        setTaskTitle(next.taskTitle);
        setTaskDate(next.taskDate);
        setTodoItems(next.todoItems);
        setDoneItems(next.doneItems);
      }
      if (event.key === MEMO_STORAGE_KEY) {
        setMemos(parseMemos(event.newValue).slice(-3));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    const currentIds = new Set(memoItems.map((memo) => memo.id));
    setMemoDoneIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (currentIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [memoItems]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('flowmate:memos');
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; memos?: MemoItem[] };
      if (payload?.type !== 'memo_update') return;
      const next = parseMemos(JSON.stringify(payload.memos ?? []));
      setMemos(next.slice(-3));
    };
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
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

  const markDone = (id: string) => {
    setTodoItems((prev) => {
      const item = prev.find((todo) => todo.id === id);
      if (!item) return prev;
      setDoneItems((prevDone) => [...prevDone.filter((todo) => todo.id !== id), item]);
      return prev.filter((todo) => todo.id !== id);
    });
  };

  const restoreTodo = (id: string) => {
    setDoneItems((prev) => {
      const item = prev.find((todo) => todo.id === id);
      if (!item) return prev;
      setTodoItems((prevTodo) => [...prevTodo.filter((todo) => todo.id !== id), item]);
      return prev.filter((todo) => todo.id !== id);
    });
  };

  const markMemoDone = (id: string) => {
    setMemoDoneIds((prev) => new Set([...prev, id]));
  };

  const restoreMemo = (id: string) => {
    setMemoDoneIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div
      className="mini-root"
      ref={frameRef}
      onClickCapture={(event) => {
        if (dragSuppressClickRef.current) {
          event.stopPropagation();
          event.preventDefault();
          dragSuppressClickRef.current = false;
        }
      }}
    >
      <div className="mini-frame">
        <div className="mini-frame-backdrop" aria-hidden="true" />
        <div className="glass-border mini-glass-border" aria-hidden="true">
          <span className="border-edge border-top" />
          <span className="border-edge border-right" />
          <span className="border-edge border-bottom" />
          <span className="border-edge border-left" />
          <span className="border-corner border-corner-top-left" />
        </div>
        <div className="mini-scale">
          <div className="mini-stack">
            <MiniTodoCard
              date={taskDate}
              title={taskTitle}
              todoItems={todoItems}
              doneItems={doneItems}
              isActive={activePanel === 'todo'}
              onActivate={() => setActivePanel('todo')}
              onMarkDone={markDone}
              onRestore={restoreTodo}
            />
            <MiniMemoCard
              date={taskDate}
              todoMemos={memoTodoItems}
              doneMemos={memoDoneItems}
              isActive={activePanel === 'memo'}
              onActivate={() => setActivePanel('memo')}
              onMarkDone={markMemoDone}
              onRestore={restoreMemo}
            />
          </div>
        </div>
        <div className="mini-resize-overlay" aria-hidden="true">
          <div className="mini-resize-handle handle-top" data-mini-resize-handle="top" />
          <div className="mini-resize-handle handle-right" data-mini-resize-handle="right" />
          <div className="mini-resize-handle handle-bottom" data-mini-resize-handle="bottom" />
          <div className="mini-resize-handle handle-left" data-mini-resize-handle="left" />
          <div className="mini-resize-handle handle-top-left" data-mini-resize-handle="top-left" />
          <div className="mini-resize-handle handle-top-right" data-mini-resize-handle="top-right" />
          <div className="mini-resize-handle handle-bottom-left" data-mini-resize-handle="bottom-left" />
          <div className="mini-resize-handle handle-bottom-right" data-mini-resize-handle="bottom-right" />
        </div>
      </div>
    </div>
  );
};

export default MiniApp;
