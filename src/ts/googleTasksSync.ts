/**
 * One-way sync of a user's open to-dos and unfinished steps into a Google
 * Tasks list. This file is pure logic: no DOM, no network, no eLabFTW imports,
 * so it can be tested with a mock Google Tasks API (see
 * tests/googleTasksSync.test.cjs).
 *
 * Matching eLabFTW items with Google tasks is done with a marker written at
 * the end of each Google task's notes: "[elabftw:todo:12]" or
 * "[elabftw:step:34]". That needs no table on the server.
 *
 * Rules (all deliberately non-destructive):
 * - an open item with no Google task is created;
 * - an open item whose Google task differs (title, date, notes) is updated;
 * - a Google task that was already ticked in Google is left alone, even if
 *   the item is still open in eLabFTW (nothing is reopened);
 * - a Google task whose item is no longer open (done, archived or deleted
 *   in eLabFTW) is marked completed, never deleted.
 *
 * Two-way mode (when a LocalApi is passed to syncTasks) adds, still without
 * ever deleting anything in eLabFTW:
 * - a to-do ticked in Google is completed in eLabFTW;
 * - a title or date edited in Google (and not changed in eLabFTW since the
 *   last sync) is written back to the eLabFTW to-do; if both sides changed,
 *   eLabFTW wins;
 * - a task added in Google with no marker becomes a new eLabFTW to-do (plain
 *   text only, at most MAX_IMPORT per sync) and gets its marker written back;
 * - a task deleted in Google is not recreated: the to-do stays in eLabFTW.
 * "Changed since the last sync" is judged against a small per-browser
 * snapshot of what was last written to both sides.
 */

export type Todo = {
  id: number;
  body: string;
  notes?: string | null;
  description?: string | null;
  deadline: string | null;
  completed_at?: string | null;
  archived_at?: string | null;
};

export type UnfinishedStep = {
  id: number;
  body: string;
  deadline: string | null;
};

export type UnfinishedEntity = {
  id: number;
  title: string;
  steps: UnfinishedStep[];
};

export type UnfinishedResponse = {
  experiments: UnfinishedEntity[];
  items: UnfinishedEntity[];
};

export type BuildOptions = {
  // also send notes, descriptions, experiment titles and links back to eLabFTW
  includeDetails: boolean;
  // e.g. https://elab.example.org, used to build links when includeDetails
  origin: string;
  // turns stored HTML (mentions) into plain text; injectable for tests
  toText?: (html: string) => string;
};

export type DesiredTask = {
  key: string;
  kind: 'todo' | 'step';
  id: number;
  title: string;
  notes: string;
  // YYYY-MM-DD (Google Tasks keeps only the date), or null
  due: string | null;
  // the full eLabFTW deadline (ISO), kept so a date edited in Google can keep its time of day
  deadline: string | null;
};

export type RemoteTask = {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status: 'needsAction' | 'completed';
};

export type TaskPatch = {
  title?: string;
  notes?: string;
  due?: string | null;
  status?: 'needsAction' | 'completed';
};

export interface TasksApi {
  listTasks(): Promise<RemoteTask[]>;
  createTask(task: { title: string; notes: string; due: string | null }): Promise<void>;
  patchTask(id: string, patch: TaskPatch): Promise<void>;
}

export type SyncResult = {
  created: number;
  updated: number;
  completed: number;
  unchanged: number;
};

// what eLabFTW writes the two-way mode needs (plain titles, never HTML)
export interface LocalApi {
  createTodo(todo: { title: string; deadline: string | null; notes: string | null }): Promise<number>;
  updateTodo(id: number, patch: { title?: string; deadline?: string | null }): Promise<void>;
  completeTodo(id: number): Promise<void>;
}

// last state written to both sides, per key; `gone` = deleted in Google, never recreate
export type SnapshotEntry = { title: string; due: string | null; gone?: boolean };
export type Snapshot = Record<string, SnapshotEntry>;

export type TwoWayResult = SyncResult & {
  imported: number;
  pulled: number;
  completedLocal: number;
  snapshot: Snapshot;
};

export type TwoWayOptions = {
  local: LocalApi;
  snapshot: Snapshot;
  // time of day (HH:MM) given to a task that arrives with only a date
  defaultTime?: string;
  includeDetails?: boolean;
};

