/**
 * What the calendar settings window and the calendar page share, per eLabFTW account and kept in this browser: the calendars from a web
 * address (an .ics file each: its address, name and colour, and what was read from it last) and how the grid looks (the working hours it
 * starts with, and whether Saturday and Sunday show). The settings window can be opened on any page, the calendar page shows the result.
 */
import { get, writable } from 'svelte/store';
import { core } from './core';
import i18next from './i18n';
import { feedAddress, feedInfo } from './icalFeed';

export type Feed = { id: string; name: string; url: string; color: string; shown: boolean };

export type ViewPrefs = { start: number; end: number; weekends: boolean };

const FEEDS_KEY = 'elabftw-calendar-page-feeds';
const PREFS_KEY = 'elabftw-calendar-page-view-options';
const REFRESH_MS = 15 * 60000;
const PALETTE = ['#0c58ab', '#7c3aed', '#1a7f4b', '#b45309', '#be185d', '#0f766e', '#c2410c', '#4d7c0f'];

const t = i18next.t.bind(i18next);

const account = (key: string): string => `${key}:${core.currentUserid ?? 0}`;

export const feeds = writable<Feed[]>([]);
// what each address gave last time (the text of the calendar) and what went wrong with it
export const feedText = writable<Record<string, string>>({});
export const feedError = writable<Record<string, string>>({});
export const viewPrefs = writable<ViewPrefs>({ start: 8, end: 18, weekends: true });

const fetched: Record<string, number> = {};
let loaded = false;

function readFeeds(): Feed[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(account(FEEDS_KEY)) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Feed => typeof item === 'object' && item !== null && typeof (item as Feed).url === 'string' && typeof (item as Feed).id === 'string')
      : [];
  } catch {
    return [];
  }
}

function readPrefs(): ViewPrefs {
  const fallback: ViewPrefs = { start: 8, end: 18, weekends: true };
  try {
    const raw = JSON.parse(window.localStorage.getItem(account(PREFS_KEY)) ?? '{}') as Partial<ViewPrefs>;
    const start = Number.isInteger(raw.start) ? Math.min(23, Math.max(0, raw.start as number)) : fallback.start;
    const end = Number.isInteger(raw.end) ? Math.min(24, Math.max(start + 1, raw.end as number)) : Math.max(start + 1, fallback.end);
    return { start, end, weekends: raw.weekends !== false };
  } catch {
    return fallback;
  }
}

// the first one that needs them reads them (the user is known by then)
export function loadCalendarSettings(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  feeds.set(readFeeds());
  viewPrefs.set(readPrefs());
}

function saveFeeds(): void {
  try { window.localStorage.setItem(account(FEEDS_KEY), JSON.stringify(get(feeds))); } catch { /* not remembered */ }
}

export function setViewPrefs(next: ViewPrefs): void {
  const prefs = { ...next, end: Math.max(next.start + 1, next.end) };
  viewPrefs.set(prefs);
  try { window.localStorage.setItem(account(PREFS_KEY), JSON.stringify(prefs)); } catch { /* not remembered */ }
}

// reads the calendar at an address; throws a sentence that says what is wrong
export async function fetchFeed(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new Error(t('The calendar could not be read from this address. The site may not allow other sites to read it, or this server does not allow it to be contacted (the administrator can allow it in the Content-Security-Policy).'));
  }
  if (!response.ok) {
    throw new Error(`${t('The address answered with an error')}: ${response.status}`);
  }
  const text = await response.text();
  if (!feedInfo(text).valid) {
    throw new Error(t('This address is not a calendar (an .ics file).'));
  }
  return text;
}

export async function refreshFeed(feed: Feed, force = false): Promise<void> {
  if (!force && Date.now() - (fetched[feed.id] ?? 0) < REFRESH_MS) {
    return;
  }
  fetched[feed.id] = Date.now();
  try {
    const text = await fetchFeed(feed.url);
    feedText.update(all => ({ ...all, [feed.id]: text }));
    feedError.update(all => {
      const { [feed.id]: _gone, ...rest } = all;
      return rest;
    });
  } catch (error) {
    feedError.update(all => ({ ...all, [feed.id]: error instanceof Error ? error.message : String(error) }));
  }
}

export function refreshFeeds(force = false): void {
  for (const feed of get(feeds).filter(item => item.shown)) {
    void refreshFeed(feed, force);
  }
}

// adds a calendar from a web address (or a webcal:// one); throws a sentence that says what is wrong
export async function addFeed(addressInput: string, nameInput: string): Promise<void> {
  const url = feedAddress(addressInput);
  if (url === '') {
    throw new Error(t('Enter the web address of a calendar: it starts with https:// (or webcal://) and ends in .ics.'));
  }
  if (get(feeds).some(item => item.url === url)) {
    throw new Error(t('This calendar is already in the list.'));
  }
  const text = await fetchFeed(url);
  const id = `f${Date.now().toString(36)}`;
  const name = nameInput.trim() || feedInfo(text).name || new URL(url).hostname;
  feeds.update(list => [...list, { id, name, url, color: PALETTE[(list.length + 3) % PALETTE.length], shown: true }]);
  feedText.update(all => ({ ...all, [id]: text }));
  fetched[id] = Date.now();
  saveFeeds();
}

export function toggleFeed(id: string): void {
  const feed = get(feeds).find(item => item.id === id);
  if (!feed) {
    return;
  }
  feeds.update(list => list.map(item => (item.id === id ? { ...item, shown: !item.shown } : item)));
  saveFeeds();
  if (!feed.shown) {
    void refreshFeed(feed);
  }
}

export function removeFeed(id: string): void {
  feeds.update(list => list.filter(item => item.id !== id));
  feedText.update(all => {
    const { [id]: _text, ...rest } = all;
    return rest;
  });
  feedError.update(all => {
    const { [id]: _error, ...rest } = all;
    return rest;
  });
  saveFeeds();
}
