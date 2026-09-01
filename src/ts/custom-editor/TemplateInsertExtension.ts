/**
 * Fork-owned "Insert template" picker: search box plus Mine/Favourites/All
 * filtering, replacing TinyMCE's own bare, unsearchable template list
 * (previously wired via the `templates` config callback in tinymce.ts).
 */
import $ from 'jquery';
import { Editor } from 'tinymce/tinymce';
import { ApiC } from '../api';
import { entity } from '../getEntity';
import { Action, EntityType, Model } from '../interfaces';
import { escapeHTML, reloadElements } from '../misc';
import { notify } from '../notify';

interface TemplateSummary {
  id: number;
  title: string;
  userid: number;
  body: string;
  body_html?: string;
  version?: number;
}

interface TemplateVersionEntry {
  version: number;
  body: string;
  published_at: string;
  published_by_fullname: string;
}

type Tab = 'all' | 'mine' | 'favorites';

/**
 * Read the current user only when the template picker is opened.
 *
 * This extension is pulled into the standalone spreadsheet bundle through
 * shared editor utilities. That document intentionally has no `#core` JSON
 * element, so importing the eager `core` module here prevented the
 * spreadsheet application from mounting at all.
 */
function getCurrentUserid(): number | null {
  const rawCore = document.getElementById('core')?.textContent;
  if (!rawCore) return null;
  try {
    const userid = Number(JSON.parse(rawCore).currentUserid);
    return Number.isInteger(userid) ? userid : null;
  } catch {
    return null;
  }
}

export function registerTemplateInsertExtension(editor: Editor): void {
  editor.ui.registry.addIcon(
    'elabftw-insert-template',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="3" width="16" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 8h9M7.5 12h9M7.5 16h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  );
  editor.ui.registry.addButton('inserttemplate', {
    icon: 'elabftw-insert-template',
    tooltip: 'Insert a template',
    onAction: () => openTemplatePicker(editor),
  });
}

function openTemplatePicker(editor: Editor): void {
  Promise.all([
    ApiC.getJson(`${EntityType.Template}?full=1`),
    ApiC.getJson(Model.TemplateFavorite).catch(() => []),
  ]).then(([templates, favoriteIds]: [TemplateSummary[], number[]]) => {
    showPicker(editor, templates, new Set(favoriteIds));
  }).catch(() => notify.error('Could not load templates.'));
}

