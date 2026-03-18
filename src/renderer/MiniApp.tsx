import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MEMO_STORAGE_KEY,
  TODO_PAGES_STORAGE_KEY,
  parseMemos,
  parseTodoPagesState,
  readMemos,
  readTodoPagesState,
  readTodoState,
  serializeTodoPagesState,
  writeTodoPagesState,
  type MemoItem,
  type StoredTodoBoard,
  type StoredTodoPagesState,
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

type MiniTodoCardState = 'front' | 'back' | 'peek-prev' | 'peek-next' | 'hidden';

type MiniInputEvent = React.MouseEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>;

const getBeijingDate = () =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date());

const MINI_DESIGN_WIDTH = 266;
const MINI_DESIGN_HEIGHT = 286;
const MINI_ASPECT_RATIO = MINI_DESIGN_WIDTH / MINI_DESIGN_HEIGHT;
const MINI_MIN_WIDTH = 220;
const MINI_MAX_WIDTH = 520;
const MINI_MIN_HEIGHT = Math.round(MINI_MIN_WIDTH / MINI_ASPECT_RATIO);
const MINI_MAX_HEIGHT = Math.round(MINI_MAX_WIDTH / MINI_ASPECT_RATIO);
const EMPTY_TODO_SLOT_HINT = '待补充';

const stopMiniInputEvent = (event: MiniInputEvent) => {
  event.stopPropagation();
};

const buildLegacyTodoPagesState = (): StoredTodoPagesState | null => {
  const legacyState = readTodoState();
  if (!legacyState) return null;
  const boardId = `mini-legacy-${legacyState.taskDate || Date.now()}`;
  return {
    currentBoardId: boardId,
    boards: [
      {
        id: boardId,
        title: legacyState.taskTitle,
        date: legacyState.taskDate,
        todoItems: legacyState.todoItems,
        doneItems: legacyState.doneItems,
      },
    ],
  };
};

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
  boardId,
  date,
  title,
  todoItems,
  doneItems,
  pageIndex,
  pageCount,
  cardState,
  onActivate,
  onMarkDone,
  onRestore,
  onUpdateTodo,
  onUpdateDone,
  onPrevPage,
  onNextPage,
  onSelectPage,
}: {
  boardId: string;
  date: string;
  title: string;
  todoItems: TodoEntry[];
  doneItems: TodoEntry[];
  pageIndex: number;
  pageCount: number;
  cardState: MiniTodoCardState;
  onActivate: () => void;
  onMarkDone: (id: string) => void;
  onRestore: (id: string) => void;
  onUpdateTodo: (id: string, text: string) => void;
  onUpdateDone: (id: string, text: string) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onSelectPage: (index: number) => void;
}) => {
  const isFront = cardState === 'front';
  const canActivate = cardState !== 'hidden';
  const cardStateClass =
    cardState === 'front'
      ? 'is-front'
      : cardState === 'back'
        ? 'is-back'
        : cardState === 'peek-prev'
          ? 'is-peek-prev'
          : cardState === 'peek-next'
            ? 'is-peek-next'
            : 'is-hidden';
  return (
  <div
    className={`mini-card ${cardStateClass}`}
    role="button"
    tabIndex={canActivate ? 0 : -1}
    aria-pressed={isFront}
    onClick={canActivate ? onActivate : undefined}
    onKeyDown={(event) => {
      if (!canActivate) return;
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
            disabled={!isFront || !item.text.trim()}
          >
            <span className="todo-check-circle" />
          </button>
          <input
            className={`todo-text-input ${item.text.trim() ? '' : 'is-empty'}`}
            type="text"
            value={item.text}
            placeholder={EMPTY_TODO_SLOT_HINT}
            disabled={!isFront}
            onClick={stopMiniInputEvent}
            onKeyDown={stopMiniInputEvent}
            onChange={(event) => onUpdateTodo(item.id, event.target.value)}
          />
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
            disabled={!isFront}
          >
            <span className="todo-check-circle" />
          </button>
          <input
            className={`todo-text-input ${item.text.trim() ? '' : 'is-empty'}`}
            type="text"
            value={item.text}
            placeholder={EMPTY_TODO_SLOT_HINT}
            disabled={!isFront}
            onClick={stopMiniInputEvent}
            onKeyDown={stopMiniInputEvent}
            onChange={(event) => onUpdateDone(item.id, event.target.value)}
          />
        </li>
      ))}
    </ul>
    {pageCount > 1 && cardState !== 'hidden' && (
      <div className="mini-todo-pager" onClick={stopMiniInputEvent} onKeyDown={stopMiniInputEvent}>
        <button
          className="mini-page-arrow"
          type="button"
          aria-label="Previous todo page"
          disabled={!isFront || pageIndex === 0}
          onClick={(event) => {
            event.stopPropagation();
            onPrevPage();
          }}
        >
          ‹
        </button>
        <div className="mini-page-dots" aria-label="Todo pages">
          {Array.from({ length: pageCount }, (_unused, index) => {
            const isCurrent = index === pageIndex;
            return (
              <button
                key={`${boardId}-page-${index}`}
                className={`mini-page-dot ${isCurrent ? 'is-active' : ''}`}
                type="button"
                aria-label={`Go to todo page ${index + 1}`}
                aria-pressed={isCurrent}
                disabled={!isFront}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectPage(index);
                }}
              />
            );
          })}
        </div>
        <button
          className="mini-page-arrow"
          type="button"
          aria-label="Next todo page"
          disabled={!isFront || pageIndex >= pageCount - 1}
          onClick={(event) => {
            event.stopPropagation();
            onNextPage();
          }}
        >
          ›
        </button>
      </div>
    )}
  </div>
  );
};

