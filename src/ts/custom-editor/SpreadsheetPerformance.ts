/** Keep geometry checks responsive while bounding work on an idle page. */
export function createSpreadsheetLayoutGate() {
  let activeUntil = 0;
  let lastCheck = -Infinity;
  return {
    invalidate(now: number): void { activeUntil = now + 350; },
    shouldMeasure(now: number, editing: boolean): boolean {
      if (!editing && now > activeUntil && now - lastCheck < 250) return false;
      lastCheck = now;
      return true;
    },
  };
}

/**
 * Cuts every <table class="... elabftw-spreadsheet ..."> element (with anything nested in it) out of
 * serialized HTML without parsing it. Parsing a long entry into a DOM for each undo level was the main
 * cost of pressing Enter in a text with big spreadsheets. Anything that cannot be matched exactly is left
 * in place, which can only make two snapshots look different (one extra undo step), never equal. The
 * editor serializes tag and attribute names in lower case, so they are matched as they are.
 */
export function stripSpreadsheetTables(html: string): string {
  if (!html.includes('elabftw-spreadsheet')) return html;
  let out = '';
  let from = 0;
  let open = html.indexOf('<table');
  while (open !== -1) {
    const next = html.charCodeAt(open + 6);
    const tagEnd = html.indexOf('>', open);
    // "<table" must be a whole tag name, not <tablefoo
    const isTable = tagEnd !== -1 && (next === 32 || next === 62 || next === 10 || next === 9 || next === 13);
    const tag = isTable ? html.slice(open, tagEnd) : '';
    const isSpreadsheet = /\sclass\s*=\s*(?:"[^"]*[\s"]elabftw-spreadsheet[\s"]|'[^']*[\s']elabftw-spreadsheet[\s'])/.test(tag + ' ')
      || /\sclass\s*=\s*(?:"|')elabftw-spreadsheet[\s"']/.test(tag + ' ');
    if (!isSpreadsheet) {
      open = html.indexOf('<table', open + 6);
      continue;
    }
    // find the matching </table>, counting nested tables
    let depth = 1;
    let scan = tagEnd + 1;
    let close = -1;
    while (depth > 0) {
      const nextOpen = html.indexOf('<table', scan);
      const nextClose = html.indexOf('</table', scan);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        scan = nextOpen + 6;
      } else {
        depth--;
        scan = nextClose + 7;
        if (depth === 0) close = html.indexOf('>', nextClose);
      }
    }
    if (close === -1) {
      // unmatched: keep the rest as it is
      open = html.indexOf('<table', open + 6);
      continue;
    }
    out += html.slice(from, open);
    from = close + 1;
    open = html.indexOf('<table', from);
  }
  return out + html.slice(from);
}

/** Snapshot objects belong to TinyMCE; weak keys do not retain old history. */
export function createSpreadsheetSnapshotCache(normalize: (html: string) => string) {
  const cache = new WeakMap<object, { html: string; normalized: string }>();
  return (level: { content: string }): string => {
    const previous = cache.get(level);
    if (previous?.html === level.content) return previous.normalized;
    const normalized = normalize(level.content);
    cache.set(level, { html: level.content, normalized });
    return normalized;
  };
}

export interface SpreadsheetRepaintClock {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, delay: number): number;
  clearTimer(id: number): void;
}

/** One repaint burst per grid, always reading current state, never a stale edit. */
export function createSpreadsheetRepaintQueue(repaint: () => void, clock: SpreadsheetRepaintClock) {
  let frame: number | null = null;
  let fallback: number | null = null;
  let timers: number[] = [];
  let disposed = false;
  let generation = 0;
  const clearRetries = (): void => {
    timers.forEach(id => clock.clearTimer(id));
    timers = [];
  };
  const clearFallback = (): void => {
    if (fallback !== null) clock.clearTimer(fallback);
    fallback = null;
  };
  const burst = (): void => {
    frame = null;
    clearFallback();
    if (disposed) return;
    const current = generation;
    repaint();
    if (disposed || current !== generation) return;
    // Retain the existing library-settling checkpoints, but cancel
    // older bursts when a newer edit supersedes them.
    timers = [0, 120, 400].map(delay => clock.setTimer(() => {
      if (!disposed && current === generation) repaint();
    }, delay));
  };
  return {
    schedule(): void {
      if (disposed) return;
      generation++;
      clearRetries();
      if (frame !== null) return;
      frame = clock.requestFrame(burst);
      // A hidden or background tab never runs animation frames. If none arrives soon, repaint from
      // a timer instead so formula results do not stay stale.
      fallback = clock.setTimer(() => {
        fallback = null;
        if (frame === null) return;
        clock.cancelFrame(frame);
        burst();
      }, 100);
    },
    dispose(): void {
      disposed = true;
      generation++;
      if (frame !== null) clock.cancelFrame(frame);
      frame = null;
      clearFallback();
      clearRetries();
    },
  };
}

export interface SpreadsheetProfiler {
  readonly enabled: boolean;
  /** Returns a timestamp to pass to end(); 0 when profiling is off. */
  start(): number;
  end(label: string, startedAt: number): void;
  count(label: string, amount?: number): void;
  summary(): Record<string, { count: number; totalMs: number; maxMs: number; avgMs: number }>;
  reset(): void;
}

/**
 * Opt-in timing for the spreadsheet overlays. Off unless
 * localStorage['elabftw-spreadsheet-perf'] === '1' (reload to apply). Prints
 * one summary to the console shortly after activity settles, and exposes
 * window.elabftwSpreadsheetPerf.{summary,reset} for manual reads. Records
 * nothing and costs one boolean check per call when disabled.
 */
export function createSpreadsheetProfiler(
  log: (message: string, data: unknown) => void = (message, data) => console.log(message, data),
): SpreadsheetProfiler {
  let enabled = false;
  try {
    enabled = window.localStorage.getItem('elabftw-spreadsheet-perf') === '1';
  } catch {
    enabled = false;
  }
  const stats = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  let flushTimer: number | null = null;
  const summary = (): Record<string, { count: number; totalMs: number; maxMs: number; avgMs: number }> => {
    const result: Record<string, { count: number; totalMs: number; maxMs: number; avgMs: number }> = {};
    stats.forEach((value, key) => {
      result[key] = {
        count: value.count,
        totalMs: Math.round(value.totalMs * 10) / 10,
        maxMs: Math.round(value.maxMs * 10) / 10,
        avgMs: Math.round((value.totalMs / value.count) * 100) / 100,
      };
    });
    return result;
  };
  const scheduleFlush = (): void => {
    if (flushTimer !== null) window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      log('[spreadsheet-perf] activity settled; summary since last reset', summary());
    }, 1500);
  };
  const profiler: SpreadsheetProfiler = {
    enabled,
    start: () => (enabled ? performance.now() : 0),
    end(label, startedAt) {
      if (!enabled) return;
      const elapsed = performance.now() - startedAt;
      const entry = stats.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
      entry.count++;
      entry.totalMs += elapsed;
      entry.maxMs = Math.max(entry.maxMs, elapsed);
      stats.set(label, entry);
      scheduleFlush();
    },
    count(label, amount = 1) {
      if (!enabled) return;
      const entry = stats.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
      entry.count += amount;
      stats.set(label, entry);
      scheduleFlush();
    },
    summary,
    reset: () => stats.clear(),
  };
  if (enabled) {
    (window as unknown as { elabftwSpreadsheetPerf?: SpreadsheetProfiler }).elabftwSpreadsheetPerf = profiler;
  }
  return profiler;
}
