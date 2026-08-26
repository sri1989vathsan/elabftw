import { ApiC } from './api';

type EditorDefaultKey = 'date' | 'title';

type EditorDefaults = Partial<Record<EditorDefaultKey, unknown>>;

// Every setting shares one JSON database column. Serialize writes so saving a
// date default and a title preset at nearly the same time cannot overwrite the
// other account setting with an older browser snapshot.
let accountDefaultsWrite: Promise<void> = Promise.resolve();

function getPrefsElement(): HTMLElement | null {
  return document.getElementById('user-prefs');
}

function readAccountDefaults(): EditorDefaults {
  const stored = getPrefsElement()?.dataset.editorDefaults;
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as EditorDefaults
      : {};
  } catch {
    return {};
  }
}

export function getAccountEditorDefault<T>(key: EditorDefaultKey): Partial<T> | null {
  const value = readAccountDefaults()[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<T>
    : null;
}

export function saveAccountEditorDefault<T extends object>(
  key: EditorDefaultKey,
  value: T,
): Promise<void> {
  const write = accountDefaultsWrite.then(async () => {
    const updated = { ...readAccountDefaults(), [key]: value };
    const json = JSON.stringify(updated);
    await ApiC.patch('users/me', { editor_defaults: json });
    const prefs = getPrefsElement();
    if (prefs) prefs.dataset.editorDefaults = json;
  });
  accountDefaultsWrite = write.catch(() => undefined);
  return write;
}
