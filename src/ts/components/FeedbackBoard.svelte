<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import { core } from '../core';
  import i18next from '../i18n';
  import { Action, Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';

  type FeedbackType = 'bug' | 'feature';

  type FeedbackItem = {
    id: number;
    type: FeedbackType;
    title: string;
    body: string | null;
    status: 'open' | 'planned' | 'done' | 'declined';
    created_at: string;
    userid: number;
    author_fullname: string;
    vote_count: number;
    has_voted: boolean;
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();

  let items: FeedbackItem[] = [];
  let loading = true;
  let typeFilter: 'all' | FeedbackType = 'all';
  // finished items stay in the list (nothing is lost) but are hidden from
  // the default view, matching how the type filter narrows what's shown
  let showFinished = false;
  let newType: FeedbackType = 'feature';
  let newTitle = '';
  let newBody = '';
  let submitting = false;

  $: visibleItems = items
    .filter(item => showFinished ? item.status === 'done' : item.status !== 'done')
    .filter(item => typeFilter === 'all' || item.type === typeFilter);
  $: finishedCount = items.filter(item => item.status === 'done').length;

  async function load(): Promise<void> {
    loading = true;
    try {
      items = await ApiC.getJson(Model.Feedback) as FeedbackItem[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load the feedback board.');
    } finally {
      loading = false;
    }
  }

  async function submitNewItem(): Promise<void> {
    if (newTitle.trim() === '') return;
    submitting = true;
    try {
      await ApiC.post(Model.Feedback, {
        type: newType,
        title: newTitle.trim(),
        body: newBody.trim() === '' ? null : newBody.trim(),
      });
      newTitle = '';
      newBody = '';
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post this item.');
    } finally {
      submitting = false;
    }
  }

  async function toggleVote(item: FeedbackItem): Promise<void> {
    // optimistic update so the click feels immediate
    const previous = { count: item.vote_count, voted: item.has_voted };
    item.has_voted = !item.has_voted;
    item.vote_count += item.has_voted ? 1 : -1;
    items = items;
    try {
      await ApiC.patch(`${Model.Feedback}/${item.id}`, { action: Action.ToggleVote });
    } catch (error) {
      item.vote_count = previous.count;
      item.has_voted = previous.voted;
      items = items;
      notify.error(error instanceof Error ? error.message : 'Could not register your vote.');
    }
  }

  // same rule for both: the author and any team admin can manage an item,
  // everyone else can only vote on it
  function canManage(item: FeedbackItem): boolean {
    return core.isAdmin || item.userid === core.currentUserid;
  }

  async function toggleFinished(item: FeedbackItem): Promise<void> {
    const nextStatus = item.status === 'done' ? 'open' : 'done';
    try {
      await ApiC.patch(`${Model.Feedback}/${item.id}`, { status: nextStatus });
      item.status = nextStatus;
      items = items;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update this item.');
    }
  }

  async function deleteItem(item: FeedbackItem): Promise<void> {
    if (!window.confirm(t('Delete this feedback item? This cannot be undone.'))) return;
    try {
      await ApiC.delete(`${Model.Feedback}/${item.id}`);
      items = items.filter(existing => existing.id !== item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete this item.');
    }
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
  }

  onMount(() => {
    void load();
  });
</script>

<div class='feedback-board'>
  <div class='feedback-card feedback-new-card'>
    <form on:submit|preventDefault={submitNewItem}>
      <div class='feedback-toggle-group' role='group' aria-label={t('Type')}>
        <button
          type='button'
          class:active={newType === 'feature'}
          class='feedback-toggle-btn'
          aria-pressed={newType === 'feature'}
          on:click={() => newType = 'feature'}
        >
          <i class='fas fa-star fa-fw mr-1' aria-hidden='true'></i>{t('Feature')}
        </button>
        <button
          type='button'
          class:active={newType === 'bug'}
          class='feedback-toggle-btn'
          aria-pressed={newType === 'bug'}
          on:click={() => newType = 'bug'}
        >
          <i class='fas fa-bug fa-fw mr-1' aria-hidden='true'></i>{t('Bug')}
        </button>
      </div>
      <label class='sr-only' for='feedbackNewTitle'>{t('Title')}</label>
      <input
        id='feedbackNewTitle'
        class='form-control feedback-input mb-2'
        type='text'
        maxlength='255'
        placeholder={t('Short summary…')}
        bind:value={newTitle}
        required
      />
      <label class='sr-only' for='feedbackNewBody'>{t('Description')}</label>
      <textarea
        id='feedbackNewBody'
        class='form-control feedback-input mb-2'
        rows='2'
        placeholder={t('More details (optional)')}
        bind:value={newBody}
      ></textarea>
      <div class='d-flex align-items-center flex-wrap'>
        <button type='submit' class='btn btn-primary btn-sm' disabled={submitting || newTitle.trim() === ''}>
          <i class='fas fa-plus fa-fw mr-1' aria-hidden='true'></i>{t('Post')}
        </button>
        <span class='feedback-hint ml-2'>
          {t('Anyone on the team can post and vote. You can delete your own posts; admins can delete any post.')}
        </span>
      </div>
    </form>
  </div>

  <div class='d-flex flex-wrap align-items-center my-3'>
    <div class='feedback-toggle-group mr-2' role='group' aria-label={t('Filter by type')}>
      <button type='button' class:active={typeFilter === 'all'} class='feedback-toggle-btn' on:click={() => typeFilter = 'all'}>{t('All')}</button>
      <button type='button' class:active={typeFilter === 'feature'} class='feedback-toggle-btn' on:click={() => typeFilter = 'feature'}>
        <i class='fas fa-star fa-fw mr-1' aria-hidden='true'></i>{t('Features')}
      </button>
      <button type='button' class:active={typeFilter === 'bug'} class='feedback-toggle-btn' on:click={() => typeFilter = 'bug'}>
        <i class='fas fa-bug fa-fw mr-1' aria-hidden='true'></i>{t('Bugs')}
      </button>
    </div>
    <button type='button' class:active={showFinished} class='feedback-toggle-btn' on:click={() => showFinished = !showFinished}>
      <i class='fas fa-check fa-fw mr-1' aria-hidden='true'></i>{t('Finished')}
      {#if finishedCount > 0}<span class='badge badge-light ml-1'>{finishedCount}</span>{/if}
    </button>
  </div>

  {#if loading}
    <p class='feedback-muted'>{t('Loading')}…</p>
  {:else if visibleItems.length === 0}
    <p class='feedback-muted'>{t('No feedback items yet. Be the first to post one!')}</p>
  {:else}
    <ul class='feedback-list'>
      {#each visibleItems as item (item.id)}
        <li class='feedback-card feedback-item'>
          <button
            type='button'
            class:voted={item.has_voted}
            class='feedback-vote-button'
            aria-pressed={item.has_voted}
            title={item.has_voted ? t('Remove your vote') : t('Upvote')}
            on:click={() => toggleVote(item)}
          >
            <i class='fas fa-caret-up' aria-hidden='true'></i>
            <span>{item.vote_count}</span>
          </button>
          <div class='feedback-item-body'>
            <div class='feedback-item-header'>
              <span class={`badge ${item.type === 'bug' ? 'badge-danger' : 'badge-info'}`}>
                <i class={`fas ${item.type === 'bug' ? 'fa-bug' : 'fa-star'} fa-fw mr-1`} aria-hidden='true'></i>{item.type === 'bug' ? t('Bug') : t('Feature')}
              </span>
              {#if item.status === 'done'}
                <span class='badge badge-secondary ml-1'><i class='fas fa-check fa-fw mr-1' aria-hidden='true'></i>{t('Finished')}</span>
              {:else if item.status !== 'open'}
                <span class='badge badge-secondary ml-1'>{item.status}</span>
              {/if}
              <strong class='feedback-item-title'>{item.title}</strong>
              {#if canManage(item)}
                <div class='feedback-item-actions ml-auto'>
                  <button
                    type='button'
                    class='feedback-action-button'
                    title={item.status === 'done' ? t('Reopen') : t('Mark as finished')}
                    aria-label={item.status === 'done' ? t('Reopen') : t('Mark as finished')}
                    on:click={() => toggleFinished(item)}
                  >
                    <i class={`fas ${item.status === 'done' ? 'fa-rotate-left' : 'fa-check'} fa-fw`} aria-hidden='true'></i>
                  </button>
                  <button
                    type='button'
                    class='feedback-action-button feedback-delete-button'
                    title={core.isAdmin && item.userid !== core.currentUserid ? t('Delete (team admin)') : t('Delete your post')}
                    aria-label={t('Delete')}
                    on:click={() => deleteItem(item)}
                  >
                    <i class='fas fa-trash fa-fw' aria-hidden='true'></i>
                  </button>
                </div>
              {/if}
            </div>
            {#if item.body}<p class='feedback-item-description mb-1'>{item.body}</p>{/if}
            <div class='feedback-muted feedback-item-meta'>
              {t('Posted by')} {item.author_fullname} · {formatDate(item.created_at)}
            </div>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Every color below is spelled out explicitly (background AND matching
     text color together) instead of relying on inherited/global styles --
     this page sits in the main content area, not a dark sidebar, and a few
     app-wide rules (e.g. .text-muted) assume a chrome/sidebar context that
     doesn't apply here. --white/--mediumstrong/--thirdlevel/--primary are
     the same theme-aware tokens Bootstrap cards already use in this app, so
     this still follows the user's light/dark theme choice correctly. */
  .feedback-board {
    max-width: 46rem;
  }

  .feedback-card {
    background: var(--white);
    border: 1px solid var(--thirdlevel);
    border-radius: 0.4rem;
    color: var(--mediumstrong);
  }

  .feedback-new-card {
    padding: 0.85rem;
  }

  .feedback-input {
    background: var(--white);
    border-color: var(--thirdlevel);
    color: var(--mediumstrong);
  }

  .feedback-hint {
    color: var(--thirdlevel);
    font-size: 0.78rem;
  }

  .feedback-toggle-group {
    display: inline-flex;
    gap: 0.3rem;
  }

  .feedback-toggle-btn {
    background: var(--white);
    border: 1px solid var(--thirdlevel);
    border-radius: 0.3rem;
    color: var(--mediumstrong);
    font-size: 0.82rem;
    padding: 0.28rem 0.6rem;
  }

  .feedback-toggle-btn:hover {
    background: color-mix(in srgb, var(--primary) 12%, var(--white));
  }

  .feedback-toggle-btn.active {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-fg, #fff);
  }

  .feedback-muted {
    color: var(--thirdlevel);
  }

  .feedback-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .feedback-item {
    display: flex;
    gap: 0.75rem;
    padding: 0.7rem;
  }

  .feedback-vote-button {
    align-items: center;
    background: var(--white);
    border: 1px solid var(--thirdlevel);
    border-radius: 0.4rem;
    color: var(--mediumstrong);
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    font-size: 0.85rem;
    font-weight: 700;
    height: 3.1rem;
    justify-content: center;
    line-height: 1;
    width: 3.1rem;
  }

  .feedback-vote-button:hover {
    background: color-mix(in srgb, var(--primary) 12%, var(--white));
  }

  .feedback-vote-button.voted {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-fg, #fff);
  }

  .feedback-vote-button i {
    font-size: 1rem;
  }

  .feedback-item-body {
    min-width: 0;
  }

  .feedback-item-header {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .feedback-item-title {
    overflow-wrap: anywhere;
  }

  .feedback-item-actions {
    display: flex;
    gap: 0.2rem;
  }

  .feedback-action-button {
    background: transparent;
    border: 0;
    color: var(--mediumstrong);
    padding: 0.1rem 0.35rem;
  }

  .feedback-action-button:hover {
    text-decoration: underline;
  }

  .feedback-delete-button {
    color: var(--dangerred, #7b1100);
  }

  .feedback-item-description {
    margin: 0.35rem 0 0.2rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .feedback-item-meta {
    font-size: 0.78rem;
  }
</style>
