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
