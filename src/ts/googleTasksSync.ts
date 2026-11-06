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
  title: string;
  notes: string;
  // YYYY-MM-DD (Google Tasks keeps only the date), or null
  due: string | null;
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
      lines.push(`${options.origin}/?open=todolist&task=${todo.id}`);
    }
    desired.push({
      key,
      title: limit(firstLine(toText(todo.body)) || '(untitled)', MAX_TITLE),
      notes: makeNotes(key, lines),
      due: todo.deadline ? localDate(todo.deadline) : null,
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
          title: limit(firstLine(toText(step.body)) || '(untitled step)', MAX_TITLE),
          notes: makeNotes(key, lines),
          due: step.deadline ? localDate(step.deadline) : null,
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

export async function syncTasks(api: TasksApi, desired: DesiredTask[]): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, completed: 0, unchanged: 0 };
  const remote = await api.listTasks();
  const remoteByKey = new Map<string, RemoteTask>();
  for (const task of remote) {
    const key = keyOf(task);
    // if a key somehow exists twice, keep the first and ignore the rest
    if (key && !remoteByKey.has(key)) {
      remoteByKey.set(key, task);
    }
  }
  const desiredKeys = new Set(desired.map(d => d.key));

  for (const want of desired) {
    const have = remoteByKey.get(want.key);
    if (!have) {
      await api.createTask({ title: want.title, notes: want.notes, due: toGoogleDue(want.due) });
      result.created++;
      continue;
    }
    if (have.status === 'completed') {
      result.unchanged++;
      continue;
    }
    const patch: TaskPatch = {};
    if ((have.title ?? '') !== want.title) {
      patch.title = want.title;
    }
    if ((have.notes ?? '') !== want.notes) {
      patch.notes = want.notes;
    }
    if (dueOf(have) !== want.due) {
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
  return result;
}
