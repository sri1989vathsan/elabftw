/**
 * Optional, per-user sync of the to-do list with the user's own Google Tasks and/or Google Calendar (the user chooses):
 * eLabFTW -> Google always, and (when the user ticks the box) Google ->
 * eLabFTW for ticks, edits and new tasks. In Google Calendar a task is an event that lasts as long as the task says,
 * and the user picks which calendars are shown on the calendar page of eLabFTW. Everything runs in the user's browser, so the eLabFTW server
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
import { core } from './core';
import { Model } from './interfaces';
import { stripMentionHtml } from './mentions';
import { readTaskCalendars } from './googleTaskCalendars';
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
import {
  shownEvents,
  syncCalendar,
  type CalendarApi,
  type CalendarInfo,
  type CalLocalApi,
  type CalSnapshot,
  type CalTodo,
  type RemoteEvent,
  type ShownEvent,
} from './googleCalendarSync';

const SCOPE_TASKS = 'https://www.googleapis.com/auth/tasks';
// events of the calendars (read, write) and the list of the calendars of the user, nothing else of the Calendar
const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const SCOPE_CALENDARS = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const GSI_URL = 'https://accounts.google.com/gsi/client';
const API = 'https://tasks.googleapis.com/tasks/v1';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const DAY_MS = 86_400_000;
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
// short-lived access token (about an hour), kept per eLabFTW account in this browser: other tabs and a restart of the browser can use it
const KEY_TOKEN = 'googleSyncToken';
// What the Calendar sync remembers is kept per eLabFTW account (two people can use one browser):
// where the to-dos go ('tasks', 'calendar' or 'both'), the calendar they go to, the calendars shown on the calendar page,
// whether new events of that calendar become to-dos, and what was written to both sides last time.
const KEY_TARGET = 'googleSyncTarget';
const KEY_CAL_TARGET = 'googleSyncCalendar';
const KEY_CAL_SHOWN = 'googleSyncCalendarsShown';
const KEY_CAL_IMPORT = 'googleSyncImportEvents';
const KEY_CAL_SNAPSHOT = 'googleSyncCalendarSnapshot';

type Token = { value: string; expires: number; scope?: string };

type TokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };

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
  const raw = read(acct(KEY_TOKEN));
  if (!raw) {
    return null;
  }
  try {
    const token = JSON.parse(raw) as Token;
    // a token that was given for other settings (before Calendar was chosen) does not do: it is asked for again
    const enough = scopes().split(' ').every(scope => (token.scope ?? SCOPE_TASKS).includes(scope));
    return token.expires > Date.now() + 30_000 && enough ? token : null;
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
      scope: scopes(),
      callback: (response: TokenResponse) => {
        if (!response.access_token) {
          reject(new Error(response.error_description || response.error || 'Google did not give access.'));
          return;
        }
        const token = { value: response.access_token, expires: Date.now() + (response.expires_in ?? 3600) * 1000, scope: response.scope ?? scopes() };
        write(acct(KEY_TOKEN), JSON.stringify(token));
        resolve(token);
      },
      error_callback: error => reject(new Error(
        error.type === 'popup_closed' ? 'The Google window was closed.' : (error.message || 'Google sign-in failed.'),
      )),
    });
    client.requestAccessToken(silent ? { prompt: '' } : undefined);
  });
}

async function google(method: string, path: string, token: string, body?: unknown, base: string = API): Promise<unknown> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    write(acct(KEY_TOKEN), null);
    throw new AuthError('Google access expired.');
  }
  if (!response.ok) {
    // what Google says is wrong, when it says
    let reason = '';
    try {
      const detail = await response.json() as { error?: { message?: string; errors?: { reason?: string }[] } };
      reason = [detail.error?.message, detail.error?.errors?.[0]?.reason].filter(Boolean).join(' / ');
    } catch {
      // no readable body
    }
    throw new Error(`Google ${base === CALENDAR_API ? 'Calendar' : 'Tasks'} said ${response.status}${reason ? `: ${reason}` : ''}.`);
  }
  return response.status === 204 ? null : response.json();
}

// ---- settings of the Calendar sync (per account) ---------------------------------

function acct(key: string): string {
  return `${key}:${core.currentUserid ?? 0}`;
}

type Target = 'tasks' | 'calendar' | 'both';

function target(): Target {
  const value = read(acct(KEY_TARGET));
  return value === 'calendar' || value === 'both' ? value : 'tasks';
}

function shownIds(): string[] {
  const raw = read(acct(KEY_CAL_SHOWN));
  // nothing chosen yet and the to-dos go to a Google Calendar: that calendar (and the main one) is shown by itself, without a visit to the
  // Calendars menu; ticking or unticking a calendar there then keeps the list as it is
  if (raw === null) {
    return target() === 'tasks' ? [] : [...new Set(['primary', calendarTargetId()])];
  }
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// the permissions asked from Google follow the settings: Tasks only when the to-dos go there, Calendar only when it is used or shown
function scopes(): string {
  const list: string[] = [];
  if (target() !== 'calendar') {
    list.push(SCOPE_TASKS);
  }
  if (target() !== 'tasks' || read(acct(KEY_CAL_SHOWN)) !== null) {
    list.push(SCOPE_EVENTS, SCOPE_CALENDARS);
  }
  return list.join(' ');
}

const calendarTargetId = (): string => read(acct(KEY_CAL_TARGET)) || 'primary';

let calendars: CalendarInfo[] = [];

async function loadCalendars(token: string): Promise<void> {
  const data = await google('GET', '/users/me/calendarList?minAccessRole=reader&maxResults=250', token, undefined, CALENDAR_API) as {
    items?: { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; accessRole?: string; primary?: boolean }[];
  };
  calendars = (data.items ?? []).map(item => ({
    id: item.id,
    summary: item.summaryOverride || item.summary || item.id,
    color: item.backgroundColor || '#7c3aed',
    writable: item.accessRole === 'owner' || item.accessRole === 'writer',
    primary: item.primary === true,
  }));
}

async function listEvents(token: string, calendarId: string, from: string, to: string): Promise<RemoteEvent[]> {
  const all: RemoteEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const data = await google(
      'GET',
      `/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&maxResults=250`
        + `&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}${pageToken}`,
      token,
      undefined,
      CALENDAR_API,
    ) as { items?: RemoteEvent[]; nextPageToken?: string };
    all.push(...(data.items ?? []));
    if (!data.nextPageToken) {
      break;
    }
    pageToken = `&pageToken=${encodeURIComponent(data.nextPageToken)}`;
  }
  return all;
}

function calendarApi(token: string, calendarId: string): CalendarApi {
  const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
  return {
    listEvents: (from, to) => listEvents(token, calendarId, from, to),
    insertEvent: async body => await google('POST', base, token, body, CALENDAR_API) as RemoteEvent,
    async patchEvent(id, patch): Promise<void> {
      await google('PATCH', `${base}/${encodeURIComponent(id)}`, token, patch, CALENDAR_API);
    },
  };
}

const calendarLocalApi: CalLocalApi = {
  createTodo: ({ title, deadline, duration_minutes: minutes }) => ApiC.post2location(Model.Todolist, {
    content: title,
    deadline,
    duration_minutes: minutes,
  }),
  async updateTodo(id, patch): Promise<void> {
    await ApiC.patch(`${Model.Todolist}/${id}`, {
      ...(patch.title === undefined ? {} : { content: patch.title }),
      ...(patch.deadline === undefined ? {} : { deadline: patch.deadline }),
      ...(patch.duration_minutes === undefined ? {} : { duration_minutes: patch.duration_minutes }),
    });
  },
};

// what was written last time, by calendar (each calendar starts from nothing the first time); the older form held one calendar only
function readCalendarSnapshots(): Record<string, CalSnapshot> {
  try {
    const parsed = JSON.parse(read(acct(KEY_CAL_SNAPSHOT)) ?? '{}') as { calendar?: string; items?: CalSnapshot; calendars?: Record<string, CalSnapshot> };
    if (parsed.calendars && typeof parsed.calendars === 'object') {
      return parsed.calendars;
    }
    return parsed.calendar && parsed.items && typeof parsed.items === 'object' ? { [parsed.calendar]: parsed.items } : {};
  } catch {
    return {};
  }
}

async function deleteCalendarEvent(token: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await google('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, token, undefined, CALENDAR_API);
  } catch (error) {
    // gone already (404, 410): fine; anything else (sign-in) goes up
    if (error instanceof AuthError || !/said (404|410)\b/.test(error instanceof Error ? error.message : '')) {
      throw error;
    }
  }
}

// the events of the calendars that are shown, for the days the calendar page asks for (it asks with 'elabftw:calendar-range')
let wantedRange: { from: string; to: string } | null = null;
let shownTimer: number | undefined;

async function tokenOrNull(clientId: string): Promise<Token | null> {
  const token = currentToken();
  if (token) {
    return token;
  }
  try {
    return await requestToken(clientId, true);
  } catch {
    return null;
  }
}

async function publishShownEvents(): Promise<void> {
  const clientId = clientIdValue();
  const ids = shownIds();
  const publish = (events: ShownEvent[]): void => {
    window.dispatchEvent(new CustomEvent('elabftw:calendar-events', { detail: { events } }));
  };
  if (!clientId || read(KEY_ENABLED) !== '1' || ids.length === 0 || !wantedRange) {
    publish([]);
    return;
  }
  const token = await tokenOrNull(clientId);
  if (!token) {
    publish([]);
    return;
  }
  try {
    if (calendars.length === 0) {
      await loadCalendars(token.value);
    }
    const out: ShownEvent[] = [];
    for (const id of ids) {
      const info = calendars.find(calendar => calendar.id === id);
      if (info) {
        out.push(...shownEvents(info, await listEvents(token.value, id, wantedRange.from, wantedRange.to)));
      }
    }
    publish(out);
  } catch (error) {
    publish([]);
    if (error instanceof AuthError) {
      setStatus('Google access expired. Connect again.', true);
    }
  }
}

function scheduleShown(): void {
  window.clearTimeout(shownTimer);
  shownTimer = window.setTimeout(() => void publishShownEvents(), 400);
}

// The calendar page lists the calendars of the user with a box each (like the panel does): this tells it which there are and which are
// shown. 'off': Google is not connected, 'needs': connected but the Calendar is not allowed yet (one click), 'ready': the list.
async function publishCalendarList(): Promise<void> {
  const clientId = clientIdValue();
  const publish = (state: 'off' | 'needs' | 'ready'): void => {
    const ids = shownIds();
    window.dispatchEvent(new CustomEvent('elabftw:calendar-list', {
      detail: {
        state,
        // the to-dos go to a Google Calendar (the popups of a task then offer a calendar for it), and to which one by default
        syncs: target() !== 'tasks',
        target: calendarTargetId(),
        calendars: state === 'ready' ? calendars.map(calendar => ({
          id: calendar.id,
          summary: calendar.summary,
          color: calendar.color,
          writable: calendar.writable,
          primary: calendar.primary,
          shown: ids.includes(calendar.id) || (calendar.primary && ids.includes('primary')),
        })) : [],
      },
    }));
  };
  if (!clientId || read(KEY_ENABLED) !== '1') {
    publish('off');
    return;
  }
  if (!scopes().includes(SCOPE_CALENDARS)) {
    publish('needs');
    return;
  }
  const token = await tokenOrNull(clientId);
  if (!token) {
    publish('needs');
    return;
  }
  try {
    if (calendars.length === 0) {
      await loadCalendars(token.value);
    }
    publish('ready');
  } catch {
    publish('needs');
  }
}

// a box of the calendar page: the calendar is shown or not (the same choice as in the panel)
function toggleCalendar(id: string, on: boolean): void {
  const info = calendars.find(calendar => calendar.id === id);
  const next = new Set(shownIds().filter(value => value !== id && !(info?.primary && value === 'primary')));
  if (on) {
    next.add(id);
  }
  // an empty list is kept (not removed): the Calendar stays allowed, so ticking a calendar again needs no new permission
  write(acct(KEY_CAL_SHOWN), JSON.stringify([...next]));
  scheduleShown();
  render();
}

// "Show my Google calendars" on the calendar page: the primary calendar is shown, and Google is asked for the Calendar
function connectCalendars(): void {
  if (read(acct(KEY_CAL_SHOWN)) === null) {
    write(acct(KEY_CAL_SHOWN), JSON.stringify(['primary']));
  }
  calendars = [];
  void connect().then(() => publishCalendarList());
}

async function findOrCreateList(token: string): Promise<string> {
  let pageToken = '';
  do {
    const data = await google('GET', `/users/@me/lists?maxResults=100${pageToken}`, token) as {
      items?: { id: string; title: string }[];
      nextPageToken?: string;
    };
    const found = (data.items ?? []).find(list => list.title === LIST_TITLE);
    if (found) {
      return found.id;
    }
    pageToken = data.nextPageToken ? `&pageToken=${encodeURIComponent(data.nextPageToken)}` : '';
  } while (pageToken);
  const created = await google('POST', '/users/@me/lists', token, { title: LIST_TITLE }) as { id: string };
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

function setStatus(text: string, isError = false): void {
  status = text;
  statusIsError = isError;
  render();
}

// the to-dos with a date become events of a calendar: the one chosen for the task (in its popup), else the one of the settings
// (and what changed there comes back, when asked). A task moved to another calendar has its event taken from the old one.
async function syncToCalendar(token: string, todos: Todo[], twoWay: boolean, includeDetails: boolean): Promise<string> {
  if (calendars.length === 0) {
    await loadCalendars(token);
  }
  const normal = (id: string): string => (calendars.find(calendar => calendar.id === id)?.primary ? 'primary' : id);
  const writable = new Set(calendars.filter(calendar => calendar.writable).map(calendar => normal(calendar.id)));
  const defaultId = normal(calendarTargetId());
  const chosen = readTaskCalendars();
  // a calendar that is gone or cannot be written to any more: the task goes to the calendar of the settings
  const calendarOf = (todo: Todo): string => {
    const wanted = chosen[String(todo.id)];
    return wanted && writable.has(normal(wanted)) ? normal(wanted) : defaultId;
  };
  const groups = new Map<string, Todo[]>([[defaultId, []]]);
  const where = new Map<string, string>();
  for (const todo of todos) {
    if (!(todo as unknown as CalTodo).deadline) {
      continue;
    }
    const id = calendarOf(todo);
    where.set(String(todo.id), id);
    groups.set(id, [...(groups.get(id) ?? []), todo]);
  }
  const before = readCalendarSnapshots();
  for (const id of Object.keys(before)) {
    if (!groups.has(id)) {
      groups.set(id, []);
    }
  }
  const after: Record<string, CalSnapshot> = {};
  const total = { created: 0, updated: 0, pulled: 0, imported: 0, completed: 0, unmarked: 0, moved: 0 };
  let unmarkedReason: string | undefined;
  const failures: string[] = [];
  const range = { from: new Date(Date.now() - 30 * DAY_MS), to: new Date(Date.now() + 365 * DAY_MS) };
  for (const [calendarId, group] of groups) {
    let snapshot = { ...(before[calendarId] ?? {}) };
    try {
      // an open task that is now on another calendar: its event is taken from this one (the new calendar makes its own)
      for (const [key, item] of Object.entries(snapshot)) {
        const now = where.get(key);
        if (now !== undefined && now !== calendarId) {
          await deleteCalendarEvent(token, calendarId, item.event);
          delete snapshot[key];
          total.moved += 1;
        }
      }
      const result = await syncCalendar(calendarApi(token, calendarId), group as unknown as CalTodo[], {
        local: calendarLocalApi,
        snapshot,
        twoWay,
        // new events of the calendar of the settings become to-dos (the others only get the tasks that were put there)
        importEvents: twoWay && calendarId === defaultId && read(acct(KEY_CAL_IMPORT)) === '1',
        includeDetails,
        origin: window.location.origin,
        range,
      });
      snapshot = result.snapshot;
      total.created += result.created;
      total.updated += result.updated;
      total.pulled += result.pulled;
      total.imported += result.imported;
      total.completed += result.completed;
      total.unmarked += result.unmarked;
      unmarkedReason = result.unmarkedReason ?? unmarkedReason;
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      // this calendar failed (deleted, not allowed...): what is known of it stays, the other calendars go on
      const name = calendars.find(calendar => normal(calendar.id) === calendarId)?.summary ?? calendarId;
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (Object.keys(snapshot).length > 0) {
      after[calendarId] = snapshot;
    }
  }
  write(acct(KEY_CAL_SNAPSHOT), JSON.stringify({ calendars: after }));
  const pulled = total.pulled + total.imported;
  if (pulled) {
    window.dispatchEvent(new CustomEvent('todolist-changed'));
  }
  scheduleShown();
  if (failures.length > 0) {
    throw new Error(failures.join(' | '));
  }
  return [
    total.created + total.updated ? `${total.created} new, ${total.updated} updated` : '',
    total.moved ? `${total.moved} moved to another calendar` : '',
    pulled ? `${total.imported} added and ${total.pulled} changed from Google` : '',
    total.completed ? `${total.completed} done` : '',
    total.unmarked ? `${total.unmarked} added without a link to their event (${unmarkedReason ?? 'Google refused to mark it'})` : '',
  ].filter(Boolean).join('; ');
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
    let line = '';
    if (target() !== 'tasks') {
      const calendarLine = await syncToCalendar(token.value, todos, twoWay, includeDetails);
      line = calendarLine;
    }
    if (target() === 'calendar') {
      setStatus(`Synced at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        + (line ? ` (${line})` : ''));
      return;
    }
    const listId = await findOrCreateList(token.value);
    const api = tasksApi(token.value, listId);
    line = line ? `Calendar: ${line}; Tasks: ` : '';
    if (twoWay) {
      const result = await syncTasks(api, desired, { local: localApi, snapshot: readSnapshot(), includeDetails });
      write(KEY_SNAPSHOT, JSON.stringify(result.snapshot));
      const pulled = result.imported + result.pulled + result.completedLocal;
      line += [
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
        line += `${result.created} new, ${result.updated} updated, ${result.completed} done`;
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
  write(acct(KEY_TOKEN), null);
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

function choice(kind: 'radio' | 'checkbox', name: string, text: string, checked: boolean, onChange: (on: boolean) => void, swatch?: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'small d-block mb-1';
  const box = document.createElement('input');
  box.type = kind;
  box.name = name;
  box.className = 'mr-1';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  label.appendChild(box);
  if (swatch) {
    const dot = document.createElement('span');
    dot.style.cssText = `background:${swatch};border-radius:50%;display:inline-block;height:0.6rem;margin-right:0.35rem;width:0.6rem`;
    label.appendChild(dot);
  }
  label.append(text);
  return label;
}

let loadingCalendars = false;

// the calendars of the user are read once the Calendar is allowed, then the panel is drawn again
async function ensureCalendars(): Promise<void> {
  const token = currentToken();
  if (calendars.length > 0 || loadingCalendars || !token) {
    return;
  }
  loadingCalendars = true;
  try {
    await loadCalendars(token.value);
  } catch (error) {
    setStatus((error as Error).message, true);
  } finally {
    loadingCalendars = false;
  }
  render();
  void publishCalendarList();
}

// The settings are in the Calendars menu of the calendar page (the host #googleSettings, drawn when the menu is open). The to-do
// panel (#googleSyncRow) only says how things are and points there.
function render(): void {
  const row = document.getElementById('googleSyncRow');
  if (row) {
    renderLine(row);
  }
  const host = document.getElementById('googleSettings');
  if (host) {
    renderSettings(host);
  }
}

// the to-do panel says nothing about Google, except when the sync has a problem
function renderLine(host: HTMLElement): void {
  host.replaceChildren();
  if (!statusIsError || !status) {
    return;
  }
  const line = document.createElement('div');
  line.className = 'small mb-3 text-danger';
  line.setAttribute('role', 'alert');
  line.append(`Google sync: ${status} `);
  const link = document.createElement('a');
  link.href = '/calendar.php#settings';
  link.setAttribute('data-calendar-settings', '');
  link.textContent = 'Calendar settings';
  line.append(link, '.');
  host.appendChild(line);
}

function renderSettings(host: HTMLElement): void {
  // don't redraw under the user's cursor while they type the client ID
  if (host.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement
    && document.activeElement.type === 'text') {
    return;
  }
  host.replaceChildren();

  const clientId = clientIdValue() ?? '';
  const enabled = read(KEY_ENABLED) === '1';
  const connected = enabled && currentToken() !== null;
  const usesCalendar = target() !== 'tasks';
  const body = document.createElement('div');
  body.className = 'pt-1';

  if (adminClientId() === '') {
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
    body.appendChild(input);
  }

  // where the to-dos go: one choice
  const where = document.createElement('label');
  where.className = 'small d-block mb-2';
  where.append('Send my to-dos to ');
  const whereSelect = document.createElement('select');
  whereSelect.className = 'form-control form-control-sm';
  const options: [Target, string][] = [['calendar', 'Google Calendar (as events)'], ['tasks', 'Google Tasks']];
  if (target() === 'both') {
    options.push(['both', 'Google Calendar and Google Tasks']);
  }
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = target() === value;
    whereSelect.appendChild(option);
  }
  whereSelect.addEventListener('change', () => {
    const value = whereSelect.value as Target;
    write(acct(KEY_TARGET), value === 'tasks' ? null : value);
    calendars = [];
    render();
    void publishCalendarList();
    if (read(KEY_ENABLED) === '1' && currentToken() === null) {
      setStatus('Connect again to allow what you chose.', false);
    } else {
      scheduleSync();
    }
  });
  where.appendChild(whereSelect);
  body.appendChild(where);

  // the calendar the to-dos go to (only the ones that can be written to)
  if (usesCalendar && connected) {
    const row = document.createElement('label');
    row.className = 'small d-block mb-2';
    row.append('Calendar for my to-dos ');
    if (calendars.length === 0) {
      row.append(' loading…');
      void ensureCalendars();
    } else {
      const select = document.createElement('select');
      select.className = 'form-control form-control-sm';
      const current = calendarTargetId();
      for (const calendar of calendars.filter(item => item.writable)) {
        const option = document.createElement('option');
        option.value = calendar.id;
        option.textContent = calendar.summary;
        option.selected = current === calendar.id || (current === 'primary' && calendar.primary);
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        const picked = calendars.find(item => item.id === select.value);
        write(acct(KEY_CAL_TARGET), picked?.primary ? null : select.value);
        scheduleSync();
      });
      row.appendChild(select);
    }
    body.appendChild(row);
  }

  // one switch for the way back: changes and new items in Google come back into eLabFTW (with a calendar, new events become to-dos)
  const twoWayOn = read(KEY_TWO_WAY) === '1' && (!usesCalendar || read(acct(KEY_CAL_IMPORT)) === '1');
  body.appendChild(choice(
    'checkbox',
    'googleTwoWay',
    'Two-way: changes and new items in Google come back here (nothing is ever deleted here)',
    twoWayOn,
    on => {
      write(KEY_TWO_WAY, on ? '1' : null);
      write(acct(KEY_CAL_IMPORT), on ? '1' : null);
      scheduleSync();
    },
  )).classList.replace('mb-1', 'mb-2');

  const actions = document.createElement('div');
  actions.className = 'mb-1';
  if (connected) {
    actions.appendChild(button('Sync now', () => void runSync(), true));
    actions.appendChild(button('Disconnect', () => void disconnect()));
  } else {
    actions.appendChild(button(enabled ? 'Connect again' : 'Connect Google', () => void connect(), true));
  }
  body.appendChild(actions);

  if (!connected && !status) {
    const hint = document.createElement('div');
    hint.className = 'small text-muted';
    hint.textContent = 'Connect your Google account once to show its calendars here and to send your to-dos to it.';
    body.appendChild(hint);
  }
  if (status) {
    const line = document.createElement('div');
    line.className = `small ${statusIsError ? 'text-danger' : 'text-muted'}`;
    line.setAttribute('role', statusIsError ? 'alert' : 'status');
    line.textContent = status;
    body.appendChild(line);
  }
  host.appendChild(body);
}

export function initGoogleSync(): void {
  if (!document.getElementById('googleSyncRow')) {
    return;
  }
  render();
  window.addEventListener('todolist-changed', scheduleSync);
  // the calendar page of eLabFTW asks for the events of the calendars that are shown, for the days it shows
  window.addEventListener('elabftw:calendar-range', event => {
    wantedRange = (event as CustomEvent<{ from: string; to: string }>).detail;
    scheduleShown();
  });
  window.addEventListener('elabftw:calendar-ready', () => {
    scheduleShown();
    void publishCalendarList();
  });
  window.addEventListener('elabftw:calendar-toggle', event => {
    const detail = (event as CustomEvent<{ id: string; on: boolean }>).detail;
    toggleCalendar(detail.id, detail.on);
  });
  window.addEventListener('elabftw:calendar-connect', connectCalendars);
  // a calendar page that was opened before this started has asked already: tell it how things are
  void publishCalendarList();
  // the settings are drawn in the Calendars menu of the calendar page when it is opened
  window.addEventListener('elabftw:google-settings-open', () => render());
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