const MiniMemoCard = ({
  date,
  todoMemos,
  doneMemos,
  isActive,
  onActivate,
  onMarkDone,
  onRestore,
  onUpdateTodoMemo,
  onUpdateDoneMemo,
}: {
  date: string;
  todoMemos: MemoListItem[];
  doneMemos: MemoListItem[];
  isActive: boolean;
  onActivate: () => void;
  onMarkDone: (id: string) => void;
  onRestore: (id: string) => void;
  onUpdateTodoMemo: (id: string, content: string) => void;
  onUpdateDoneMemo: (id: string, content: string) => void;
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
      <span className="todo-project">✨闪念</span>
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
            <input
              className={`todo-text-input ${memo.content.trim() ? '' : 'is-empty'}`}
              type="text"
              value={memo.content}
              placeholder={EMPTY_TODO_SLOT_HINT}
              disabled={!isActive}
              onClick={stopMiniInputEvent}
              onKeyDown={stopMiniInputEvent}
              onChange={(event) => onUpdateTodoMemo(memo.id, event.target.value)}
            />
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
          <input
            className={`todo-text-input ${memo.content.trim() ? '' : 'is-empty'}`}
            type="text"
            value={memo.content}
            placeholder={EMPTY_TODO_SLOT_HINT}
            disabled={!isActive}
            onClick={stopMiniInputEvent}
            onKeyDown={stopMiniInputEvent}
            onChange={(event) => onUpdateDoneMemo(memo.id, event.target.value)}
          />
        </li>
      ))}
    </ul>
  </div>
);

