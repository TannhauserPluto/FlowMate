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

export type MemoItem = {
  content: string;
  created_at: string;
};

export const TODO_STORAGE_KEY = 'flowmate.todoState';
export const MEMO_STORAGE_KEY = 'flowmate.memos';

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

export const serializeTodoState = (state: StoredTodoState) => JSON.stringify(state);

export const parseTodoState = (raw: string | null): StoredTodoState | null => {
  const parsed = safeJsonParse(raw, null as StoredTodoState | null);
  if (!parsed || !isValidTodoState(parsed)) return null;
  return parsed;
};

export const readTodoState = (): StoredTodoState | null =>
  parseTodoState(typeof window === 'undefined' ? null : window.localStorage.getItem(TODO_STORAGE_KEY));

export const writeTodoState = (state: StoredTodoState) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TODO_STORAGE_KEY, serializeTodoState(state));
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
