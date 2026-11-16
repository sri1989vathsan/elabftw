/**
 * The logic of the optional two-way sync between the to-do tasks of a user and a Google Calendar of their own, without any browser or network
 * code (so it can be tested): a task with a deadline is an event that starts at the deadline and lasts as long as the task says (its duration).
 * googleSync.ts gives it the two sides and the settings.
 *
 * Rules (the same as for Google Tasks): the event is marked with the id of its task (a private extended property), a change is told from an
 * old value with the snapshot of what was written to both sides last time, eLabFTW wins when both sides changed, nothing is ever deleted in
 * eLabFTW, and an event that was deleted in Google is not made again until the task itself changes.
 */

export type CalTodo = {
  id: number;
  body: string;
  notes?: string | null;
  deadline: string | null;
  duration_minutes?: number | null;
  reminder_minutes?: number | null;
};

export type EventTime = { dateTime?: string; date?: string };

export type RemoteEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: EventTime;
  end?: EventTime;
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
};

export type EventBody = {
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: { private: Record<string, string> };
};

export type CalendarApi = {
  listEvents: (timeMin: string, timeMax: string) => Promise<RemoteEvent[]>;
  insertEvent: (body: EventBody) => Promise<RemoteEvent>;
  patchEvent: (id: string, patch: Partial<EventBody>) => Promise<void>;
};

export type CalLocalApi = {
  createTodo: (todo: { title: string; deadline: string; duration_minutes: number }) => Promise<number>;
  updateTodo: (id: number, patch: { title?: string; deadline?: string; duration_minutes?: number }) => Promise<void>;
};

// what was written to both sides last time, by task id
export type CalSnapshot = Record<string, {
  event: string;
  title: string;
  start: number;
  minutes: number;
  // the task is done and its event is marked so
  done?: boolean;
  // the event was deleted in Google: it is not made again until the task changes
  removed?: boolean;
}>;

export type CalOptions = {
  local: CalLocalApi;
  snapshot: CalSnapshot;
  twoWay: boolean;
  // new events of the calendar become to-dos (only with twoWay)
  importEvents: boolean;
  includeDetails: boolean;
  origin: string;
  // the days that are looked at: a task outside it is left alone
  range: { from: Date; to: Date };
  now?: Date;
};

export type CalResult = {
  snapshot: CalSnapshot;
  created: number;
  updated: number;
  pulled: number;
  imported: number;
  completed: number;
};

export const MARKER = 'elabftwTask';
export const DONE_PREFIX = '✓ ';
const DEFAULT_MINUTES = 30;

export function minutesOf(todo: CalTodo): number {
  return Number(todo.duration_minutes) > 0 ? Number(todo.duration_minutes) : DEFAULT_MINUTES;
}

function plain(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

export function eventBody(todo: CalTodo, options: { origin: string; includeDetails: boolean; done?: boolean }): EventBody {
  const start = new Date(todo.deadline as string);
  const end = new Date(start.getTime() + minutesOf(todo) * 60000);
  const link = `${options.origin.replace(/\/$/, '')}/projectmanagement.php?task=${todo.id}`;
  const notes = options.includeDetails && todo.notes ? plain(todo.notes) : '';
  const body: EventBody = {
    summary: (options.done ? DONE_PREFIX : '') + plain(todo.body),
    description: `${notes ? `${notes}\n\n` : ''}${link}`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { [MARKER]: String(todo.id) } },
  };
  if (todo.reminder_minutes !== null && todo.reminder_minutes !== undefined) {
    body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: Math.min(Number(todo.reminder_minutes), 40320) }] };
  }
  return body;
}

function startOf(event: RemoteEvent): number | null {
  return event.start?.dateTime ? new Date(event.start.dateTime).getTime() : null;
}

function minutesOfEvent(event: RemoteEvent): number {
  const start = startOf(event);
  const end = event.end?.dateTime ? new Date(event.end.dateTime).getTime() : null;
  return start !== null && end !== null && end > start ? Math.round((end - start) / 60000) : DEFAULT_MINUTES;
}

function titleOf(event: RemoteEvent): string {
  const summary = String(event.summary ?? '');
  return summary.startsWith(DONE_PREFIX) ? summary.slice(DONE_PREFIX.length) : summary;
}

