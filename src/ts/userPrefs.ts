/**
 * Small per-user interface settings that are kept on the server, so they follow the user to another browser.
 * This browser's own storage stays the working copy (the code that reads a setting is unchanged): the server's value
 * is copied into it when a page starts, and every change is sent to the server. A setting the server does not have yet
 * is sent up from this browser, so what people already chose is not lost.
 */
import { Api } from './Apiv2.class';
import { core } from './core';

// setting -> whether this browser stores it under the eLabFTW account (two people can use one browser)
const PREFS: Record<string, boolean> = {
  'elabftw-calendar-page-view': true,
  'elabftw-calendar-page-hidden-projects': true,
  googleSyncEnabled: false,
  googleSyncTwoWay: false,
  googleSyncDetails: false,
  googleSyncTarget: true,
  googleSyncCalendar: true,
  googleSyncCalendarsShown: true,
  googleSyncImportEvents: true,
};

const ApiC = new Api();

function localKey(base: string): string {
  return PREFS[base] ? `${base}:${core.currentUserid ?? 0}` : base;
}

/** The setting a browser storage key stands for, or null when that key is not kept on the server. */
export function userPrefBase(storageKey: string): string | null {
  const suffix = `:${core.currentUserid ?? 0}`;
  const base = storageKey.endsWith(suffix) ? storageKey.slice(0, -suffix.length) : storageKey;
  return Object.hasOwn(PREFS, base) && localKey(base) === storageKey ? base : null;
}

/** Sends a change to the server (null removes the setting). Failing is fine: this browser still has it. */
export function saveUserPref(storageKey: string, value: string | null): void {
  const base = userPrefBase(storageKey);
  if (base === null) return;
  const body: Record<string, string | number> = { action: 'set_user_pref', key: base, notifOnSaved: 0, notifOnError: 0 };
  if (value !== null) body.value = value;
  void ApiC.patch('experiments_folders', body).catch(() => { /* kept in this browser at least */ });
}

let started: Promise<boolean> | null = null;

/** Once per page: the server's settings win over this browser's. Resolves true when something here changed. */
export function syncUserPrefs(): Promise<boolean> {
  started ??= (async (): Promise<boolean> => {
    try {
      const response = await ApiC.patch('experiments_folders', { action: 'get_user_prefs', notifOnSaved: 0, notifOnError: 0 });
      const data = await response.json() as { prefs?: Record<string, string> | unknown[] };
      const server = (data.prefs && !Array.isArray(data.prefs) ? data.prefs : {}) as Record<string, string>;
      let changed = false;
      for (const base of Object.keys(PREFS)) {
        const key = localKey(base);
        const here = window.localStorage.getItem(key);
        if (Object.hasOwn(server, base)) {
          if (here !== server[base]) {
            window.localStorage.setItem(key, server[base]);
            changed = true;
          }
        } else if (here !== null) {
          saveUserPref(key, here);
        }
      }
      return changed;
    } catch {
      return false;
    }
  })();
  return started;
}
