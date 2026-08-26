import { ApiC } from './api';

type EditorDefaultKey = 'date' | 'title';

type EditorDefaults = Partial<Record<EditorDefaultKey, unknown>>;

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

export async function saveAccountEditorDefault<T extends object>(
  key: EditorDefaultKey,
  value: T,
): Promise<void> {
  const updated = { ...readAccountDefaults(), [key]: value };
  const json = JSON.stringify(updated);
  await ApiC.patch('users/me', { editor_defaults: json });
  const prefs = getPrefsElement();
  if (prefs) prefs.dataset.editorDefaults = json;
}
