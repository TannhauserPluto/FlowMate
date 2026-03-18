export type TodoEntry = {
  id: string;
  text: string;
};

export type StoredTodoState = {
  taskTitle: string;
  taskDate: string;
  todoItems: TodoEntry[];
  doneItems: TodoEntry[];
};

export type StoredTodoBoard = {
  id: string;
  title: string;
  date: string;
  todoItems: TodoEntry[];
  doneItems: TodoEntry[];
};

export type StoredTodoPagesState = {
  currentBoardId: string;
  boards: StoredTodoBoard[];
};

export type MemoItem = {
  content: string;
  created_at: string;
};

export const TODO_STORAGE_KEY = 'flowmate.todoState';
export const TODO_PAGES_STORAGE_KEY = 'flowmate.todoPagesState';
export const MEMO_STORAGE_KEY = 'flowmate.memos';
export const TODO_SLOT_COUNT = 3;

const safeJsonParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const isValidTodoEntry = (entry: TodoEntry) =>
  entry
  && typeof entry === 'object'
  && typeof entry.id === 'string'
  && typeof entry.text === 'string';

const isValidTodoState = (state: StoredTodoState) =>
  state
  && typeof state === 'object'
  && typeof state.taskTitle === 'string'
  && typeof state.taskDate === 'string'
  && Array.isArray(state.todoItems)
  && Array.isArray(state.doneItems)
  && state.todoItems.every(isValidTodoEntry)
  && state.doneItems.every(isValidTodoEntry);

const isValidTodoBoard = (board: StoredTodoBoard) =>
  board
  && typeof board === 'object'
  && typeof board.id === 'string'
  && typeof board.title === 'string'
  && typeof board.date === 'string'
  && Array.isArray(board.todoItems)
  && Array.isArray(board.doneItems)
  && board.todoItems.every(isValidTodoEntry)
  && board.doneItems.every(isValidTodoEntry);

const isValidTodoPagesState = (state: StoredTodoPagesState) =>
  state
  && typeof state === 'object'
  && typeof state.currentBoardId === 'string'
  && Array.isArray(state.boards)
  && state.boards.every(isValidTodoBoard);

const sanitizeTodoItems = (items: TodoEntry[] | null | undefined): TodoEntry[] =>
  Array.isArray(items)
    ? items.filter(isValidTodoEntry).map((item, index) => ({
      id: item.id || `todo-item-${index}`,
      text: typeof item.text === 'string' ? item.text : '',
    }))
    : [];

const createEmptyTodoEntry = (index: number): TodoEntry => ({
  id: `todo-slot-${index}`,
  text: '',
});

export const normalizeTodoItems = (items: TodoEntry[] | null | undefined): TodoEntry[] => {
  const validItems = Array.isArray(items) ? items.filter(isValidTodoEntry).slice(0, TODO_SLOT_COUNT) : [];
  const nextItems = [...validItems];
  while (nextItems.length < TODO_SLOT_COUNT) {
    nextItems.push(createEmptyTodoEntry(nextItems.length));
  }
  return nextItems.map((item, index) => ({
    id: item.id || `todo-slot-${index}`,
    text: typeof item.text === 'string' ? item.text : '',
  }));
};

export const normalizeTodoState = (state: StoredTodoState): StoredTodoState => ({
  ...state,
  todoItems: sanitizeTodoItems(state.todoItems),
  doneItems: sanitizeTodoItems(state.doneItems),
});

export const normalizeTodoBoard = (board: StoredTodoBoard): StoredTodoBoard => ({
  id: board.id,
  title: board.title,
  date: board.date,
  todoItems: sanitizeTodoItems(board.todoItems),
  doneItems: sanitizeTodoItems(board.doneItems),
});

export const normalizeTodoPagesState = (state: StoredTodoPagesState): StoredTodoPagesState => {
  const boards = Array.isArray(state.boards)
    ? state.boards.filter(isValidTodoBoard).map(normalizeTodoBoard)
    : [];
  const fallbackCurrentBoardId = boards[boards.length - 1]?.id ?? '';
  return {
    currentBoardId: boards.some((board) => board.id === state.currentBoardId)
      ? state.currentBoardId
      : fallbackCurrentBoardId,
    boards,
  };
};

export const serializeTodoState = (state: StoredTodoState) => JSON.stringify(normalizeTodoState(state));

export const serializeTodoPagesState = (state: StoredTodoPagesState) =>
  JSON.stringify(normalizeTodoPagesState(state));

export const parseTodoState = (raw: string | null): StoredTodoState | null => {
  const parsed = safeJsonParse(raw, null as StoredTodoState | null);
  if (!parsed || !isValidTodoState(parsed)) return null;
  return normalizeTodoState(parsed);
};

export const parseTodoPagesState = (raw: string | null): StoredTodoPagesState | null => {
  const parsed = safeJsonParse(raw, null as StoredTodoPagesState | null);
  if (!parsed || !isValidTodoPagesState(parsed)) return null;
  return normalizeTodoPagesState(parsed);
};

export const readTodoState = (): StoredTodoState | null =>
  parseTodoState(typeof window === 'undefined' ? null : window.localStorage.getItem(TODO_STORAGE_KEY));

export const readTodoPagesState = (): StoredTodoPagesState | null =>
  parseTodoPagesState(typeof window === 'undefined' ? null : window.localStorage.getItem(TODO_PAGES_STORAGE_KEY));

export const writeTodoState = (state: StoredTodoState) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TODO_STORAGE_KEY, serializeTodoState(state));
};

export const writeTodoPagesState = (state: StoredTodoPagesState) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TODO_PAGES_STORAGE_KEY, serializeTodoPagesState(state));
};

export const readMemos = (): MemoItem[] => {
  if (typeof window === 'undefined') return [];
  const parsed = safeJsonParse(window.localStorage.getItem(MEMO_STORAGE_KEY), [] as MemoItem[]);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => item && typeof item.content === 'string' && typeof item.created_at === 'string');
};

export const parseMemos = (raw: string | null): MemoItem[] => {
  const parsed = safeJsonParse(raw, [] as MemoItem[]);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) => item && typeof item.content === 'string' && typeof item.created_at === 'string');
};
