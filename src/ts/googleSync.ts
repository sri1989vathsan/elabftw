/**
 * Optional, per-user sync of the to-do list with the user's own Google Tasks:
 * eLabFTW -> Google always, and (when the user ticks the box) Google ->
 * eLabFTW for ticks, edits and new tasks. Everything runs in the user's browser, so the eLabFTW server
 * needs no internet access and stores no Google credentials.
 *
 * Off by default: nothing is loaded from Google and nothing is sent until a
 * user pastes an OAuth client ID and clicks "Connect". For that the server's
 * Content-Security-Policy must also allow Google (see
 * tests/manual/GOOGLE-TASKS-SYNC.md); without that the connect step fails with
 * a clear message and the rest of eLabFTW is unaffected.
 *
 * The matching and diffing logic lives in googleTasksSync.ts.
 */
import { ApiC } from './api';
import { Model } from './interfaces';
import { stripMentionHtml } from './mentions';
import {
  buildDesired,
  syncTasks,
  type LocalApi,
  type RemoteTask,
  type Snapshot,
  type TaskPatch,
  type TasksApi,
  type Todo,
  type UnfinishedResponse,
} from './googleTasksSync';

const SCOPE = 'https://www.googleapis.com/auth/tasks';
const GSI_URL = 'https://accounts.google.com/gsi/client';
const API = 'https://tasks.googleapis.com/tasks/v1';
const LIST_TITLE = 'eLabFTW';
const PAGE = 100;
const AUTO_SYNC_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 3000;
const FOCUS_SYNC_MS = 60 * 1000;

const KEY_CLIENT = 'googleSyncClientId';
const KEY_DETAILS = 'googleSyncDetails';
const KEY_ENABLED = 'googleSyncEnabled';
// bring ticks, edits and new tasks from Google back into eLabFTW (off by default)
const KEY_TWO_WAY = 'googleSyncTwoWay';
// last state written to both sides, so a change can be told apart from an old value
const KEY_SNAPSHOT = 'googleSyncSnapshot';
const SILENT_TIMEOUT_MS = 15_000;
// short-lived access token, per tab: gone when the tab closes
const KEY_TOKEN = 'googleSyncToken';

type Token = { value: string; expires: number };

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string };

type TokenClient = { requestAccessToken: (overrides?: { prompt?: string }) => void };

type GoogleGlobal = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string; message?: string }) => void;
      }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
};

class AuthError extends Error {}

function read(key: string, storage: Storage = localStorage): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null, storage: Storage = localStorage): void {
  try {
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, value);
    }
  } catch {
    // storage unavailable (private mode): the feature just won't remember
  }
}

function currentToken(): Token | null {
  const raw = read(KEY_TOKEN, sessionStorage);
  if (!raw) {
    return null;
  }
  try {
    const token = JSON.parse(raw) as Token;
    return token.expires > Date.now() + 30_000 ? token : null;
  } catch {
    return null;
  }
}

// A client ID set by the administrator (Sysconfig > Google Tasks sync) is delivered on the row
// itself and wins over the one a user typed into this browser.
function adminClientId(): string {
  return document.getElementById('googleSyncRow')?.dataset.clientId?.trim() ?? '';
}

function clientIdValue(): string | null {
  return adminClientId() || read(KEY_CLIENT);
}

function loadGoogleScript(): Promise<GoogleGlobal> {
  const existing = (window as unknown as { google?: GoogleGlobal }).google;
  if (existing?.accounts?.oauth2) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_URL;
    script.async = true;
    script.onload = (): void => {
      const google = (window as unknown as { google?: GoogleGlobal }).google;
      if (google?.accounts?.oauth2) {
        resolve(google);
      } else {
        reject(new Error('Google sign-in did not start.'));
      }
    };
    script.onerror = (): void => reject(new Error(
      'Google sign-in could not be loaded. Either this computer has no internet access, '
      + 'or the server\'s Content-Security-Policy does not allow Google yet (ask your eLabFTW administrator).',
    ));
    document.head.appendChild(script);
  });
}