export async function syncCalendar(api: CalendarApi, todos: CalTodo[], options: CalOptions): Promise<CalResult> {
  const now = options.now ?? new Date();
  const result: CalResult = { snapshot: {}, created: 0, updated: 0, pulled: 0, imported: 0, completed: 0 };
  const events = await api.listEvents(options.range.from.toISOString(), options.range.to.toISOString());
  const byTask = new Map<string, RemoteEvent>();
  for (const event of events) {
    const task = event.extendedProperties?.private?.[MARKER];
    if (task && event.status !== 'cancelled') {
      byTask.set(task, event);
    }
  }
  const open = new Map(todos.filter(todo => todo.deadline).map(todo => [String(todo.id), todo]));

  for (const [key, todo] of open) {
    const start = new Date(todo.deadline as string).getTime();
    const minutes = minutesOf(todo);
    const title = plain(todo.body);
    const snap = options.snapshot[key];
    const event = byTask.get(key);
    // outside of the days that are looked at: nothing is known about its event, it stays as it is
    if (start < options.range.from.getTime() || start >= options.range.to.getTime()) {
      if (snap) {
        result.snapshot[key] = snap;
      }
      continue;
    }
    if (!event) {
      if (snap && snap.removed && snap.title === title && snap.start === start && snap.minutes === minutes) {
        result.snapshot[key] = snap;
        continue;
      }
      if (snap && !snap.removed && snap.start === start && snap.minutes === minutes && snap.title === title) {
        // it was there and is not now: it was deleted in Google
        result.snapshot[key] = { ...snap, removed: true };
        continue;
      }
      const made = await api.insertEvent(eventBody(todo, options));
      result.created += 1;
      result.snapshot[key] = { event: made.id, title, start, minutes };
      continue;
    }
    const remote = { title: titleOf(event), start: startOf(event), minutes: minutesOfEvent(event) };
    const localSame = snap && snap.title === title && snap.start === start && snap.minutes === minutes;
    const remoteSame = snap && snap.title === remote.title && snap.start === remote.start && snap.minutes === remote.minutes;
    if (!snap) {
      // both sides exist and nothing was written before: eLabFTW wins unless they already agree
      if (remote.title !== title || remote.start !== start || remote.minutes !== minutes) {
        await api.patchEvent(event.id, eventBody(todo, options));
        result.updated += 1;
      }
      result.snapshot[key] = { event: event.id, title, start, minutes };
    } else if (!localSame) {
      // changed in eLabFTW (also when changed in Google too): eLabFTW wins
      if (remote.title !== title || remote.start !== start || remote.minutes !== minutes) {
        await api.patchEvent(event.id, eventBody(todo, options));
        result.updated += 1;
      }
      result.snapshot[key] = { event: event.id, title, start, minutes };
    } else if (!remoteSame && options.twoWay && remote.start !== null && remote.title.trim() !== '') {
      await options.local.updateTodo(todo.id, {
        ...(remote.title !== title ? { title: remote.title } : {}),
        ...(remote.start !== start ? { deadline: new Date(remote.start).toISOString() } : {}),
        ...(remote.minutes !== minutes ? { duration_minutes: Math.min(1440, Math.max(5, remote.minutes)) } : {}),
      });
      result.pulled += 1;
      result.snapshot[key] = { event: event.id, title: remote.title, start: remote.start, minutes: remote.minutes };
    } else {
      result.snapshot[key] = { event: event.id, title, start, minutes, ...(snap.done ? { done: true } : {}) };
    }
  }

  // a task that is not open any more (done): its event is marked with a tick, once, and kept
  for (const [key, snap] of Object.entries(options.snapshot)) {
    if (open.has(key) || result.snapshot[key]) {
      continue;
    }
    const event = byTask.get(key);
    if (event && !snap.done && !String(event.summary ?? '').startsWith(DONE_PREFIX)) {
      await api.patchEvent(event.id, { summary: DONE_PREFIX + titleOf(event) });
      result.completed += 1;
    }
    result.snapshot[key] = { ...snap, done: true };
  }

  // new events of the calendar become to-dos, and are marked so they are not taken twice
  if (options.twoWay && options.importEvents) {
    for (const event of events) {
      if (event.extendedProperties?.private?.[MARKER] || event.status === 'cancelled' || event.recurringEventId) {
        continue;
      }
      const start = startOf(event);
      const summary = String(event.summary ?? '').trim();
      if (start === null || summary === '' || start < now.getTime()) {
        continue;
      }
      const minutes = Math.min(1440, Math.max(5, minutesOfEvent(event)));
      const id = await options.local.createTodo({ title: summary, deadline: new Date(start).toISOString(), duration_minutes: minutes });
      await api.patchEvent(event.id, { extendedProperties: { private: { [MARKER]: String(id) } } });
      result.imported += 1;
      result.snapshot[String(id)] = { event: event.id, title: summary, start, minutes };
    }
  }
  return result;
}

export type CalendarInfo = { id: string; summary: string; color: string; writable: boolean; primary: boolean };

export type ShownEvent = { key: string; title: string; start: string; end: string; color: string; source: string; url?: string };

// the events of the calendars that are shown on the calendar page: the events that are tasks are left out (the page shows the tasks itself)
export function shownEvents(calendar: CalendarInfo, events: RemoteEvent[]): ShownEvent[] {
  const out: ShownEvent[] = [];
  for (const event of events) {
    if (event.status === 'cancelled' || event.extendedProperties?.private?.[MARKER]) {
      continue;
    }
    const startDay = event.start?.date;
    const start = event.start?.dateTime ?? (startDay ? new Date(`${startDay}T00:00:00`).toISOString() : null);
    const endDay = event.end?.date;
    const end = event.end?.dateTime ?? (endDay ? new Date(`${endDay}T00:00:00`).toISOString() : null);
    if (!start || !end) {
      continue;
    }
    out.push({
      key: `google-${calendar.id}-${event.id}`,
      title: String(event.summary ?? '(no title)'),
      start,
      end,
      color: calendar.color,
      source: calendar.summary,
    });
  }
  return out;
}