export const MAX_IMPORT = 50;

const MARKER = /\[elabftw:((?:todo|step):\d+)\]/;
const MAX_TITLE = 1000;
const MAX_NOTES = 8000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// local calendar date of an ISO timestamp, as YYYY-MM-DD
export function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function limit(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function firstLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function makeNotes(key: string, lines: string[]): string {
  const body = lines.filter(Boolean).join('\n');
  return limit(`${body}${body ? '\n\n' : ''}[elabftw:${key}]`, MAX_NOTES);
}

export function buildDesired(
  todos: Todo[],
  unfinished: UnfinishedResponse,
  options: BuildOptions,
): DesiredTask[] {
  const toText = options.toText ?? ((s: string): string => s);
  const desired: DesiredTask[] = [];

  for (const todo of todos) {
    if (todo.completed_at || todo.archived_at) {
      continue;
    }
    const key = `todo:${todo.id}`;
    const lines: string[] = [];
    if (todo.deadline) {
      lines.push(`Deadline: ${localDate(todo.deadline)} ${localTime(todo.deadline)}`);
    }
    if (options.includeDetails) {
      for (const extra of [todo.description, todo.notes]) {
        if (extra && extra.trim()) {
          lines.push(toText(extra).trim());
        }
      }
      lines.push(`${options.origin}/dashboard.php?open=todolist&task=${todo.id}`);
    }
    desired.push({
      key,
      kind: 'todo',
      id: todo.id,
      title: limit(firstLine(toText(todo.body)) || '(untitled)', MAX_TITLE),
      notes: makeNotes(key, lines),
      due: todo.deadline ? localDate(todo.deadline) : null,
      deadline: todo.deadline,
    });
  }

  const groups: [UnfinishedEntity[], string][] = [
    [unfinished.experiments ?? [], 'experiments.php'],
    [unfinished.items ?? [], 'database.php'],
  ];
  for (const [entities, page] of groups) {
    for (const entity of entities) {
      for (const step of entity.steps) {
        const key = `step:${step.id}`;
        const lines: string[] = [];
        if (step.deadline) {
          lines.push(`Deadline: ${localDate(step.deadline)} ${localTime(step.deadline)}`);
        }
        if (options.includeDetails) {
          lines.push(`Step in: ${toText(entity.title)}`);
          lines.push(`${options.origin}/${page}?mode=view&id=${entity.id}`);
        }
        desired.push({
          key,
          kind: 'step',
          id: step.id,
          title: limit(firstLine(toText(step.body)) || '(untitled step)', MAX_TITLE),
          notes: makeNotes(key, lines),
          due: step.deadline ? localDate(step.deadline) : null,
          deadline: step.deadline,
        });
      }
    }
  }
  return desired;
}

export function keyOf(remote: RemoteTask): string | null {
  const match = MARKER.exec(remote.notes ?? '');
  return match ? match[1] : null;
}

function dueOf(remote: RemoteTask): string | null {
  return remote.due ? remote.due.slice(0, 10) : null;
}

// Google's API wants an RFC 3339 timestamp, but only the date is kept
function toGoogleDue(date: string | null): string | null {
  return date ? `${date}T00:00:00.000Z` : null;
}

// "2026-11-12" + "09:00" in the user's time zone, as an ISO timestamp
export function combineDateAndTime(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0).toISOString();
}

function withMarker(notes: string | undefined, key: string): string {
  const body = (notes ?? '').trim();
  return limit(`${body}${body ? '\n\n' : ''}[elabftw:${key}]`, MAX_NOTES);
}

function indexRemote(remote: RemoteTask[]): Map<string, RemoteTask> {
  const byKey = new Map<string, RemoteTask>();
  for (const task of remote) {
    const key = keyOf(task);
    // if a key somehow exists twice, keep the first and ignore the rest
    if (key && !byKey.has(key)) {
      byKey.set(key, task);
    }
  }
  return byKey;
}