// silent: renew without showing Google's window. It works only when the user has
// already agreed and Google can answer without asking, so it may just fail.
async function requestToken(clientId: string, silent = false): Promise<Token> {
  const google = await loadGoogleScript();
  return new Promise((resolve, reject) => {
    if (silent) {
      window.setTimeout(() => reject(new Error('Google did not answer.')), SILENT_TIMEOUT_MS);
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response: TokenResponse) => {
        if (!response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google did not give access.'));
          return;
        }
        const token = { value: response.access_token, expires: Date.now() + (response.expires_in ?? 3600) * 1000 };
        write(KEY_TOKEN, JSON.stringify(token), sessionStorage);
        resolve(token);
      },
      error_callback: error => reject(new Error(
        error.type === 'popup_closed' ? 'The Google window was closed.' : (error.message || 'Google sign-in failed.'),
      )),
    });
    client.requestAccessToken(silent ? { prompt: '' } : undefined);
  });
}

async function google(method: string, path: string, token: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    write(KEY_TOKEN, null, sessionStorage);
    throw new AuthError('Google access expired.');
  }
  if (!response.ok) {
    throw new Error(`Google Tasks said ${response.status}.`);
  }
  return response.status === 204 ? null : response.json();
}

async function findOrCreateList(token: string): Promise<string> {
  let pageToken = '';
  do {
    const data = await google('GET', `/users/@me/tasklists?maxResults=100${pageToken}`, token) as {
      items?: { id: string; title: string }[];
      nextPageToken?: string;
    };
    const found = (data.items ?? []).find(list => list.title === LIST_TITLE);
    if (found) {
      return found.id;
    }
    pageToken = data.nextPageToken ? `&pageToken=${encodeURIComponent(data.nextPageToken)}` : '';
  } while (pageToken);
  const created = await google('POST', '/users/@me/tasklists', token, { title: LIST_TITLE }) as { id: string };
  return created.id;
}

function tasksApi(token: string, listId: string): TasksApi {
  const base = `/lists/${encodeURIComponent(listId)}/tasks`;
  return {
    async listTasks(): Promise<RemoteTask[]> {
      const all: RemoteTask[] = [];
      let pageToken = '';
      do {
        const data = await google(
          'GET', `${base}?showCompleted=true&showHidden=true&maxResults=100${pageToken}`, token,
        ) as { items?: RemoteTask[]; nextPageToken?: string };
        all.push(...(data.items ?? []));
        pageToken = data.nextPageToken ? `&pageToken=${encodeURIComponent(data.nextPageToken)}` : '';
      } while (pageToken);
      return all;
    },
    async createTask(task): Promise<void> {
      await google('POST', base, token, {
        title: task.title,
        notes: task.notes,
        ...(task.due ? { due: task.due } : {}),
      });
    },
    async patchTask(id: string, patch: TaskPatch): Promise<void> {
      await google('PATCH', `${base}/${encodeURIComponent(id)}`, token, patch);
    },
  };
}

