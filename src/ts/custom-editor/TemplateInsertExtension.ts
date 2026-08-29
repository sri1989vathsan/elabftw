/**
 * Fork-owned "Insert template" picker: search box plus Mine/Favourites/All
 * filtering, replacing TinyMCE's own bare, unsearchable template list
 * (previously wired via the `templates` config callback in tinymce.ts).
 */
import $ from 'jquery';
import { Editor } from 'tinymce/tinymce';
import { ApiC } from '../api';
import { core } from '../core';
import { entity } from '../getEntity';
import { Action, Model } from '../interfaces';
import { escapeHTML } from '../misc';
import { notify } from '../notify';

interface TemplateSummary {
  id: number;
  title: string;
  userid: number;
  body: string;
  body_html?: string;
}

type Tab = 'all' | 'mine' | 'favorites';

export function registerTemplateInsertExtension(editor: Editor): void {
  editor.ui.registry.addIcon(
    'elabftw-insert-template',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M7.5 8h9M7.5 12h9M7.5 16h5" stroke-linecap="round"/></svg>',
  );
  editor.ui.registry.addButton('inserttemplate', {
    icon: 'elabftw-insert-template',
    tooltip: 'Insert a template',
    onAction: () => openTemplatePicker(editor),
  });
}

function openTemplatePicker(editor: Editor): void {
  Promise.all([
    ApiC.getJson(`${Model.Template}?full=1`),
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
          <ul class='list-group' id='templateInsertList' style='max-height: 50vh; overflow-y: auto;'></ul>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const searchInput = modal.querySelector('#templateInsertSearch') as HTMLInputElement;
  const list = modal.querySelector('#templateInsertList') as HTMLUListElement;
  const tabButtons = Array.from(modal.querySelectorAll<HTMLButtonElement>('[data-tab]'));
  let activeTab: Tab = 'all';

  function matchesTab(tpl: TemplateSummary): boolean {
    if (activeTab === 'mine') return tpl.userid === core.currentUserid;
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
      return `
        <li class='list-group-item d-flex align-items-center' data-id='${tpl.id}'>
          <button type='button' class='btn btn-transparent p-1 mr-2 template-favorite-star' data-id='${tpl.id}' title='${isFav ? 'Remove from favourites' : 'Add to favourites'}'>
            <i class='fa-star fa-fw ${isFav ? 'fas text-warning' : 'far'}'></i>
          </button>
          <span class='flex-grow-1 template-insert-choice' data-id='${tpl.id}' style='cursor: pointer;'>${escapeHTML(tpl.title)}</span>
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
    const choice = target.closest<HTMLElement>('.template-insert-choice');
    if (choice) {
      const id = parseInt(choice.dataset.id, 10);
      const tpl = templates.find(t => t.id === id);
      if (tpl) {
        editor.execCommand('mceInsertContent', false, tpl.body_html || tpl.body || '');
        // best-effort: lets the template's own "Used in" list also pick up
        // experiments that got its content via insert rather than creation
        ApiC.patch(`${entity.type}/${entity.id}`, {action: Action.LinkTemplateSource, template_id: id}).catch(() => {});
      }
      $(modal).modal('hide');
    }
  });

  render();
  $(modal).modal('show');
  $(modal).on('hidden.bs.modal', () => modal.remove());
}
