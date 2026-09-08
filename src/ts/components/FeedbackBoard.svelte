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

  type FeedbackComment = {
    id: number;
    body: string;
    created_at: string;
    userid: number;
    author_fullname: string;
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

  const COMMENT_PAGE_SIZE = 5;
  let expandedComments = new Set<number>();
  // items whose full comment history is shown, instead of just the latest 5
  let fullyExpandedComments = new Set<number>();

  function visibleComments(itemId: number): FeedbackComment[] {
    const all = commentsByItem[itemId] ?? [];
    return fullyExpandedComments.has(itemId) ? all : all.slice(-COMMENT_PAGE_SIZE);
  }

  function showAllComments(itemId: number): void {
    fullyExpandedComments = new Set(fullyExpandedComments).add(itemId);
  }
  let commentsByItem: Record<number, FeedbackComment[]> = {};
  let commentsLoading = new Set<number>();
  let commentDrafts: Record<number, string> = {};

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

  async function loadComments(itemId: number): Promise<void> {
    commentsLoading = new Set(commentsLoading).add(itemId);
    try {
      commentsByItem[itemId] = await ApiC.getJson(`${Model.Feedback}/${itemId}/${Model.Comment}`) as FeedbackComment[];
      commentsByItem = commentsByItem;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load comments.');
    } finally {
      const next = new Set(commentsLoading);
      next.delete(itemId);
      commentsLoading = next;
    }
  }

  async function toggleComments(item: FeedbackItem): Promise<void> {
    const next = new Set(expandedComments);
    if (next.has(item.id)) {
      next.delete(item.id);
      expandedComments = next;
      return;
    }
    next.add(item.id);
    expandedComments = next;
    if (!commentsByItem[item.id]) {
      await loadComments(item.id);
    }
  }

  async function submitComment(item: FeedbackItem): Promise<void> {
    const text = (commentDrafts[item.id] ?? '').trim();
    if (!text) return;
    try {
      await ApiC.post(`${Model.Feedback}/${item.id}/${Model.Comment}`, { body: text });
      commentDrafts[item.id] = '';
      commentDrafts = commentDrafts;
      await loadComments(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post this comment.');
    }
  }

  function canDeleteComment(comment: FeedbackComment): boolean {
    return core.isAdmin || comment.userid === core.currentUserid;
  }

  async function deleteComment(item: FeedbackItem, comment: FeedbackComment): Promise<void> {
    if (!window.confirm(t('Delete this comment?'))) return;
    try {
      await ApiC.delete(`${Model.Feedback}/${item.id}/${Model.Comment}/${comment.id}`);
      await loadComments(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete this comment.');
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
      <div class='btn-group btn-group-sm' role='group' aria-label={t('Type')}>
        <button
          type='button'
          class={newType === 'feature' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'}
          aria-pressed={newType === 'feature'}
          on:click={() => newType = 'feature'}
        >
          <i class='fas fa-star fa-fw mr-1' aria-hidden='true'></i>{t('Feature')}
        </button>
        <button
          type='button'
          class={newType === 'bug' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'}
          aria-pressed={newType === 'bug'}
          on:click={() => newType = 'bug'}
        >
          <i class='fas fa-bug fa-fw mr-1' aria-hidden='true'></i>{t('Bug')}
        </button>
      </div>
      <label class='sr-only' for='feedbackNewTitle'>{t('Title')}</label>
      <input
        id='feedbackNewTitle'
        class='form-control mt-2 mb-2'
        type='text'
        maxlength='255'
        placeholder={t('Short summary…')}
        bind:value={newTitle}
        required
      />
      <label class='sr-only' for='feedbackNewBody'>{t('Description')}</label>
      <textarea
        id='feedbackNewBody'
        class='form-control mb-2'
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
    <div class='btn-group btn-group-sm mr-2' role='group' aria-label={t('Filter by type')}>
      <button type='button' class={typeFilter === 'all' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => typeFilter = 'all'}>{t('All')}</button>
      <button type='button' class={typeFilter === 'feature' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => typeFilter = 'feature'}>
        <i class='fas fa-star fa-fw mr-1' aria-hidden='true'></i>{t('Features')}
      </button>
      <button type='button' class={typeFilter === 'bug' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => typeFilter = 'bug'}>
        <i class='fas fa-bug fa-fw mr-1' aria-hidden='true'></i>{t('Bugs')}
      </button>
    </div>
    <button type='button' class={showFinished ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => showFinished = !showFinished}>
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
            class={item.has_voted ? 'btn btn-primary feedback-vote-button' : 'btn btn-ghost feedback-vote-button'}
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
                    class='btn btn-ghost btn-sm feedback-icon-button'
                    title={item.status === 'done' ? t('Reopen') : t('Mark as finished')}
                    aria-label={item.status === 'done' ? t('Reopen') : t('Mark as finished')}
                    on:click={() => toggleFinished(item)}
                  >
                    <i class={`fas ${item.status === 'done' ? 'fa-rotate-left' : 'fa-check'} fa-fw`} aria-hidden='true'></i>
                  </button>
                  <button
                    type='button'
                    class='btn btn-danger-ghost btn-sm feedback-icon-button'
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
            <button
              type='button'
              class='btn btn-ghost btn-sm feedback-comments-toggle mt-1'
              aria-expanded={expandedComments.has(item.id)}
              on:click={() => toggleComments(item)}
            >
              <i class='fas fa-comment fa-fw mr-1' aria-hidden='true'></i>
              {expandedComments.has(item.id)
                ? t('Hide comments')
                : (commentsByItem[item.id] ? `${t('Comments')} (${commentsByItem[item.id].length})` : t('Comments'))}
            </button>
            {#if expandedComments.has(item.id)}
              <div class='feedback-comments'>
                {#if commentsLoading.has(item.id)}
                  <p class='feedback-muted mb-0'>{t('Loading')}…</p>
                {:else}
                  {#if (commentsByItem[item.id] ?? []).length === 0}
                    <p class='feedback-muted mb-2'>{t('No comments yet.')}</p>
                  {:else}
                    {#if !fullyExpandedComments.has(item.id) && commentsByItem[item.id].length > COMMENT_PAGE_SIZE}
                      <button type='button' class='btn btn-ghost btn-sm mb-2' on:click={() => showAllComments(item.id)}>
                        {t('Show')} {commentsByItem[item.id].length - COMMENT_PAGE_SIZE} {t('earlier comments')}
                      </button>
                    {/if}
                    <ul class='feedback-comment-list'>
                      {#each visibleComments(item.id) as comment (comment.id)}
                        <li class='feedback-comment'>
                          <div class='feedback-comment-header'>
                            <strong>{comment.author_fullname}</strong>
                            <span class='feedback-muted'>{formatDate(comment.created_at)}</span>
                            {#if canDeleteComment(comment)}
                              <button
                                type='button'
                                class='btn btn-danger-ghost btn-sm feedback-icon-button ml-auto'
                                title={t('Delete comment')}
                                aria-label={t('Delete comment')}
                                on:click={() => deleteComment(item, comment)}
                              >
                                <i class='fas fa-trash fa-fw' aria-hidden='true'></i>
                              </button>
                            {/if}
                          </div>
                          <p class='mb-0 feedback-comment-body'>{comment.body}</p>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  <form class='d-flex' on:submit|preventDefault={() => submitComment(item)}>
                    <label class='sr-only' for={`feedbackComment-${item.id}`}>{t('Add a comment')}</label>
                    <input
                      id={`feedbackComment-${item.id}`}
                      class='form-control form-control-sm mr-2'
                      type='text'
                      maxlength='5000'
                      placeholder={t('Add a comment…')}
                      bind:value={commentDrafts[item.id]}
                    />
                    <button type='submit' class='btn btn-primary btn-sm' disabled={!(commentDrafts[item.id] ?? '').trim()}>
                      {t('Post')}
                    </button>
                  </form>
                {/if}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* Every color below is spelled out explicitly (background AND matching
     text color together) instead of relying on inherited/global styles --
     this page sits in the main content area. Cards use the same background
     as the page itself (var(--mainbackground)) with just a border to set
     them apart, and every button is one of the app's own real button
     classes (btn-primary/btn-secondary/btn-ghost/btn-danger-ghost) so this
     looks and themes exactly like the rest of eLabFTW, light or dark. */
  .feedback-board {
    max-width: 46rem;
  }

  .feedback-card {
    background: var(--mainbackground);
    border: 1px solid var(--secondary);
    border-radius: 0.5rem;
  }

  .feedback-new-card {
    padding: 0.85rem;
  }

  .feedback-hint {
    color: var(--secondary);
    font-size: 0.78rem;
  }

  .feedback-muted {
    color: var(--secondary);
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
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    font-size: 0.85rem;
    height: 3.1rem;
    justify-content: center;
    line-height: 1;
    padding: 0;
    width: 3.1rem;
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
    gap: 0.3rem;
  }

  .feedback-icon-button {
    padding: 0.15rem 0.4rem;
  }

  .feedback-item-description {
    margin: 0.35rem 0 0.2rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .feedback-item-meta {
    font-size: 0.78rem;
  }

  .feedback-comments-toggle {
    font-weight: normal;
  }

  .feedback-comments {
    border-top: 1px solid var(--secondary);
    margin-top: 0.5rem;
    padding-top: 0.5rem;
  }

  .feedback-comment-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
  }

  .feedback-comment {
    border-left: 2px solid var(--secondary);
    padding-left: 0.5rem;
  }

  .feedback-comment-header {
    align-items: center;
    display: flex;
    font-size: 0.78rem;
    gap: 0.4rem;
  }

  .feedback-comment-body {
    font-size: 0.85rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
</style>