function readSnapshot(): Snapshot {
  try {
    const parsed = JSON.parse(read(KEY_SNAPSHOT) ?? '{}') as Snapshot;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// text from Google is plain text: escape it before it can become to-do notes
function plainToHtml(text: string): string {
  const escape = (line: string): string => line
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/\n{2,}/).map(part => `<p>${escape(part).replace(/\n/g, '<br>')}</p>`).join('');
}

const localApi: LocalApi = {
  createTodo: ({ title, deadline, notes }) => ApiC.post2location(Model.Todolist, {
    content: title,
    notes: notes ? plainToHtml(notes) : null,
    deadline,
  }),
  async updateTodo(id, patch): Promise<void> {
    await ApiC.patch(`${Model.Todolist}/${id}`, {
      ...(patch.title === undefined ? {} : { content: patch.title }),
      ...(patch.deadline === undefined ? {} : { deadline: patch.deadline }),
    });
  },
  async completeTodo(id): Promise<void> {
    await ApiC.patch(`${Model.Todolist}/${id}`, { completed: true });
  },
};

// Read everything that is open. If any request fails this throws, so a
// half-read list can never lead to tasks being completed in Google by mistake.
async function fetchOpen(): Promise<{ todos: Todo[]; unfinished: UnfinishedResponse }> {
  const todos: Todo[] = [];
  const unfinished: UnfinishedResponse = { experiments: [], items: [] };
  for (let offset = 0; ; offset += PAGE) {
    const [t, s] = await Promise.all([
      ApiC.getJson(`${Model.Todolist}?scope=assigned&limit=${PAGE}&offset=${offset}`) as Promise<Todo[]>,
      ApiC.getJson(`unfinished_steps?scope=user&limit=${PAGE}&offset=${offset}`) as Promise<UnfinishedResponse>,
    ]);
    todos.push(...t);
    unfinished.experiments.push(...s.experiments);
    unfinished.items.push(...s.items);
    if (t.length < PAGE && s.experiments.length < PAGE && s.items.length < PAGE) {
      return { todos, unfinished };
    }
  }
}

// ---- panel -----------------------------------------------------------------

let status = '';
let statusIsError = false;
let running = false;
let rerun = false;
let timer: number | undefined;
// null: not touched yet, so open only while no client ID is entered
let panelOpen: boolean | null = null;

function setStatus(text: string, isError = false): void {
  status = text;
  statusIsError = isError;
  if (isError) {
    panelOpen = true;
  }
  render();
}

async function runSync(): Promise<void> {
  const clientId = clientIdValue();
  if (!clientId || read(KEY_ENABLED) !== '1') {
    return;
  }
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  setStatus('Syncing…');
  try {
    let token = currentToken();
    if (!token) {
      try {
        token = await requestToken(clientId, true);
      } catch {
        throw new AuthError('Google access expired.');
      }
    }
    const twoWay = read(KEY_TWO_WAY) === '1';
    const includeDetails = read(KEY_DETAILS) === '1';
    const { todos, unfinished } = await fetchOpen();
    const desired = buildDesired(todos, unfinished, {
      includeDetails,
      origin: window.location.origin,
      toText: stripMentionHtml,
    });
    const listId = await findOrCreateList(token.value);
    const api = tasksApi(token.value, listId);
    let line = '';
    if (twoWay) {
      const result = await syncTasks(api, desired, { local: localApi, snapshot: readSnapshot(), includeDetails });
      write(KEY_SNAPSHOT, JSON.stringify(result.snapshot));
      const pulled = result.imported + result.pulled + result.completedLocal;
      line = [
        result.created + result.updated - result.pulled ? `${result.created} new, ${result.updated - result.pulled} updated` : '',
        pulled ? `${result.imported} added, ${result.pulled} edited and ${result.completedLocal} done from Google` : '',
        result.completed - result.completedLocal ? `${result.completed - result.completedLocal} done` : '',
      ].filter(Boolean).join('; ');
      if (pulled) {
        // the sidebar and notification counters should show what just arrived
        window.dispatchEvent(new CustomEvent('todolist-changed'));
      }
    } else {
      const result = await syncTasks(api, desired);
      if (result.created + result.updated + result.completed) {
        line = `${result.created} new, ${result.updated} updated, ${result.completed} done`;
      }
    }
    setStatus(`Synced at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      + (line ? ` (${line})` : ''));
  } catch (error) {
    setStatus(
      error instanceof AuthError ? 'Google access expired. Connect again.' : (error as Error).message,
      true,
    );
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      scheduleSync();
    }
  }
}

function scheduleSync(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void runSync(), DEBOUNCE_MS);
}

async function connect(): Promise<void> {
  const clientId = clientIdValue();
  if (!clientId) {
    setStatus('Enter a Google client ID first.', true);
    return;
  }
  setStatus('Waiting for Google…');
  try {
    await requestToken(clientId);
    write(KEY_ENABLED, '1');
    await runSync();
  } catch (error) {
    setStatus((error as Error).message, true);
  }
  render();
}

async function disconnect(): Promise<void> {
  const token = currentToken();
  write(KEY_ENABLED, null);
  write(KEY_TOKEN, null, sessionStorage);
  window.clearTimeout(timer);
  try {
    if (token) {
      (await loadGoogleScript()).accounts.oauth2.revoke(token.value);
    }
  } catch {
    // Google not reachable: the token expires by itself within the hour
  }
  setStatus('');
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `btn btn-sm ${primary ? 'btn-primary' : 'btn-secondary'} mr-2`;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function render(): void {
  const host = document.getElementById('googleSyncRow');
  if (!host) {
    return;
  }
  // don't redraw under the user's cursor while they type the client ID
  if (host.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement
    && document.activeElement.type === 'text') {
    return;
  }
  host.replaceChildren();

  const clientId = clientIdValue() ?? '';
  const enabled = read(KEY_ENABLED) === '1';
  const connected = enabled && currentToken() !== null;

  const details = document.createElement('details');
  details.className = 'mb-3';
  details.open = panelOpen ?? !clientId;
  details.addEventListener('toggle', () => {
    panelOpen = details.open;
  });
  const summary = document.createElement('summary');
  summary.className = 'text-muted';
  summary.textContent = connected ? 'Google Tasks: connected' : 'Google Tasks sync (optional)';
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'pt-2';

  const intro = document.createElement('p');
  intro.className = 'small text-muted mb-2';
  intro.textContent = 'Copies your open to-dos and steps to a list called "eLabFTW" in your own '
    + 'Google Tasks. Google shows tasks with a date in Google Calendar too. '
    + 'Only titles and dates are sent unless you tick the first box below.';
  body.appendChild(intro);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control form-control-sm mb-2';
  input.placeholder = 'Google OAuth client ID';
  input.value = clientId;
  input.setAttribute('aria-label', 'Google OAuth client ID');
  input.addEventListener('change', () => {
    write(KEY_CLIENT, input.value.trim() || null);
    render();
  });
  if (adminClientId() === '') {
    body.appendChild(input);
  }

  const label = document.createElement('label');
  label.className = 'small d-block mb-2';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'mr-1';
  box.checked = read(KEY_DETAILS) === '1';
  box.addEventListener('change', () => {
    write(KEY_DETAILS, box.checked ? '1' : null);
    scheduleSync();
  });
  label.append(box, 'Also send notes, experiment names and links back to eLabFTW');
  body.appendChild(label);

  const twoWayLabel = document.createElement('label');
  twoWayLabel.className = 'small d-block mb-2';
  const twoWayBox = document.createElement('input');
  twoWayBox.type = 'checkbox';
  twoWayBox.className = 'mr-1';
  twoWayBox.checked = read(KEY_TWO_WAY) === '1';
  twoWayBox.addEventListener('change', () => {
    write(KEY_TWO_WAY, twoWayBox.checked ? '1' : null);
    scheduleSync();
  });
  twoWayLabel.append(
    twoWayBox,
    'Also bring ticks, edits and new tasks from the Google list back into eLabFTW (text only, nothing is ever deleted here)',
  );
  body.appendChild(twoWayLabel);

  const actions = document.createElement('div');
  actions.className = 'mb-2';
  if (connected) {
    actions.appendChild(button('Sync now', () => void runSync(), true));
    actions.appendChild(button('Disconnect', () => void disconnect()));
  } else {
    actions.appendChild(button(enabled ? 'Connect again' : 'Connect', () => void connect(), true));
  }
  body.appendChild(actions);

  if (status) {
    const line = document.createElement('div');
    line.className = `small ${statusIsError ? 'text-danger' : 'text-muted'}`;
    line.setAttribute('role', statusIsError ? 'alert' : 'status');
    line.textContent = status;
    body.appendChild(line);
  }

  details.appendChild(body);
  host.appendChild(details);
}

export function initGoogleSync(): void {
  if (!document.getElementById('googleSyncRow')) {
    return;
  }
  render();
  window.addEventListener('todolist-changed', scheduleSync);
  window.setInterval(() => void runSync(), AUTO_SYNC_MS);
  // coming back to the tab: pick up what changed in Google meanwhile
  let lastFocusSync = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && read(KEY_ENABLED) === '1' && Date.now() - lastFocusSync > FOCUS_SYNC_MS) {
      lastFocusSync = Date.now();
      scheduleSync();
    }
  });
  // connected before: sync at page load, renewing the Google access quietly if it is missing
  if (read(KEY_ENABLED) === '1') {
    scheduleSync();
  }
}
