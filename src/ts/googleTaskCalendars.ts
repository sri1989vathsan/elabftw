/**
 * Which Google calendar a task goes to, when it is not the calendar chosen in the Google sync settings. Kept in this browser, per eLabFTW
 * account, like everything else of the Google sync (googleSync.ts): a task that has no entry goes to the calendar of the settings. The
 * popups of a task (to-do panel, calendar page) use these functions; googleSync.ts reads the same list when it makes the events.
 */
import { core } from './core';

const KEY = 'googleSyncTaskCalendars';

const key = (): string => `${KEY}:${core.currentUserid ?? 0}`;
// the same for a whole project (0 is "no project"): its tasks go to that calendar unless a task has one of its own
const projectKey = (): string => `googleSyncProjectCalendars:${core.currentUserid ?? 0}`;

export type PickableCalendar = { id: string; summary: string; color: string; primary: boolean };

// what the sync tells the popups ('elabftw:calendar-list'): whether the tasks go to a Google Calendar at all, and where to
export type CalendarChoices = { usable: boolean; calendars: PickableCalendar[]; target: string };

export function readTaskCalendars(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key()) ?? '{}') as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  } catch {
    return {};
  }
}

function readMap(storageKey: string): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  } catch {
    return {};
  }
}

export const readProjectCalendars = (): Record<string, string> => readMap(projectKey());

export function setProjectCalendar(projectId: number | string, calendarId: string | null): void {
  const map = readProjectCalendars();
  if (calendarId) {
    map[String(projectId)] = calendarId;
  } else {
    delete map[String(projectId)];
  }
  try {
    localStorage.setItem(projectKey(), JSON.stringify(map));
  } catch {
    // storage unavailable (private mode): the choice is not remembered
  }
}

// an empty choice (or null) puts the task back on the calendar of the settings
export function setTaskCalendar(taskId: number | string, calendarId: string | null): void {
  const map = readTaskCalendars();
  if (calendarId) {
    map[String(taskId)] = calendarId;
  } else {
    delete map[String(taskId)];
  }
  try {
    localStorage.setItem(key(), JSON.stringify(map));
  } catch {
    // storage unavailable (private mode): the choice is not remembered
  }
}

// the popups ask the sync for the calendars; the answer comes with 'elabftw:calendar-list' now and whenever it changes
export function watchCalendarChoices(onChange: (choices: CalendarChoices) => void): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<{ state?: string; syncs?: boolean; target?: string; calendars?: (PickableCalendar & { writable?: boolean })[] }>).detail;
    onChange({
      usable: detail?.state === 'ready' && detail.syncs === true,
      // the main calendar is always called 'primary' (the name Google's own address for it has no use here)
      calendars: (detail?.calendars ?? []).filter(calendar => calendar.writable === true).map(calendar => ({ ...calendar, id: calendar.primary ? 'primary' : calendar.id })),
      target: detail?.target ?? 'primary',
    });
  };
  window.addEventListener('elabftw:calendar-list', listener);
  window.dispatchEvent(new CustomEvent('elabftw:calendar-ready'));
  return () => window.removeEventListener('elabftw:calendar-list', listener);
}