function showPicker(editor: Editor, templates: TemplateSummary[], favoriteIds: Set<number>): void {
  const modalId = 'templateInsertPickerModal';
  document.getElementById(modalId)?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal fade';
  modal.id = modalId;
  modal.tabIndex = -1;
  modal.setAttribute('role', 'dialog');
  modal.innerHTML = `
    <div class='modal-dialog modal-lg' role='document'>
      <div class='modal-content'>
        <div class='modal-header'>
          <h5 class='modal-title'>Insert a template</h5>
          <button type='button' class='close' data-dismiss='modal' aria-label='Close'><span aria-hidden='true'>&times;</span></button>
        </div>
        <div class='modal-body'>
          <input type='text' class='form-control mb-2' id='templateInsertSearch' placeholder='Search templates…' autocomplete='off'>
          <div class='btn-group mb-2' role='group'>
            <button type='button' class='btn btn-secondary active' data-tab='all'>All</button>
            <button type='button' class='btn btn-secondary' data-tab='mine'>Mine</button>
            <button type='button' class='btn btn-secondary' data-tab='favorites'>Favourites</button>
          </div>
          <p class='small text-muted mb-2'>Click a template to add it to the main text, use Link to associate it without inserting, or check several and insert them together.</p>
          <ul class='list-group' id='templateInsertList' style='max-height: 50vh; overflow-y: auto;'></ul>
        </div>
        <div class='modal-footer'>
          <button type='button' class='btn btn-primary' id='templateInsertSelectedBtn' disabled>Insert selected (0)</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const searchInput = modal.querySelector('#templateInsertSearch') as HTMLInputElement;
  const list = modal.querySelector('#templateInsertList') as HTMLUListElement;
  const insertSelectedBtn = modal.querySelector('#templateInsertSelectedBtn') as HTMLButtonElement;
  const tabButtons = Array.from(modal.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  let activeTab: Tab = 'all';
  const currentUserid = getCurrentUserid();
  // template id -> how many times to insert it. Persists across render()
  // (search/tab changes) so checking a template, then filtering it out of
  // view with a search, doesn't silently drop it. A quantity above 1 covers
  // combining several copies of the same template (e.g. 3x PCR) alongside
  // other distinct templates (e.g. + 1x gel purification) in one action.
  const selectedQty = new Map<number, number>();
  // template id -> chosen historical version. Absent means "latest" (the
  // template's current body), which is the common case, so version history
  // is only fetched lazily the first time a row's version picker is opened.
  const selectedVersion = new Map<number, number>();
  const versionCache = new Map<number, TemplateVersionEntry[]>();

  const formatVersionLabel = (entry: TemplateVersionEntry): string => {
    const date = new Date(entry.published_at).toLocaleDateString();
    return `v${entry.version} — ${date} (${entry.published_by_fullname})`;
  };

  const loadVersions = (id: number): Promise<TemplateVersionEntry[]> => {
    const cached = versionCache.get(id);
    if (cached) return Promise.resolve(cached);
    return ApiC.getJson<TemplateVersionEntry[]>(`${Model.TemplateVersion}/${id}`)
      .then(versions => {
        versionCache.set(id, versions);
        return versions;
      })
      .catch(() => {
        versionCache.set(id, []);
        return [];
      });
  };

  const populateVersionSelect = (select: HTMLSelectElement, id: number, versions: TemplateVersionEntry[]): void => {
    if (versions.length === 0) return;
    const current = selectedVersion.get(id);
    select.innerHTML = ['<option value="">Latest</option>']
      .concat(versions.map(v => (
        `<option value='${v.version}'${current === v.version ? ' selected' : ''}>${escapeHTML(formatVersionLabel(v))}</option>`
      )))
      .join('');
  };

  // When inserted content ends in a table or spreadsheet, TinyMCE's
  // contenteditable can leave the cursor inside its last cell instead of
  // after it, so the next template in a multi-insert would land nested
  // inside the previous one's table. Always land the cursor in a fresh
  // paragraph placed right after the just-inserted block: this both
  // escapes the block and gives consecutive templates a visible line
  // break between them.
  const insertLineBreakAfterInsert = (): void => {
    const body = editor.getBody();
    let block = editor.dom.getParent(editor.selection.getNode(), editor.dom.isBlock) as HTMLElement | null;
    if (!block || block === body) return;
    while (block.parentElement && block.parentElement !== body) {
      block = block.parentElement;
    }
    const p = editor.dom.create('p', {}, '<br data-mce-bogus="1">');
    block.parentNode?.insertBefore(p, block.nextSibling);
    editor.selection.setCursorLocation(p, 0);
  };

  const resolveHistoricalEntry = (tpl: TemplateSummary): TemplateVersionEntry | undefined => {
    const chosenVersion = selectedVersion.get(tpl.id);
    return chosenVersion !== undefined
      ? versionCache.get(tpl.id)?.find(v => v.version === chosenVersion)
      : undefined;
  };

  // Records the template as associated with this experiment (shows up in
  // the "Associated experimental templates" list) without touching the main
  // text -- shared by the insert flow (best-effort, so an insert still
  // succeeds even if this bookkeeping call fails) and the standalone "Link"
  // button (where it's the only thing happening, so failures are surfaced).
  const recordTemplateLink = (tpl: TemplateSummary, historicalEntry?: TemplateVersionEntry): Promise<void> => {
    const patchBody: {action: Action; template_id: number; version?: number} = {
      action: Action.LinkTemplateSource,
      template_id: tpl.id,
    };
    if (historicalEntry) patchBody.version = historicalEntry.version;
    return ApiC.patch(`${entity.type}/${entity.id}`, patchBody)
      .then(() => reloadElements(['associatedTemplatesContent']));
  };

  const insertTemplate = (tpl: TemplateSummary): void => {
    const historicalEntry = resolveHistoricalEntry(tpl);
    editor.execCommand('mceInsertContent', false, historicalEntry?.body ?? tpl.body_html ?? tpl.body ?? '');
    insertLineBreakAfterInsert();
    // best-effort: lets the template's own "Used in" list also pick up
    // experiments that got its content via insert rather than creation
    recordTemplateLink(tpl, historicalEntry).catch(() => {});
  };

  const linkTemplateOnly = (tpl: TemplateSummary): void => {
    recordTemplateLink(tpl, resolveHistoricalEntry(tpl))
      .then(() => notify.success(`${tpl.title} linked without inserting`))
      .catch(() => notify.error('Could not link template.'));
  };

  const totalSelectedCount = (): number => Array.from(selectedQty.values()).reduce((sum, qty) => sum + qty, 0);

  const updateSelectedButton = (): void => {
    const total = totalSelectedCount();
    insertSelectedBtn.disabled = total === 0;
    insertSelectedBtn.textContent = `Insert selected (${total})`;
  };

  function matchesTab(tpl: TemplateSummary): boolean {
    if (activeTab === 'mine') return currentUserid !== null && tpl.userid === currentUserid;
    if (activeTab === 'favorites') return favoriteIds.has(tpl.id);
    return true;
  }

  function render(): void {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = templates.filter(tpl => matchesTab(tpl)
      && (query === '' || tpl.title.toLowerCase().includes(query)));

    if (filtered.length === 0) {
      list.innerHTML = '<li class="list-group-item text-muted">No templates found.</li>';
      return;
    }
    list.innerHTML = filtered.map(tpl => {
      const isFav = favoriteIds.has(tpl.id);
      const checked = selectedQty.has(tpl.id);
      const qty = selectedQty.get(tpl.id) ?? 1;
      // If this template's version history was already fetched earlier in
      // this modal session, render it straight away so re-searching/
      // switching tabs doesn't visually reset an already-loaded picker.
      const cachedVersions = versionCache.get(tpl.id);
      const currentVersion = selectedVersion.get(tpl.id);
      const versionOptions = ['<option value="">Latest</option>']
        .concat((cachedVersions ?? []).map(v => (
          `<option value='${v.version}'${currentVersion === v.version ? ' selected' : ''}>${escapeHTML(formatVersionLabel(v))}</option>`
        )))
        .join('');
      return `
        <li class='list-group-item d-flex align-items-center' data-id='${tpl.id}'>
          <input type='checkbox' class='mr-2 template-insert-select' data-id='${tpl.id}' aria-label='Select ${escapeHTML(tpl.title)} to insert with others' ${checked ? 'checked' : ''}>
          <input type='number' class='form-control form-control-sm mr-2 template-insert-qty' data-id='${tpl.id}' min='1' max='20' value='${qty}' style='width: 4rem;' ${checked ? '' : 'disabled'} aria-label='Number of copies of ${escapeHTML(tpl.title)} to insert'>
          <select class='form-control form-control-sm mr-2 template-insert-version' data-id='${tpl.id}' style='width: 8rem;' ${cachedVersions ? "data-loaded='1'" : ''} aria-label='Version of ${escapeHTML(tpl.title)} to insert'>
            ${versionOptions}
          </select>
          <button type='button' class='btn btn-transparent p-1 mr-2 template-favorite-star' data-id='${tpl.id}' title='${isFav ? 'Remove from favourites' : 'Add to favourites'}'>
            <i class='fa-star fa-fw ${isFav ? 'fas text-warning' : 'far'}'></i>
          </button>
          <span class='flex-grow-1 template-insert-choice' data-id='${tpl.id}' style='cursor: pointer;'>${escapeHTML(tpl.title)}</span>
          <button type='button' class='btn btn-ghost btn-sm mr-1 template-link-only' data-id='${tpl.id}' title='Link without inserting into the main text'>
            <i class='fas fa-link fa-fw'></i> Link
          </button>
        </li>
      `;
    }).join('');
  }

  tabButtons.forEach(btn => btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab as Tab;
    render();
  }));

  searchInput.addEventListener('input', render);

  list.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const star = target.closest<HTMLElement>('.template-favorite-star');
    if (star) {
      const id = parseInt(star.dataset.id, 10);
      const isFav = favoriteIds.has(id);
      const request = isFav
        ? ApiC.delete(`${Model.TemplateFavorite}/${id}`)
        : ApiC.post(Model.TemplateFavorite, {template_id: id});
      request.then(() => {
        if (isFav) favoriteIds.delete(id);
        else favoriteIds.add(id);
        render();
      }).catch(() => notify.error('Could not update favourite.'));
      return;
    }
    const linkOnly = target.closest<HTMLElement>('.template-link-only');
    if (linkOnly) {
      const id = parseInt(linkOnly.dataset.id, 10);
      const tpl = templates.find(t => t.id === id);
      if (tpl) linkTemplateOnly(tpl);
      return;
    }
    const choice = target.closest<HTMLElement>('.template-insert-choice');
    if (choice) {
      const id = parseInt(choice.dataset.id, 10);
      const tpl = templates.find(t => t.id === id);
      if (tpl) insertTemplate(tpl);
      $(modal).modal('hide');
      return;
    }
    const checkbox = target.closest<HTMLInputElement>('.template-insert-select');
    if (checkbox) {
      const id = parseInt(checkbox.dataset.id, 10);
      if (checkbox.checked) {
        selectedQty.set(id, selectedQty.get(id) ?? 1);
      } else {
        selectedQty.delete(id);
      }
      const qtyInput = list.querySelector<HTMLInputElement>(`.template-insert-qty[data-id='${id}']`);
      if (qtyInput) qtyInput.disabled = !checkbox.checked;
      updateSelectedButton();
    }
  });

  list.addEventListener('change', event => {
    const target = event.target as HTMLElement;
    const versionSelect = target.closest<HTMLSelectElement>('.template-insert-version');
    if (versionSelect) {
      const id = parseInt(versionSelect.dataset.id, 10);
      if (versionSelect.value === '') selectedVersion.delete(id);
      else selectedVersion.set(id, parseInt(versionSelect.value, 10));
      return;
    }
    const qtyInput = target.closest<HTMLInputElement>('.template-insert-qty');
    if (!qtyInput) return;
    const id = parseInt(qtyInput.dataset.id, 10);
    const qty = Math.min(20, Math.max(1, parseInt(qtyInput.value, 10) || 1));
    qtyInput.value = String(qty);
    if (selectedQty.has(id)) {
      selectedQty.set(id, qty);
      updateSelectedButton();
    }
  });

  // Version history is fetched lazily, the first time a row's version
  // picker gets focus, so opening the modal doesn't fire one request per
  // template up front. 'focusin' (unlike 'focus') bubbles, so it can be
  // handled once here via delegation instead of per-select.
  list.addEventListener('focusin', event => {
    const select = (event.target as HTMLElement).closest<HTMLSelectElement>('.template-insert-version');
    if (!select || select.dataset.loaded === '1') return;
    select.dataset.loaded = '1';
    const id = parseInt(select.dataset.id, 10);
    loadVersions(id).then(versions => populateVersionSelect(select, id, versions));
  });

  insertSelectedBtn.addEventListener('click', () => {
    // Insertion order follows the template list, not selection order, so a
    // combined insert reads top-to-bottom the same way every time.
    templates.forEach(tpl => {
      const qty = selectedQty.get(tpl.id);
      if (!qty) return;
      for (let i = 0; i < qty; i++) insertTemplate(tpl);
    });
    $(modal).modal('hide');
  });

  render();
  updateSelectedButton();
  // static backdrop: an accidental click outside while picking several
  // templates shouldn't discard the in-progress selection
  $(modal).modal({backdrop: 'static'});
  $(modal).on('hidden.bs.modal', () => modal.remove());
}
