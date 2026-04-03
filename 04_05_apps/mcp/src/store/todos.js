import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STORE_DIR = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = resolve(STORE_DIR, "../..");
const APP_ROOT = resolve(MCP_ROOT, "..");

export const WORKSPACE_ROOT = join(APP_ROOT, "workspace");
export const TODOS_FILE_PATH = join(WORKSPACE_ROOT, "todos.md");

const TODO_LINE_PATTERN = /^- \[( |x)\] ([^|]+)\| (.+)$/;

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const createDefaultTodos = () => ([
  { id: "t1", text: "Review the MCP Apps phase-one scaffold", done: false },
  { id: "t2", text: "Draft the welcome sequence outline", done: false },
  { id: "t3", text: "Archive old checkout experiments", done: true },
]);

const serializeTodosMarkdown = (items) => [
  "# Todos",
  "",
  ...items.map((item) => `- [${item.done ? "x" : " "}] ${item.id} | ${item.text}`),
  "",
].join("\n");

const getNextTodoId = (items) => {
  const maxId = items.reduce((highest, item) => {
    const match = /^t(\d+)$/.exec(item.id);
    if (!match) {
      return highest;
    }

    return Math.max(highest, Number.parseInt(match[1], 10));
  }, 0);

  return `t${maxId + 1}`;
};

const normalizeTodoItem = (item, items, index) => {
  const text = normalizeText(item?.text);
  if (!text) {
    return null;
  }

  const requestedId = normalizeText(item?.id);
  const fallbackId = requestedId || getNextTodoId(items.slice(0, index));

  return {
    id: fallbackId,
    text,
    done: item?.done === true,
  };
};

const parseTodosMarkdown = (markdown) => (
  markdown
    .split(/\r?\n/)
    .map((line) => TODO_LINE_PATTERN.exec(line))
    .filter(Boolean)
    .map((match) => ({
      id: normalizeText(match[2]),
      text: normalizeText(match[3]),
      done: match[1] === "x",
    }))
);

const withTimestamp = async (items) => {
  const fileStats = await stat(TODOS_FILE_PATH);
  return {
    items,
    updatedAt: fileStats.mtime.toISOString(),
  };
};

export const ensureTodoWorkspace = async () => {
  await mkdir(WORKSPACE_ROOT, { recursive: true });

  try {
    await access(TODOS_FILE_PATH, constants.F_OK);
  } catch {
    await writeFile(TODOS_FILE_PATH, serializeTodosMarkdown(createDefaultTodos()), "utf-8");
  }
};

export const readTodosState = async () => {
  await ensureTodoWorkspace();
  const markdown = await readFile(TODOS_FILE_PATH, "utf-8");
  const items = parseTodosMarkdown(markdown);
  return withTimestamp(items);
};

export const replaceTodos = async (items) => {
  await ensureTodoWorkspace();

  const normalized = items
    .map((item, index) => normalizeTodoItem(item, items, index))
    .filter(Boolean)
    .map((item, index, array) => ({
      ...item,
      id: item.id || getNextTodoId(array.slice(0, index)),
    }));

  await writeFile(TODOS_FILE_PATH, serializeTodosMarkdown(normalized), "utf-8");
  return readTodosState();
};

const resolveTodo = (items, target) => {
  const needle = normalizeText(target).toLowerCase();
  if (!needle) {
    throw new Error("Todo target must be a non-empty string.");
  }

  const exactId = items.find((item) => item.id.toLowerCase() === needle);
  if (exactId) {
    return exactId;
  }

  const exactText = items.find((item) => item.text.toLowerCase() === needle);
  if (exactText) {
    return exactText;
  }

  const partialMatches = items.filter((item) => item.text.toLowerCase().includes(needle));
  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  if (partialMatches.length > 1) {
    throw new Error(`Todo target is ambiguous: "${target}".`);
  }

  throw new Error(`Todo not found: "${target}".`);
};

export const addTodo = async (text) => {
  const state = await readTodosState();
  const normalized = normalizeText(text);

  if (!normalized) {
    throw new Error("Todo text must be a non-empty string.");
  }

  const item = {
    id: getNextTodoId(state.items),
    text: normalized,
    done: false,
  };

  const nextState = await replaceTodos([...state.items, item]);
  return { item, state: nextState };
};

const updateTodoDoneState = async (target, done) => {
  const state = await readTodosState();
  const match = resolveTodo(state.items, target);

  const nextItems = state.items.map((item) => (
    item.id === match.id
      ? { ...item, done }
      : item
  ));

  const nextState = await replaceTodos(nextItems);
  return { item: nextState.items.find((item) => item.id === match.id), state: nextState };
};

export const completeTodo = async (target) => updateTodoDoneState(target, true);
export const reopenTodo = async (target) => updateTodoDoneState(target, false);

export const removeTodo = async (target) => {
  const state = await readTodosState();
  const match = resolveTodo(state.items, target);
  const nextState = await replaceTodos(state.items.filter((item) => item.id !== match.id));
  return { item: match, state: nextState };
};

export const summarizeTodos = (state) => {
  const pending = state.items.filter((item) => !item.done).length;
  const done = state.items.length - pending;
  return `${state.items.length} total, ${pending} open, ${done} done`;
};
