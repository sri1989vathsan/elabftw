/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import {
  collectForm,
  getInput,
  mkSpin,
  mkSpinStop,
  permissionsToJson,
  reloadElements,
  TomSelect,
} from './misc';
import { refreshAnnouncementWidgets } from './common';
import $ from 'jquery';
import { Malle } from '@deltablot/malle';
import i18next from './i18n';
import { getEditor } from './Editor.class';
import { ApiC } from './api';
import { Model, Action } from './interfaces';
import type { Selected } from './interfaces';
import tinymce from 'tinymce/tinymce';
import { notify } from './notify';
import { on } from './handlers';

function collectSelectable(name: string): number[] {
  const collected = [];
  document.querySelectorAll(`#batchActions input[name=${name}]`).forEach(input => {
    const box = input as HTMLInputElement;
    if (box.checked) {
      collected.push(parseInt((input as HTMLInputElement).value, 10));
    }
  });
  return collected;
}

function collectInt(name: string): number {
  return parseInt(getInput(name).value, 10);
}

// Collect selected teams, user groups and users from TomSelect-backed selects.
function collectCan(): string {
  // Warning: copy pasta from common.ts save-permissions action
  return permissionsToJson(
    Array.from((document.getElementById('masscan_select_teams') as HTMLSelectElement).selectedOptions).map(v => v.value)
      .concat(Array.from((document.getElementById('masscan_select_teamgroups') as HTMLSelectElement).selectedOptions).map(v => v.value))
      .concat(Array.from((document.getElementById('masscan_select_users') as HTMLSelectElement).selectedOptions).map(v => v.value)),
  );
}

function getSelected(): Selected {
  return {
    items_categories: collectSelectable('items_categories'),
    items_status: collectSelectable('items_status'),
    items_tags: collectSelectable('items_tags'),
    experiments_status: collectSelectable('experiments_status'),
    experiments_categories: collectSelectable('experiments_categories'),
    experiments_tags: collectSelectable('experiments_tags'),
    tags: collectSelectable('tags'),
    users_experiments: collectSelectable('users_experiments'),
    users_resources: collectSelectable('users_resources'),
    users_experiments_templates: collectSelectable('users_experiments_templates'),
    users_resources_templates: collectSelectable('users_resources_templates'),
    userid: collectInt('targetUserId'),
    team: collectInt('targetTeamId'),
    can: collectCan(),
    can_base: parseInt((document.getElementById('masscan_select_base') as HTMLSelectElement).value, 10),
  };
}

// RUN ACTION ON SELECTED (BATCH)
on('run-action-selected', (el: HTMLElement) => {
  const btn = el as HTMLButtonElement;
  const selected = getSelected();
  if (!Object.values(selected).some(array => array.length > 0)) {
    notify.error('nothing-selected');
    return;
  }
  const oldHTML = mkSpin(btn);
  selected['action'] = btn.dataset.what;
  // we use a custom notif message, so disable the native notif
  selected['notifOnSaved'] = 0;
  ApiC.post('batch', selected).then(res => {
    const processed = res.headers.get('location').split('/').pop();
    notify.success('entries-processed', { num: processed });
  }).finally(() => {
    mkSpinStop(btn, oldHTML);
  });
});

on('update-counter-value', (el: HTMLElement) => {
  const counterValue = el.parentElement.parentElement.parentElement.previousElementSibling.querySelector('.counterValue');
  const box = el as HTMLInputElement;
  let count = parseInt(counterValue.textContent, 10);
  if (box.checked) {
    count += 1;
  } else {
    count -= 1;
  }
  counterValue.textContent = String(count);
});

on('create-teamgroup', (_, event: Event) => {
  event.preventDefault();
  const form = document.getElementById('createGroupForm') as HTMLFormElement;
  const params = collectForm(form);
  ApiC.post(`${Model.Team}/current/${Model.TeamGroup}`, params).then(() => {
    reloadElements(['team_groups_div']);
    form.reset();
  });
});

on('adduser-teamgroup', (el: HTMLElement, event: Event) => {
  event.preventDefault();
  const user = parseInt(el.parentNode.parentNode.querySelector('input').value, 10);
  if (isNaN(user)) {
    notify.error('add-user-error');
    return;
  }
  ApiC.patch(
    `${Model.Team}/current/${Model.TeamGroup}/${el.dataset.groupid}`,
    {how: Action.Add, userid: user},
  ).then(() => reloadElements(['team_groups_div']));
});

