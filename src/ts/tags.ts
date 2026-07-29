/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import 'jquery-ui/ui/widgets/autocomplete';
import $ from 'jquery';
import { Malle } from '@deltablot/malle';
import FavTag from './FavTag.class';
import i18next from './i18n';
import { addAutocompleteToTagInputs, reloadElements } from './misc';
import { Action, Model } from './interfaces';
import { ApiC } from './api';
import { entity } from './getEntity';

// CREATE TAG FUNCTION
const createTag = (el: HTMLInputElement): void => {
  if (!el.value) {
    return;
  }
  ApiC.post(`${entity.type}/${entity.id}/${Model.Tag}`, {tag: el.value}).then(() => {
    // instead of reloading the full "tags div", reload only parts which contains tags
    // so we don't need to reload the input (and need to re-apply listeners)
    reloadElements([`tags_div_currenttags_${entity.id}`, `tags_div_suggestedtags_${entity.id}`]);
    el.value = '';
  });
};

document.addEventListener('DOMContentLoaded', () => {
  // START CREATE TAG
  if (document.querySelector('.createTagInput')) {
    document.querySelector('.createTagInput').addEventListener('blur', event => {
      createTag(event.target as HTMLInputElement);
    });
    document.querySelector('.createTagInput').addEventListener('keyup', event => {
      if ((event as KeyboardEvent).code === 'Enter') {
        createTag(event.target as HTMLInputElement);
      }
    });
  }
  // END CREATE TAG

  // CREATE FAVORITE TAG
  let favoriteTagIsSaving = false;
  const createTagFavorite = (el: HTMLInputElement): void => {
    const tag = el.value.trim();
    if (!tag || favoriteTagIsSaving) {
      return;
    }
    favoriteTagIsSaving = true;
    (new FavTag()).create(tag).then(() => {
      reloadElements(['favtagsTagsDiv']);
      el.value = '';
    }).finally(() => {
      favoriteTagIsSaving = false;
    });
  };

  const favoriteTagInput = document.getElementById('createFavTagInput') as HTMLInputElement | null;
  if (favoriteTagInput) {
    document.getElementById('createFavTagButton')?.addEventListener('click', () => {
      createTagFavorite(favoriteTagInput);
    });
    favoriteTagInput.addEventListener('keyup', event => {
      if ((event as KeyboardEvent).code === 'Enter') {
        createTagFavorite(favoriteTagInput);
      }
    });
  }
  // END CREATE FAVORITE TAG

  // AUTOCOMPLETE
  addAutocompleteToTagInputs();
  if (favoriteTagInput) {
    $(favoriteTagInput).on('autocompleteselect', (event, ui) => {
      event.preventDefault();
      favoriteTagInput.value = ui.item.value;
      createTagFavorite(favoriteTagInput);
    });
  }
  const favoritesPanel = document.getElementById('favoritesPanel');
  if (favoritesPanel) {
    new MutationObserver(mutations => {
      const hasNewTagInput = mutations.some(mutation => (
        Array.from(mutation.addedNodes).some(node => (
          node instanceof Element
          && (
            node.matches('[data-autocomplete="tags"]')
            || node.querySelector('[data-autocomplete="tags"]') !== null
          )
        ))
      ));
      if (hasNewTagInput) {
        addAutocompleteToTagInputs();
      }
    }).observe(favoritesPanel, {childList: true, subtree: true});
  }

  // make the tag editable (on admin page)
  const malleableTags = new Malle({
    cancel : i18next.t('cancel'),
    cancelClasses: ['button', 'btn', 'btn-danger', 'ml-1'],
    inputClasses: ['form-control'],
    formClasses: ['d-inline-flex'],
    fun: async (value, original) => {
      const resp = await ApiC.patch(`${Model.Team}/current/${Model.Tag}/${original.dataset.id}`, {'action': Action.UpdateTag, 'tag': value});
      const json = await resp.json();
      // the response contains all the tags, so we need to find the correct one to display the updated value
      const tag = json.find((tag: Record<string, string|number>) => tag.id === parseInt(original.dataset.id, 10));
      if (!tag) {
        document.querySelector(`tr[data-id="${original.dataset.id}"]`).remove();
        return '';
      }
      return tag?.tag;
    },
    listenOn: '.tag.editable',
    returnedValueIsTrustedHtml: false,
    tooltip: i18next.t('click-to-edit'),
    submit : i18next.t('save'),
    submitClasses: ['button', 'btn', 'btn-primary', 'ml-1'],
  }).listen();

  if (document.getElementById('tagMgrDiv')) {
    new MutationObserver(() => {
      malleableTags.listen();
    }).observe(document.getElementById('tagMgrDiv'), {childList: true});
  }

  // MAIN ACTION LISTENER
  document.querySelector('.real-container').addEventListener('click', event => {
    const el = (event.target as HTMLElement);
    // UNREFERENCE (remove link between tag and entity)
    if (el.matches('[data-action="unreference-tag"]')) {
      if (confirm(i18next.t('tag-delete-warning'))) {
        ApiC.patch(`${entity.type}/${entity.id}/${Model.Tag}/${el.dataset.tagid}`, {'action': Action.Unreference}).then(() => reloadElements([`tags_div_currenttags_${entity.id}`, `tags_div_suggestedtags_${entity.id}`]));
      }
    // ADD SUGGESTED TAGS
    } else if (el.matches('[data-action="add-suggested-tag"]')) {
      ApiC.post(`${entity.type}/${entity.id}/${Model.Tag}/${el.dataset.tagid}`, {'action': Action.Add, 'tag': el.innerText}).then(() => reloadElements([`tags_div_currenttags_${entity.id}`, `tags_div_suggestedtags_${entity.id}`]));
    // DESTROY (from admin panel/tag manager)
    } else if (el.matches('[data-action="destroy-tag"]')) {
      if (confirm(i18next.t('tag-delete-warning'))) {
        ApiC.delete(`${Model.Team}/current/${Model.Tag}/${el.dataset.tagid}`).then(() => el.parentElement.parentElement.remove());
      }
    }
  });
});
