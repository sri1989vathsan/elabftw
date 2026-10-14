/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import { InputType, Malle } from '@deltablot/malle';
import { ApiC } from './api';
import { core } from './core';
import { entity } from './getEntity';
import { on } from './handlers';
import i18next from './i18n';
import { Model } from './interfaces';
import { reloadElements } from './misc';
import { askConfirm } from './confirm-dialog';
import { decorateMentions, initCommentMentions, mentionedUserids } from './comment-mentions';

// Comments of an entry, shared by the view page and the edit page.

// UPDATE MALLEABLE COMMENT
const malleableComments = new Malle({
  cancel : i18next.t('cancel'),
  cancelClasses: ['button', 'btn', 'btn-danger', 'mt-2', 'ml-1'],
  inputClasses: ['form-control'],
  fun: async (value, original) => {
    const resp = await ApiC.patch(`${entity.type}/${entity.id}/${Model.Comment}/${original.dataset.id}`, {'comment': value});
    const json = await resp.json();
    // we reload all so the edition date is also reloaded
    reloadElements(['commentsDiv']).then(refreshComments);
    return json.comment;
  },
  inputType: InputType.Textarea,
  listenOn: '.comment.editable',
  returnedValueIsTrustedHtml: false,
  submit : i18next.t('save'),
  submitClasses: ['button', 'btn', 'btn-primary', 'mt-2'],
  tooltip: i18next.t('click-to-edit'),
});

on('create-comment', () => {
  const content = (document.getElementById('commentsCreateArea') as HTMLTextAreaElement).value;
  ApiC.post(`${entity.type}/${entity.id}/${Model.Comment}`, {comment: content, mentioned_userids: mentionedUserids(content)}).then(() => {
    reloadElements(['commentsDiv']).then(refreshComments);
  });
});

on('destroy-comment', async (el: HTMLElement) => {
  if (await askConfirm(i18next.t('generic-delete-warning'))) {
    ApiC.delete(`${entity.type}/${entity.id}/${Model.Comment}/${el.dataset.id}`).then(() => el.parentElement.parentElement.remove());
  }
});


function refreshComments(): void {
  malleableComments.listen();
  initCommentMentions();
  decorateMentions();
}

if (!core.isAnon && document.getElementById('commentsDiv')) {
  // listen on existing comments
  refreshComments();
}