on('rmuser-teamgroup', (el: HTMLElement) => {
  ApiC.patch(`${Model.Team}/current/${Model.TeamGroup}/${el.dataset.groupid}`, {how: Action.Unreference, userid: el.dataset.userid})
    .then(() => el.parentElement.remove());
});

on('destroy-teamgroup', (el: HTMLElement) => {
  if (confirm(i18next.t('generic-delete-warning'))) {
    ApiC.delete(`${Model.Team}/current/${Model.TeamGroup}/${el.dataset.id}`)
      .then(() => el.parentElement.remove());
  }
});

// managing an announcement is possible from the admin panel
// (announcementsAdminDiv), inline from the dashboard feed
// (announcementFeed), and reacting to one from the history page
// (announcementsHistoryList) too -- reloadElements() silently skips
// whichever of these isn't present on the current page, so the same
// handlers work from all of them.
const ANNOUNCEMENT_RELOAD_TARGETS = ['announcementsAdminDiv', 'announcementFeed', 'announcementsHistoryList'];

// refreshAnnouncementWidgets() (dismiss-key/read-more/etc) plus (re)binding
// drag-and-drop on any dropzone the just-reloaded fragment brought in --
// bindAnnouncementImageDropzones() is declared further down but hoisted,
// same module.
function refreshAnnouncementUi(): void {
  refreshAnnouncementWidgets();
  bindAnnouncementImageDropzones();
}
// bind whatever dropzones are already in the initial server-rendered page
bindAnnouncementImageDropzones();

on('create-announcement', (_, event: Event) => {
  event.preventDefault();
  const form = document.getElementById('createAnnouncementForm') as HTMLFormElement;
  const params = collectForm(form);
  ApiC.post(Model.Announcement, params).then(() => {
    reloadElements(ANNOUNCEMENT_RELOAD_TARGETS).then(refreshAnnouncementUi);
    form.reset();
  });
});

on('save-announcement', (el: HTMLElement, event: Event) => {
  event.preventDefault();
  // el.closest('form'), not getElementById(`announcementEditForm-${id}`):
  // the same announcement can have more than one edit form on the page at
  // once (the dashboard's banner dropdown and feed both render one for
  // every active announcement), so the id alone doesn't pick out the one
  // that was actually submitted.
  const form = el.closest('form') as HTMLFormElement;
  const params = collectForm(form);
  ApiC.patch(`${Model.Announcement}/${el.dataset.id}`, params).then(() => reloadElements(ANNOUNCEMENT_RELOAD_TARGETS).then(refreshAnnouncementUi));
});

// attaching an image is immediate, like an order attachment -- no separate
// "Save" click needed: upload the file, then point image_url at it. Shared
// between the plain file input (change) and the dropzone (drop) below.
interface AnnouncementUpload {
  long_name: string;
  storage: number;
  real_name: string;
}
function uploadAnnouncementImage(announcementId: string, file: File): void {
  const formData = new FormData();
  formData.set('file', file);
  ApiC.post2location(`${Model.Announcement}/${announcementId}/${Model.Upload}`, formData)
    .then(uploadId => ApiC.getJson<AnnouncementUpload>(`${Model.Announcement}/${announcementId}/${Model.Upload}/${uploadId}`))
    .then(upload => {
      const imageUrl = `app/download.php?f=${encodeURIComponent(upload.long_name)}&storage=${upload.storage}&name=${encodeURIComponent(upload.real_name)}`;
      return ApiC.patch(`${Model.Announcement}/${announcementId}`, { image_url: imageUrl });
    })
    .then(() => reloadElements(ANNOUNCEMENT_RELOAD_TARGETS).then(refreshAnnouncementUi));
}
on('upload-announcement-image', (el: HTMLElement) => {
  const input = el as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !input.dataset.id) return;
  uploadAnnouncementImage(input.dataset.id, file);
});

