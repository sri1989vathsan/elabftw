/**
 * PyRAT integration UI for the upstream-compatible fork.
 * @license AGPL-3.0
 */

import { on } from './handlers';
import { getEditor } from './Editor.class';
import { escapeHTML } from './misc';
import { notify } from './notify';

interface PyratAnimal {
  id: string;
  animal_id: string;
  cage: string;
  sex: string;
  strain: string;
  genotype: string;
  status: string;
  project: string;
}

interface PyratCage {
  id: string;
  cage_id: string;
  room: string;
  rack: string;
  position: string;
  status: string;
  animal_count: string;
  project: string;
}

interface PyratLink {
  entity_type: 'animal' | 'cage';
  pyrat_entity_id: string;
  pyrat_label: string | null;
  created_at: string;
  scoresheet_url: string;
}

interface PyratResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function csrfToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  headers.set('Accept', 'application/json');
  if (options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    headers.set('X-Requested-With', 'XMLHttpRequest');
    headers.set('X-CSRF-Token', csrfToken());
  }
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const payload = await response.json() as PyratResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `PyRAT request failed (${response.status})`);
  }
  return payload.data as T;
}

function text(tag: string, value: string, className = ''): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = value;
  if (className) el.className = className;
  return el;
}

function getExperimentId(): number | null {
  const section = document.getElementById('pyratExperimentSection');
  if (!section) return null;
  const id = Number(section.dataset.experimentId ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function canInsertInMainText(): boolean {
  return document.getElementById('entityBodyEditorDiv') !== null;
}

function getEntityPageUrl(entityType: 'animal' | 'cage', entityId: string): string {
  const tab = entityType === 'cage' ? 'cages' : 'animals';
  return `animal-studies.php?tab=${tab}&q=${encodeURIComponent(entityId)}`;
}

function insertInMainText(entityType: 'animal' | 'cage', entityId: string, label: string): void {
  if (!canInsertInMainText()) return;
  const editor = getEditor();
  const linkLabel = `PyRAT ${entityType}: ${label || entityId}`;
  const url = getEntityPageUrl(entityType, entityId);
  editor.setContent(editor.type === 'md'
    ? `[${linkLabel.replace(/([\\[\]])/g, '\\$1')}](${url})`
    : `<a href="${escapeHTML(url)}">${escapeHTML(linkLabel)}</a>`);
  notify.success();
}

function createMainTextButton(
  entityType: 'animal' | 'cage',
  entityId: string,
  label: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline-primary ml-1';
  button.title = 'Add a link to this PyRAT record at the current main-text cursor';
  button.setAttribute('aria-label', button.title);
  const icon = document.createElement('i');
  icon.className = 'fas fa-paragraph fa-fw';
  icon.setAttribute('aria-hidden', 'true');
  const buttonLabel = document.createElement('span');
  buttonLabel.className = 'ml-1';
  buttonLabel.textContent = 'Add to text';
  button.append(icon, buttonLabel);
  button.addEventListener('click', () => insertInMainText(entityType, entityId, label));
  return button;
}

async function loadExperimentLinks(): Promise<void> {
  const experimentId = getExperimentId();
  const container = document.getElementById('pyratExperimentLinks');
  const count = document.getElementById('pyratExperimentLinksCount');
  const status = document.getElementById('pyratExperimentStatus');
  if (!experimentId || !container || !count || !status) return;

  try {
    const links = await request<PyratLink[]>(`app/controllers/PyratAjaxController.php?action=experiment-links&experiment_id=${experimentId}`);
    container.replaceChildren();
    count.textContent = String(links.length);
    status.textContent = links.length === 0
      ? 'No PyRAT animals or cages linked yet.'
      : 'Animal and cage details remain authoritative in PyRAT.';

    if (links.length === 0) return;
    const table = document.createElement('div');
    table.className = 'list-group';
    links.forEach(link => {
      const row = document.createElement('div');
      row.className = 'list-group-item d-flex flex-wrap align-items-center py-2';
      const info = document.createElement('div');
      info.className = 'mr-auto';
      info.append(
        text('strong', link.pyrat_label || link.pyrat_entity_id),
        text('div', `${link.entity_type} · ${link.pyrat_entity_id}`, 'small text-muted'),
      );
      const open = document.createElement('a');
      open.className = 'btn btn-sm btn-outline-secondary mr-1';
      open.href = `animal-studies.php?tab=${link.entity_type === 'cage' ? 'cages' : 'animals'}&q=${encodeURIComponent(link.pyrat_entity_id)}`;
      open.textContent = 'Open';
      const scoresheet = document.createElement('a');
      if (link.scoresheet_url) {
        scoresheet.className = 'btn btn-sm btn-outline-primary mr-1';
        scoresheet.href = link.scoresheet_url;
        scoresheet.target = '_blank';
        scoresheet.rel = 'noopener';
        scoresheet.textContent = 'Scoresheet';
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-sm btn-danger-ghost';
      remove.dataset.action = 'pyrat-unlink-animal';
      remove.dataset.entityType = link.entity_type;
      remove.dataset.entityId = link.pyrat_entity_id;
      remove.title = `Unlink ${link.entity_type}`;
      const icon = document.createElement('i');
      icon.className = 'fas fa-unlink';
      remove.append(icon);
      row.append(info, open);
      if (link.scoresheet_url) row.append(scoresheet);
      if (canInsertInMainText()) {
        row.append(createMainTextButton(
          link.entity_type,
          link.pyrat_entity_id,
          link.pyrat_label || link.pyrat_entity_id,
        ));
      }
      row.append(remove);
      table.append(row);
    });
    container.append(table);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not load PyRAT links.';
    status.className = 'small text-danger mr-2';
  }
}

on('pyrat-search-experiment-animals', () => {
  void (async () => {
    const input = document.getElementById('pyratExperimentAnimalSearch') as HTMLInputElement | null;
    const type = document.getElementById('pyratExperimentEntityType') as HTMLSelectElement | null;
    const results = document.getElementById('pyratExperimentSearchResults');
    if (!input || !type || !results) return;
    results.replaceChildren(text('div', 'Searching PyRAT…', 'text-muted'));
    try {
      const entityType = type.value === 'cage' ? 'cage' : 'animal';
      const rows = entityType === 'cage'
        ? await request<PyratCage[]>(`app/controllers/PyratAjaxController.php?action=cages&q=${encodeURIComponent(input.value.trim())}`)
        : await request<PyratAnimal[]>(`app/controllers/PyratAjaxController.php?action=animals&q=${encodeURIComponent(input.value.trim())}`);
      results.replaceChildren();
      if (rows.length === 0) {
        results.append(text('div', `No ${entityType}s found.`, 'text-muted'));
        return;
      }
      const table = document.createElement('div');
      table.className = 'list-group';
      rows.slice(0, 50).forEach(rowData => {
        const row = document.createElement('div');
        row.className = 'list-group-item d-flex flex-wrap align-items-center py-2';
        const info = document.createElement('div');
        info.className = 'mr-auto';
        const entityId = entityType === 'cage'
          ? ((rowData as PyratCage).id || (rowData as PyratCage).cage_id)
          : ((rowData as PyratAnimal).id || (rowData as PyratAnimal).animal_id);
        const label = entityType === 'cage'
          ? ((rowData as PyratCage).cage_id || entityId)
          : ((rowData as PyratAnimal).animal_id || entityId);
        const summary = entityType === 'cage'
          ? [(rowData as PyratCage).room, (rowData as PyratCage).rack, `${(rowData as PyratCage).animal_count || '0'} animals`, (rowData as PyratCage).status].filter(Boolean).join(' · ')
          : [(rowData as PyratAnimal).cage, (rowData as PyratAnimal).strain, (rowData as PyratAnimal).genotype, (rowData as PyratAnimal).sex, (rowData as PyratAnimal).status].filter(Boolean).join(' · ');
        info.append(text('strong', label), text('div', summary, 'small text-muted'));
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm btn-primary';
        button.dataset.action = 'pyrat-link-animal';
        button.dataset.entityType = entityType;
        button.dataset.entityId = entityId;
        button.dataset.label = label;
        button.textContent = 'Link';
        row.append(info, button);
        if (canInsertInMainText()) {
          row.append(createMainTextButton(entityType, entityId, label));
        }
        table.append(row);
      });
      results.append(table);
    } catch (error) {
      results.replaceChildren(text('div', error instanceof Error ? error.message : 'PyRAT search failed.', 'text-danger'));
    }
  })();
});

on('pyrat-link-animal', (el: HTMLElement) => {
  void (async () => {
    const experimentId = getExperimentId();
    if (!experimentId || !el.dataset.entityId || !el.dataset.entityType) return;
    try {
      await request('app/controllers/PyratAjaxController.php', {
        method: 'POST',
        body: JSON.stringify({
          action: 'link',
          experiment_id: experimentId,
          entity_type: el.dataset.entityType,
          entity_id: el.dataset.entityId,
          label: el.dataset.label ?? el.dataset.entityId,
        }),
      });
      notify.success();
      await loadExperimentLinks();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not link PyRAT record.');
    }
  })();
});

on('pyrat-unlink-animal', (el: HTMLElement) => {
  void (async () => {
    const experimentId = getExperimentId();
    if (!experimentId || !el.dataset.entityId || !el.dataset.entityType) return;
    try {
      await request('app/controllers/PyratAjaxController.php', {
        method: 'POST',
        body: JSON.stringify({
          action: 'unlink',
          experiment_id: experimentId,
          entity_type: el.dataset.entityType,
          entity_id: el.dataset.entityId,
        }),
      });
      notify.success();
      await loadExperimentLinks();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not unlink PyRAT record.');
    }
  })();
});

on('pyrat-test-connection', () => {
  void (async () => {
    const output = document.getElementById('pyratConnectionTestResult');
    if (output) {
      output.textContent = 'Testing…';
      output.className = 'small text-muted ml-2';
    }
    try {
      const status = await request<{ connected: boolean; demo: boolean; message: string }>('app/controllers/PyratAjaxController.php', {
        method: 'POST',
        body: JSON.stringify({action: 'test'}),
      });
      if (output) {
        output.textContent = status.message;
        output.className = `small ml-2 ${status.connected ? 'text-success' : 'text-warning'}`;
      }
    } catch (error) {
      if (output) {
        output.textContent = error instanceof Error ? error.message : 'Connection test failed.';
        output.className = 'small text-danger ml-2';
      }
    }
  })();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void loadExperimentLinks(), {once: true});
} else {
  void loadExperimentLinks();
}
