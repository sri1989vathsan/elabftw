/**
 * Content-free diagnostics and recovery copies for the inline grid / popup / saved
 * table synchronisation.
 *
 * The events recorded here carry table ids, revision numbers, sizes, hashes and timing
 * only -- never cell values -- so they can be shared when a transition fails. Recovery
 * copies are the one place table markup is kept: they stay in this browser (memory and,
 * when available, localStorage) and are only written when two versions of a table
 * disagree, so the older one is never silently lost.
 */

type Cells = ReadonlyArray<ReadonlyArray<unknown>>;

export interface SyncEvent {
  /** milliseconds since the page loaded */
  t: number;
  ev: string;
  uid: string;
  [detail: string]: string | number | boolean | undefined;
}

export interface RecoveryCopy {
  /** epoch milliseconds */
  at: number;
  uid: string;
  reason: string;
  html: string;
}

const MAX_EVENTS = 500;
const MAX_RECOVERY_COPIES = 8;
const STORAGE_KEY = 'elabftw-spreadsheet-recovery';

function cellText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Cell values as strings, without trailing empty rows and columns. */
export function normalizeCells(data: Cells): string[][] {
  const rows = data.map(row => (row ?? []).map(cellText));
  while (rows.length > 0 && rows[rows.length - 1].every(value => value === '')) rows.pop();
  const width = rows.reduce((max, row) => {
    let last = row.length;
    while (last > 0 && row[last - 1] === '') last--;
    return Math.max(max, last);
  }, 0);
  return rows.map(row => {
    const padded = row.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  });
}

/** Short fingerprint of the cell values (FNV-1a), so two copies can be compared without logging them. */
export function hashCells(data: Cells): string {
  const normalized = normalizeCells(data);
  let hash = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  normalized.forEach(row => {
    row.forEach(value => { feed(value); feed('\u0001'); });
    feed('\u0002');
  });
  return `${normalized.length}x${normalized[0]?.length ?? 0}:${hash.toString(16).padStart(8, '0')}`;
}

export function cellsEqual(a: Cells, b: Cells): boolean {
  return hashCells(a) === hashCells(b);
}

export interface SyncDiagnostics {
  log: (ev: string, uid: string, details?: Record<string, string | number | boolean | undefined>) => void;
  events: () => SyncEvent[];
  revision: (uid: string) => number;
  bump: (uid: string, source: string) => number;
  revisions: () => Record<string, number>;
  saveRecovery: (uid: string, reason: string, html: string) => void;
  recoveryCopies: () => RecoveryCopy[];
}

export function createSyncDiagnostics(): SyncDiagnostics {
  const events: SyncEvent[] = [];
  const revisions = new Map<string, number>();
  let recovery: RecoveryCopy[] = [];

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as RecoveryCopy[];
      if (Array.isArray(parsed)) recovery = parsed.slice(-MAX_RECOVERY_COPIES);
    }
  } catch {
    // storage can be unavailable (private window, blocked site data)
  }

  const log: SyncDiagnostics['log'] = (ev, uid, details = {}) => {
    events.push({ t: Math.round(performance.now()), ev, uid, ...details });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  };

  const persist = (): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(recovery));
    } catch {
      // the in-memory copy still exists
    }
  };

  return {
    log,
    events: () => events.map(event => ({ ...event })),
    revision: uid => revisions.get(uid) ?? 0,
    bump: (uid, source) => {
      const next = (revisions.get(uid) ?? 0) + 1;
      revisions.set(uid, next);
      log('rev', uid, { rev: next, source });
      return next;
    },
    revisions: () => Object.fromEntries(revisions),
    saveRecovery: (uid, reason, html) => {
      recovery.push({ at: Date.now(), uid, reason, html });
      recovery = recovery.slice(-MAX_RECOVERY_COPIES);
      persist();
      log('recovery-copy', uid, { reason, bytes: html.length });
    },
    recoveryCopies: () => recovery.map(copy => ({ ...copy })),
  };
}