// drag-and-drop onto the dropzone wrapping that same file input -- mirrors
// OrdersBoard.svelte's own attachments dropzone. Bound directly (not via
// data-action/data-change-action, neither of which cover drag events) from
// refreshAnnouncementUi() above, once per element.
export function bindAnnouncementImageDropzones(): void {
  document.querySelectorAll<HTMLElement>('.announcement-image-dropzone').forEach(zone => {
    if (zone.dataset.dropzoneBound) return;
    zone.dataset.dropzoneBound = '1';
    zone.addEventListener('dragover', event => {
      event.preventDefault();
      zone.classList.add('announcement-image-dropzone-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('announcement-image-dropzone-over'));
    zone.addEventListener('drop', event => {
      event.preventDefault();
      zone.classList.remove('announcement-image-dropzone-over');
      const file = event.dataTransfer?.files?.[0];
      if (!file || !zone.dataset.id) return;
      uploadAnnouncementImage(zone.dataset.id, file);
    });
  });
}

on('toggle-pin-announcement', (el: HTMLElement) => {
  ApiC.patch(`${Model.Announcement}/${el.dataset.id}`, {action: Action.Pin}).then(() => reloadElements(ANNOUNCEMENT_RELOAD_TARGETS).then(refreshAnnouncementUi));
});

// reacting is open to any team member, not just an admin -- unlike the
// other announcement actions above, Announcements::patch() doesn't gate
// this one behind canWriteOrExplode()
on('react-to-announcement', (el: HTMLElement) => {
  ApiC.patch(`${Model.Announcement}/${el.dataset.id}`, {action: Action.React, emoji: el.dataset.emoji})
    .then(() => reloadElements(ANNOUNCEMENT_RELOAD_TARGETS).then(refreshAnnouncementUi));
});

on('expire-announcement', (el: HTMLElement) => {
  ApiC.patch(`${Model.Announcement}/${el.dataset.id}`, {action: Action.Expire}).then(() => reloadElements(ANNOUNCEMENT_RELOAD_TARGETS).then(refreshAnnouncementUi));
});

on('destroy-announcement', (el: HTMLElement) => {
  if (confirm(i18next.t('generic-delete-warning'))) {
    ApiC.delete(`${Model.Announcement}/${el.dataset.id}`)
      .then(() => reloadElements(ANNOUNCEMENT_RELOAD_TARGETS).then(refreshAnnouncementUi));
  }
});

// show the "inside the ZIP, save each entry as" picker only when a zip format is selected
function toggleZipEntityFormat(formatSelectId: string, wrapperId: string): void {
  const formatSelect = document.getElementById(formatSelectId) as HTMLSelectElement;
  const wrapper = document.getElementById(wrapperId);
  if (!formatSelect || !wrapper) {
    return;
  }
  wrapper.hidden = formatSelect.value !== 'zip';
}
document.getElementById('categoryExportFormat')?.addEventListener('change', () => toggleZipEntityFormat('categoryExportFormat', 'categoryExportZipEntityFormat'));
document.getElementById('userExportFormat')?.addEventListener('change', () => toggleZipEntityFormat('userExportFormat', 'userExportZipEntityFormat'));
document.getElementById('folderExportFormat')?.addEventListener('change', () => toggleZipEntityFormat('folderExportFormat', 'folderExportZipEntityFormat'));

on('export-category', () => {
  const source = (document.getElementById('categoryExport') as HTMLSelectElement).value;
  const format = (document.getElementById('categoryExportFormat') as HTMLSelectElement).value;
  let url = `make.php?format=${encodeURIComponent(format)}&category=${encodeURIComponent(source)}&type=items`;
  if (format === 'zip') {
    const entityFormat = (document.getElementById('categoryExportZipEntityFormatSelect') as HTMLSelectElement).value;
    url += `&entity_format=${encodeURIComponent(entityFormat)}`;
  }
  window.location.href = url;
});

on('export-user', () => {
  // the users picker's option values look like "user:5" (see fetchUsers()
  // in misc.ts), so pull the numeric id back out before building the url
  const rawValue = (document.getElementById('userExport_select_users') as HTMLSelectElement).value;
  const userid = rawValue.startsWith('user:') ? rawValue.split(':')[1] : rawValue;
  const type = (document.getElementById('userExportType') as HTMLSelectElement).value;
  let format = (document.getElementById('userExportFormat') as HTMLSelectElement).value;
  if (!userid) {
    notify.error('Pick a user to export first.');
    return;
  }
  const pdfa = (document.getElementById('userExportPdfa') as HTMLInputElement).checked;
  if (pdfa && format === 'pdf') {
    format = 'pdfa';
  } else if (pdfa && format === 'zip') {
    format = 'zipa';
  }
  let url = `make.php?format=${encodeURIComponent(format)}&owner=${encodeURIComponent(userid)}&type=${encodeURIComponent(type)}`;
  if (format === 'zip' || format === 'zipa') {
    const entityFormat = (document.getElementById('userExportZipEntityFormatSelect') as HTMLSelectElement).value;
    url += `&entity_format=${encodeURIComponent(entityFormat)}`;
    if ((document.getElementById('userExportJson') as HTMLInputElement).checked) {
      url += '&json=1';
    }
  }
  if ((document.getElementById('userExportWithChangelog') as HTMLInputElement).checked) {
    url += '&changelog=1';
  }
  window.location.href = url;
});

on('export-folder', () => {
  const folder = (document.getElementById('folderExport') as HTMLSelectElement).value;
  const format = (document.getElementById('folderExportFormat') as HTMLSelectElement).value;
  let url = `make.php?format=${encodeURIComponent(format)}&folder=${encodeURIComponent(folder)}&type=experiments`;
  if (format === 'zip') {
    const entityFormat = (document.getElementById('folderExportZipEntityFormatSelect') as HTMLSelectElement).value;
    url += `&entity_format=${encodeURIComponent(entityFormat)}`;
  }
  window.location.href = url;
});

on('admin-add-tag', () => {
  const tagInput = (document.getElementById('adminAddTagInput') as HTMLInputElement);
  if (!tagInput.value) {
    return;
  }
  ApiC.post(`${Model.Team}/current/${Model.Tag}`, {tag: tagInput.value}).then(() => {
    tagInput.value = '';
    reloadElements(['tagMgrDiv']);
  });
});

if (window.location.pathname === '/admin.php') {
  on('patch-newcomer_banner', () => {
    const params = {};
    params['newcomer_banner'] = tinymce.get('newcomer_banner').getContent();
    ApiC.patch(`${Model.Team}/current`, params);
  });

  on('patch-onboarding-email', () => {
    const key = 'onboarding_email_body';
    ApiC.patch(`${Model.Team}/current`, {
      [key]: tinymce.get(key).getContent(),
    });
  });

  on('open-onboarding-email-modal', () => {
    // reload the modal in case the users of the team have changed
    reloadElements(['sendOnboardingEmailModal'])
      .then(() => $('#sendOnboardingEmailModal').modal('toggle'))
      .then(() => new TomSelect('#sendOnboardingEmailToUsers', {
        plugins: ['dropdown_input', 'no_active_items', 'remove_button'],
      }));
  });

  on('send-onboarding-emails', () => {
    ApiC.patch(`${Model.Team}/current`, {
      action: Action.SendOnboardingEmails,
      notifOnSaved: 0,
      userids: Array.from((document.getElementById('sendOnboardingEmailToUsers') as HTMLSelectElement).selectedOptions)
        .map(option => parseInt(option.value, 10)),
    }).then(response => {
      if (response.ok) {
        notify.success('onboarding-email-sent');
      }
    });
  });

  getEditor().init('admin');

  // edit the team group name
  const malleableGroupname = new Malle({
    cancel : i18next.t('cancel'),
    cancelClasses: ['button', 'btn', 'btn-danger', 'mt-2'],
    inputClasses: ['form-control'],
    formClasses: ['mb-3'],
    fun: async (value, original) => {
      return ApiC.patch(`${Model.Team}/current/${Model.TeamGroup}/${original.dataset.id}`, {name: value})
        .then(resp => resp.json()).then(json => json.name);
    },
    listenOn: '.malleableTeamgroupName',
    returnedValueIsTrustedHtml: false,
    submit : i18next.t('save'),
    submitClasses: ['button', 'btn', 'btn-primary', 'mt-2'],
    tooltip: i18next.t('click-to-edit'),
  }).listen();

  // add an observer so new team groups will get an event handler
  new MutationObserver(() => {
    malleableGroupname.listen();
  }).observe(document.getElementById('team_groups_div'), {childList: true});
}