export async function syncTasks(api: TasksApi, desired: DesiredTask[]): Promise<SyncResult>;
export async function syncTasks(api: TasksApi, desired: DesiredTask[], twoWay: TwoWayOptions): Promise<TwoWayResult>;
export async function syncTasks(
  api: TasksApi,
  desired: DesiredTask[],
  twoWay?: TwoWayOptions,
): Promise<SyncResult | TwoWayResult> {
  const result: SyncResult = { created: 0, updated: 0, completed: 0, unchanged: 0 };
  const remote = await api.listTasks();
  const remoteByKey = indexRemote(remote);
  const desiredKeys = new Set(desired.map(d => d.key));
  const extra = { imported: 0, pulled: 0, completedLocal: 0 };
  const snapshot: Snapshot = {};
  const old = twoWay?.snapshot ?? {};

  for (const want of desired) {
    const have = remoteByKey.get(want.key);
    const snap = old[want.key];
    if (!have) {
      if (twoWay && snap) {
        // it was synced before and is gone from Google: the user deleted it there
        snapshot[want.key] = { ...snap, gone: true };
        result.unchanged++;
        continue;
      }
      await api.createTask({ title: want.title, notes: want.notes, due: toGoogleDue(want.due) });
      result.created++;
      snapshot[want.key] = { title: want.title, due: want.due };
      continue;
    }
    if (have.status === 'completed') {
      // only a tick made after we last saw it open counts: a to-do reopened in
      // eLabFTW (no snapshot entry any more) must not be completed again
      if (twoWay && snap && want.kind === 'todo') {
        await twoWay.local.completeTodo(want.id);
        extra.completedLocal++;
        result.completed++;
      } else {
        result.unchanged++;
      }
      continue;
    }
    const haveTitle = have.title ?? '';
    const haveDue = dueOf(have);
    if (twoWay && snap && want.kind === 'todo') {
      const googleChanged = haveTitle !== snap.title || haveDue !== snap.due;
      const localChanged = want.title !== snap.title || want.due !== snap.due;
      if (googleChanged && !localChanged && haveTitle !== '') {
        const patch: { title?: string; deadline?: string | null } = {};
        if (haveTitle !== want.title) {
          patch.title = haveTitle;
        }
        if (haveDue !== want.due) {
          const time = want.deadline ? localTime(want.deadline) : (twoWay.defaultTime ?? '09:00');
          patch.deadline = haveDue ? combineDateAndTime(haveDue, time) : null;
        }
        await twoWay.local.updateTodo(want.id, patch);
        extra.pulled++;
        result.updated++;
        snapshot[want.key] = { title: haveTitle, due: haveDue };
        continue;
      }
    }
    snapshot[want.key] = { title: want.title, due: want.due };
    const patch: TaskPatch = {};
    if (haveTitle !== want.title) {
      patch.title = want.title;
    }
    if ((have.notes ?? '') !== want.notes) {
      patch.notes = want.notes;
    }
    if (haveDue !== want.due) {
      patch.due = toGoogleDue(want.due);
    }
    if (Object.keys(patch).length === 0) {
      result.unchanged++;
      continue;
    }
    await api.patchTask(have.id, patch);
    result.updated++;
  }

  for (const [key, have] of remoteByKey) {
    if (!desiredKeys.has(key) && have.status === 'needsAction') {
      await api.patchTask(have.id, { status: 'completed' });
      result.completed++;
    }
  }

  if (!twoWay) {
    return result;
  }

  // tasks added in Google: no marker yet, so they are new to eLabFTW
  let budget = MAX_IMPORT;
  for (const task of remote) {
    if (budget === 0) {
      break;
    }
    const title = firstLine(task.title ?? '');
    if (keyOf(task) !== null || task.status !== 'needsAction' || title === '') {
      continue;
    }
    budget--;
    const due = dueOf(task);
    const notes = twoWay.includeDetails && task.notes?.trim() ? task.notes.trim() : null;
    const id = await twoWay.local.createTodo({
      title: limit(title, MAX_TITLE),
      deadline: due ? combineDateAndTime(due, twoWay.defaultTime ?? '09:00') : null,
      notes,
    });
    await api.patchTask(task.id, { notes: withMarker(task.notes, `todo:${id}`) });
    snapshot[`todo:${id}`] = { title, due };
    extra.imported++;
  }
  return { ...result, ...extra, snapshot };
}
