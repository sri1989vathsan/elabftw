/**
 * Keep failed editor saves isolated per entity without clearing unrelated
 * browser preferences. The legacy keys are read so existing recovery drafts
 * remain recoverable after upgrading.
 */

interface RecoveryDraft {
  body: string;
  savedAt: string;
}

const PREFIX = 'elabftw-recovery-draft';

function key(type: string, id: number): string {
  return `${PREFIX}:${type}:${id}`;
}

function legacyDraft(type: string, id: number): RecoveryDraft | null {
  if (localStorage.getItem('id') !== String(id) || localStorage.getItem('type') !== type) {
    return null;
  }
  const body = localStorage.getItem('body');
  if (body === null) return null;
  return { body, savedAt: localStorage.getItem('date') ?? '' };
}

function clearMatchingLegacyDraft(type: string, id: number): void {
  if (localStorage.getItem('id') !== String(id) || localStorage.getItem('type') !== type) return;
  ['body', 'id', 'type', 'date'].forEach(item => localStorage.removeItem(item));
}

export function readRecoveryDraft(type: string, id: number): RecoveryDraft | null {
  const stored = localStorage.getItem(key(type, id));
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as RecoveryDraft;
      if (typeof parsed.body === 'string' && typeof parsed.savedAt === 'string') return parsed;
    } catch {
      localStorage.removeItem(key(type, id));
    }
  }

  const legacy = legacyDraft(type, id);
  if (legacy) {
    saveRecoveryDraft(type, id, legacy.body, legacy.savedAt);
    clearMatchingLegacyDraft(type, id);
  }
  return legacy;
}

export function saveRecoveryDraft(type: string, id: number, body: string, savedAt = new Date().toISOString()): void {
  localStorage.setItem(key(type, id), JSON.stringify({ body, savedAt } satisfies RecoveryDraft));
}

export function clearRecoveryDraft(type: string, id: number, savedBody?: string, saveStartedAt?: number): void {
  if (savedBody !== undefined) {
    const draft = readRecoveryDraft(type, id);
    if (draft && draft.body !== savedBody) {
      const draftCreatedAt = Date.parse(draft.savedAt);
      // A draft created after this request began contains newer work and must
      // survive an older, slower request completing successfully.
      if (saveStartedAt === undefined || !Number.isFinite(draftCreatedAt) || draftCreatedAt > saveStartedAt) return;
    }
  }
  localStorage.removeItem(key(type, id));
  clearMatchingLegacyDraft(type, id);
}

export function isSameRecoveryContent(first: string, second: string): boolean {
  if (first === second) return true;
  const normalize = (html: string): string => {
    const template = document.createElement('template');
    template.innerHTML = html.replace(/\r\n?/g, '\n').trim();
    return template.innerHTML.trim();
  };
  return normalize(first) === normalize(second);
}