const MiniApp: React.FC = () => {
  const initialTodoPagesState = useMemo<StoredTodoPagesState | null>(
    () => readTodoPagesState() ?? buildLegacyTodoPagesState(),
    [],
  );
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    startBounds: Bounds;
    isDragging: boolean;
  } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const dragSuppressClickRef = useRef(false);
  const [todoPages, setTodoPages] = useState<StoredTodoBoard[]>(() => initialTodoPagesState?.boards ?? []);
  const [currentBoardId, setCurrentBoardId] = useState(initialTodoPagesState?.currentBoardId ?? '');
  const [selectedTodoBoardId, setSelectedTodoBoardId] = useState(
    initialTodoPagesState?.currentBoardId
      || initialTodoPagesState?.boards[initialTodoPagesState.boards.length - 1]?.id
      || '',
  );
  const [memos, setMemos] = useState<MemoItem[]>(() => readMemos().slice(-3));
  const [memoDoneIds, setMemoDoneIds] = useState<Set<string>>(() => new Set());
  const [activePanel, setActivePanel] = useState<MiniPanel>('todo');
  const todoPagesStorageRef = useRef(
    initialTodoPagesState ? serializeTodoPagesState(initialTodoPagesState) : '',
  );
  const memoStorageRef = useRef(JSON.stringify(readMemos().slice(-3)));
  const lastMemoKeyRef = useRef<string | null>(null);
  const memoUpdateSeenRef = useRef(false);
  const lastTodoPagesKeyRef = useRef<string | null>(null);
  const todoPagesUpdateSeenRef = useRef(false);
  const memoItems = useMemo<MemoListItem[]>(
    () => memos.map((memo) => ({ ...memo, id: memo.created_at })),
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
  const selectedTodoBoard = useMemo(() => {
    if (!todoPages.length) return null;
    return todoPages.find((board) => board.id === selectedTodoBoardId)
      ?? todoPages.find((board) => board.id === currentBoardId)
      ?? todoPages[todoPages.length - 1]
      ?? null;
  }, [currentBoardId, selectedTodoBoardId, todoPages]);
  const selectedTodoPageIndex = useMemo(() => {
    if (!selectedTodoBoard) return -1;
    return todoPages.findIndex((board) => board.id === selectedTodoBoard.id);
  }, [selectedTodoBoard, todoPages]);

  useEffect(() => {
    if (!todoPages.length) {
      if (selectedTodoBoardId) setSelectedTodoBoardId('');
      if (currentBoardId) setCurrentBoardId('');
      return;
    }
    if (!todoPages.some((board) => board.id === currentBoardId)) {
      setCurrentBoardId(todoPages[todoPages.length - 1]?.id ?? '');
    }
    if (!todoPages.some((board) => board.id === selectedTodoBoardId)) {
      setSelectedTodoBoardId(currentBoardId || todoPages[todoPages.length - 1]?.id || '');
    }
  }, [currentBoardId, selectedTodoBoardId, todoPages]);

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
      if (event.key === TODO_PAGES_STORAGE_KEY) {
        const nextPages = parseTodoPagesState(event.newValue);
        if (!nextPages) return;
        const serialized = serializeTodoPagesState(nextPages);
        if (serialized === todoPagesStorageRef.current) return;
        todoPagesStorageRef.current = serialized;
        setTodoPages(nextPages.boards);
        setCurrentBoardId(nextPages.currentBoardId);
        setSelectedTodoBoardId(
          nextPages.currentBoardId || nextPages.boards[nextPages.boards.length - 1]?.id || '',
        );
      }
      if (event.key === MEMO_STORAGE_KEY) {
        const nextMemos = parseMemos(event.newValue).slice(-3);
        memoStorageRef.current = JSON.stringify(nextMemos);
        setMemos(nextMemos);
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
      memoStorageRef.current = JSON.stringify(next.slice(-3));
      setMemos(next.slice(-3));
    };
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, []);

  useEffect(() => {
    const lastMemo = memos[memos.length - 1];
    const nextKey = lastMemo ? `${lastMemo.created_at}-${lastMemo.content}` : null;
    if (!memoUpdateSeenRef.current) {
      memoUpdateSeenRef.current = true;
      lastMemoKeyRef.current = nextKey;
      return;
    }
    if (nextKey && nextKey !== lastMemoKeyRef.current) {
      setActivePanel('memo');
    }
    lastMemoKeyRef.current = nextKey;
  }, [memos]);

  useEffect(() => {
    const serialized = JSON.stringify(memos);
    if (serialized === memoStorageRef.current) return;
    memoStorageRef.current = serialized;
    try {
      window.localStorage.setItem(MEMO_STORAGE_KEY, serialized);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('flowmate:memos');
        channel.postMessage({ type: 'memo_update', memos });
        channel.close();
      }
    } catch {
      // ignore memo persistence failures
    }
  }, [memos]);

  useEffect(() => {
    const nextState: StoredTodoPagesState = {
      currentBoardId,
      boards: todoPages,
    };
    const serialized = serializeTodoPagesState(nextState);
    if (serialized === todoPagesStorageRef.current) return;
    todoPagesStorageRef.current = serialized;
    writeTodoPagesState(nextState);
  }, [currentBoardId, todoPages]);

  useEffect(() => {
    const nextKey = serializeTodoPagesState({
      currentBoardId,
      boards: todoPages,
    });
    if (!todoPagesUpdateSeenRef.current) {
      todoPagesUpdateSeenRef.current = true;
      lastTodoPagesKeyRef.current = nextKey;
      return;
    }
    if (nextKey !== lastTodoPagesKeyRef.current) {
      setActivePanel('todo');
    }
    lastTodoPagesKeyRef.current = nextKey;
  }, [currentBoardId, todoPages]);

  const updateTodoBoardById = (
    boardId: string,
    updater: (board: StoredTodoBoard) => StoredTodoBoard,
  ) => {
    if (!boardId) return;
    setTodoPages((prev) => prev.map((board) => (board.id === boardId ? updater(board) : board)));
  };

  const markDone = (id: string) => {
    const boardId = selectedTodoBoard?.id;
    if (!boardId) return;
    updateTodoBoardById(boardId, (board) => {
      const item = board.todoItems.find((todo) => todo.id === id);
      if (!item || !item.text.trim()) return board;
      return {
        ...board,
        todoItems: board.todoItems.filter((todo) => todo.id !== id),
        doneItems: [...board.doneItems.filter((todo) => todo.id !== id), item],
      };
    });
  };

  const restoreTodo = (id: string) => {
    const boardId = selectedTodoBoard?.id;
    if (!boardId) return;
    updateTodoBoardById(boardId, (board) => {
      const item = board.doneItems.find((todo) => todo.id === id);
      if (!item) return board;
      return {
        ...board,
        doneItems: board.doneItems.filter((todo) => todo.id !== id),
        todoItems: [...board.todoItems.filter((todo) => todo.id !== id), item],
      };
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

  const updateTodoItemText = (id: string, text: string) => {
    const boardId = selectedTodoBoard?.id;
    if (!boardId) return;
    updateTodoBoardById(boardId, (board) => ({
      ...board,
      todoItems: board.todoItems.map((todo) => (todo.id === id ? { ...todo, text } : todo)),
    }));
  };

  const updateDoneItemText = (id: string, text: string) => {
    const boardId = selectedTodoBoard?.id;
    if (!boardId) return;
    updateTodoBoardById(boardId, (board) => ({
      ...board,
      doneItems: board.doneItems.map((todo) => (todo.id === id ? { ...todo, text } : todo)),
    }));
  };

  const updateMemoContent = (id: string, content: string) => {
    setMemos((prev) => prev.map((memo) => (
      memo.created_at === id ? { ...memo, content } : memo
    )));
  };

  const selectTodoPageByIndex = (index: number) => {
    const nextBoard = todoPages[index];
    if (!nextBoard) return;
    setSelectedTodoBoardId(nextBoard.id);
    setActivePanel('todo');
  };

  const goToPrevTodoPage = () => {
    if (selectedTodoPageIndex <= 0) return;
    selectTodoPageByIndex(selectedTodoPageIndex - 1);
  };

  const goToNextTodoPage = () => {
    if (selectedTodoPageIndex < 0 || selectedTodoPageIndex >= todoPages.length - 1) return;
    selectTodoPageByIndex(selectedTodoPageIndex + 1);
  };

  const renderedTodoPages = todoPages.length
    ? todoPages
    : [{
      id: 'mini-empty-board',
      title: '任务清单',
      date: getBeijingDate(),
      todoItems: [] as TodoEntry[],
      doneItems: [] as TodoEntry[],
    }];

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
            {renderedTodoPages.map((board, index) => {
              const isSelectedTodoPage = board.id === (selectedTodoBoard?.id ?? 'mini-empty-board');
              const isNeighborPrev = activePanel === 'todo' && index === selectedTodoPageIndex - 1;
              const isNeighborNext = activePanel === 'todo' && index === selectedTodoPageIndex + 1;
              const cardState: MiniTodoCardState = isSelectedTodoPage
                ? (activePanel === 'todo' ? 'front' : 'back')
                : isNeighborPrev
                  ? 'peek-prev'
                  : isNeighborNext
                    ? 'peek-next'
                    : 'hidden';
              return (
                <MiniTodoCard
                  key={board.id}
                  boardId={board.id}
                  date={board.date}
                  title={board.title}
                  todoItems={board.todoItems}
                  doneItems={board.doneItems}
                  pageIndex={index}
                  pageCount={renderedTodoPages.length}
                  cardState={cardState}
                  onActivate={() => {
                    setSelectedTodoBoardId(board.id);
                    setActivePanel('todo');
                  }}
                  onMarkDone={markDone}
                  onRestore={restoreTodo}
                  onUpdateTodo={updateTodoItemText}
                  onUpdateDone={updateDoneItemText}
                  onPrevPage={goToPrevTodoPage}
                  onNextPage={goToNextTodoPage}
                  onSelectPage={selectTodoPageByIndex}
                />
              );
            })}
            <MiniMemoCard
              date={selectedTodoBoard?.date ?? getBeijingDate()}
              todoMemos={memoTodoItems}
              doneMemos={memoDoneItems}
              isActive={activePanel === 'memo'}
              onActivate={() => setActivePanel('memo')}
              onMarkDone={markMemoDone}
              onRestore={restoreMemo}
              onUpdateTodoMemo={updateMemoContent}
              onUpdateDoneMemo={updateMemoContent}
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
