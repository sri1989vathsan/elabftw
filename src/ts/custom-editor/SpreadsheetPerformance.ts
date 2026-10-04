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
  let timers: number[] = [];
  let disposed = false;
  let generation = 0;
  const clearRetries = (): void => {
    timers.forEach(id => clock.clearTimer(id));
    timers = [];
  };
  return {
    schedule(): void {
      if (disposed) return;
      generation++;
      clearRetries();
      if (frame !== null) return;
      frame = clock.requestFrame(() => {
        frame = null;
        if (disposed) return;
        const current = generation;
        repaint();
        if (disposed || current !== generation) return;
        // Retain the existing library-settling checkpoints, but cancel
        // older bursts when a newer edit supersedes them.
        timers = [0, 120, 400].map(delay => clock.setTimer(() => {
          if (!disposed && current === generation) repaint();
        }, delay));
      });
    },
    dispose(): void {
      disposed = true;
      generation++;
      if (frame !== null) clock.cancelFrame(frame);
      frame = null;
      clearRetries();
    },
  };
}
