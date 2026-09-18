<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import { core } from '../core';
  import i18next from '../i18n';
  import { Action, Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';
  import { applyMention, extractMentionQuery, stripMentionHtml, wrapMentionsAsHtml } from '../mentions';

  // Closes an @mention dropdown on any click outside its own container --
  // it otherwise stays open until a mention is picked, even after
  // clicking elsewhere on the page.
  function clickOutside(node: HTMLElement, onOutsideClick: () => void): { destroy(): void } {
    const handleClick = (event: MouseEvent): void => {
      if (event.target instanceof Node && !node.contains(event.target)) {
        onOutsideClick();
      }
    };
    document.addEventListener('click', handleClick, true);
    return {
      destroy(): void {
        document.removeEventListener('click', handleClick, true);
      },
    };
  }

  type TeamMember = {
    userid: number;
    fullname: string;
  };

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
  let teamMembers: TeamMember[] = [];
  // users @-mentioned in the comment currently being drafted for a given
  // item, and the live autocomplete matches for that item's draft -- keyed
  // per item since several items' comment sections can be open at once
  let commentMentionsByItem: Record<number, TeamMember[]> = {};
  let mentionCandidatesByItem: Record<number, TeamMember[]> = {};
  let editingCommentId: number | null = null;
  let editCommentDraft = '';

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

  let editingItemId: number | null = null;
  let editItemTitle = '';
  let editItemBody = '';

  function startEditItem(item: FeedbackItem): void {
    editingItemId = item.id;
    editItemTitle = item.title;
    editItemBody = item.body ?? '';
  }

  function cancelEditItem(): void {
    editingItemId = null;
  }

  async function saveEditItem(item: FeedbackItem): Promise<void> {
    const title = editItemTitle.trim();
    if (!title) return;
    try {
      const body = editItemBody.trim() === '' ? null : editItemBody.trim();
      await ApiC.patch(`${Model.Feedback}/${item.id}`, { title, body });
      item.title = title;
      item.body = body;
      items = items;
      editingItemId = null;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save this item.');
    }
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

  async function loadTeamMembers(): Promise<void> {
    try {
      teamMembers = await ApiC.getJson('users?currentTeam=1') as TeamMember[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load team members.');
    }
  }

  function onCommentInput(itemId: number): void {
    const query = extractMentionQuery(commentDrafts[itemId] ?? '');
    if (query === null) {
      const next = { ...mentionCandidatesByItem };
      delete next[itemId];
      mentionCandidatesByItem = next;
      return;
    }
    const lower = query.toLowerCase();
    mentionCandidatesByItem = {
      ...mentionCandidatesByItem,
      [itemId]: teamMembers.filter(m => m.fullname.toLowerCase().includes(lower)).slice(0, 5),
    };
  }

  function clearMentionCandidates(itemId: number): void {
    const next = { ...mentionCandidatesByItem };
    delete next[itemId];
    mentionCandidatesByItem = next;
  }

  function pickMention(itemId: number, member: TeamMember): void {
    const query = extractMentionQuery(commentDrafts[itemId] ?? '') ?? '';
    commentDrafts[itemId] = applyMention(commentDrafts[itemId] ?? '', query, member.fullname);
    commentDrafts = commentDrafts;
    const existing = commentMentionsByItem[itemId] ?? [];
    if (!existing.some(m => m.userid === member.userid)) {
      commentMentionsByItem = { ...commentMentionsByItem, [itemId]: [...existing, member] };
    }
    clearMentionCandidates(itemId);
  }

  async function submitComment(item: FeedbackItem): Promise<void> {
    const text = (commentDrafts[item.id] ?? '').trim();
    if (!text) return;
    try {
      const mentioned = commentMentionsByItem[item.id] ?? [];
      const mentionedUserids = mentioned.filter(m => text.includes(`@${m.fullname}`)).map(m => m.userid);
      const htmlBody = wrapMentionsAsHtml(text, teamMembers);
      await ApiC.post(`${Model.Feedback}/${item.id}/${Model.Comment}`, { body: htmlBody, mentioned_userids: mentionedUserids });
      commentDrafts[item.id] = '';
      commentDrafts = commentDrafts;
      const next = { ...commentMentionsByItem };
      delete next[item.id];
      commentMentionsByItem = next;
      await loadComments(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post this comment.');
    }
  }

  function canManageComment(comment: FeedbackComment): boolean {
    return core.isAdmin || comment.userid === core.currentUserid;
  }

  function startEditComment(comment: FeedbackComment): void {
    editingCommentId = comment.id;
    editCommentDraft = stripMentionHtml(comment.body);
  }

  function cancelEditComment(): void {
    editingCommentId = null;
  }

  async function saveEditComment(item: FeedbackItem, comment: FeedbackComment): Promise<void> {
    const text = editCommentDraft.trim();
    if (!text) return;
    try {
      const body = wrapMentionsAsHtml(text, teamMembers);
      await ApiC.patch(`${Model.Feedback}/${item.id}/${Model.Comment}/${comment.id}`, { body });
      editingCommentId = null;
      await loadComments(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save this comment.');
    }
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
    void loadTeamMembers();
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
              {#if editingItemId !== item.id}<strong class='feedback-item-title'>{item.title}</strong>{/if}
              {#if canManage(item)}
                <div class='feedback-item-actions ml-auto'>
                  {#if editingItemId !== item.id}
                    <button
                      type='button'
                      class='btn btn-ghost btn-sm feedback-icon-button'
                      title={t('Edit')}
                      aria-label={t('Edit')}
                      on:click={() => startEditItem(item)}
                    >
                      <i class='fas fa-pen fa-fw' aria-hidden='true'></i>
                    </button>
                  {/if}
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
            {#if editingItemId === item.id}
              <form class='feedback-edit-item-form mt-1' on:submit|preventDefault={() => saveEditItem(item)}>
                <label class='sr-only' for={`feedbackEditTitle-${item.id}`}>{t('Title')}</label>
                <input
                  id={`feedbackEditTitle-${item.id}`}
                  class='form-control form-control-sm mb-1'
                  type='text'
                  maxlength='255'
                  bind:value={editItemTitle}
                  required
                />
                <label class='sr-only' for={`feedbackEditBody-${item.id}`}>{t('Description')}</label>
                <textarea
                  id={`feedbackEditBody-${item.id}`}
                  class='form-control form-control-sm mb-1'
                  rows='2'
                  bind:value={editItemBody}
                ></textarea>
                <div class='d-flex'>
                  <button type='submit' class='btn btn-primary btn-sm' disabled={editItemTitle.trim() === ''}>{t('Save')}</button>
                  <button type='button' class='btn btn-ghost btn-sm ml-2' on:click={cancelEditItem}>{t('Cancel')}</button>
                </div>
              </form>
            {:else}
              {#if item.body}<p class='feedback-item-description mb-1'>{item.body}</p>{/if}
            {/if}
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
                            {#if canManageComment(comment)}
                              <div class='pm-item-actions ml-auto'>
                                <button
                                  type='button'
                                  class='btn btn-ghost btn-sm feedback-icon-button'
                                  title={t('Edit')}
                                  aria-label={t('Edit')}
                                  on:click={() => startEditComment(comment)}
                                >
                                  <i class='fas fa-pen fa-fw' aria-hidden='true'></i>
                                </button>
                                <button
                                  type='button'
                                  class='btn btn-danger-ghost btn-sm feedback-icon-button'
                                  title={t('Delete comment')}
                                  aria-label={t('Delete comment')}
                                  on:click={() => deleteComment(item, comment)}
                                >
                                  <i class='fas fa-trash fa-fw' aria-hidden='true'></i>
                                </button>
                              </div>
                            {/if}
                          </div>
                          {#if editingCommentId === comment.id}
                            <div class='d-flex'>
                              <input
                                type='text'
                                class='form-control form-control-sm mr-2'
                                maxlength='5000'
                                bind:value={editCommentDraft}
                                on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveEditComment(item, comment); } }}
                              />
                              <button type='button' class='btn btn-primary btn-sm mr-1' disabled={!editCommentDraft.trim()} on:click={() => saveEditComment(item, comment)}>{t('Save')}</button>
                              <button type='button' class='btn btn-ghost btn-sm' on:click={cancelEditComment}>{t('Cancel')}</button>
                            </div>
                            {#if wrapMentionsAsHtml(editCommentDraft, teamMembers).includes('elabftw-mention')}
                              <div class='pm-mention-preview small pm-muted mt-1'>{@html wrapMentionsAsHtml(editCommentDraft, teamMembers)}</div>
                            {/if}
                          {:else}
                            <p class='mb-0 feedback-comment-body'>{@html comment.body}</p>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  <div use:clickOutside={() => clearMentionCandidates(item.id)}>
                    <form class='d-flex pm-comment-form' on:submit|preventDefault={() => submitComment(item)}>
                      <label class='sr-only' for={`feedbackComment-${item.id}`}>{t('Add a comment')}</label>
                      <input
                        id={`feedbackComment-${item.id}`}
                        class='form-control form-control-sm mr-2'
                        type='text'
                        maxlength='5000'
                        placeholder={t('Add a comment… (type @ to mention someone)')}
                        bind:value={commentDrafts[item.id]}
                        on:input={() => onCommentInput(item.id)}
                      />
                      {#if (mentionCandidatesByItem[item.id] ?? []).length > 0}
                        <ul class='pm-mention-results'>
                          {#each mentionCandidatesByItem[item.id] as member (member.userid)}
                            <li>
                              <button type='button' class='btn-unstyled pm-mention-result' on:click={() => pickMention(item.id, member)}>
                                {member.fullname}
                              </button>
                            </li>
                          {/each}
                        </ul>
                      {/if}
                      <button type='submit' class='btn btn-primary btn-sm' disabled={!(commentDrafts[item.id] ?? '').trim()}>
                        {t('Post')}
                      </button>
                    </form>
                    {#if wrapMentionsAsHtml(commentDrafts[item.id] ?? '', teamMembers).includes('elabftw-mention')}
                      <div class='pm-mention-preview small pm-muted mt-1'>{@html wrapMentionsAsHtml(commentDrafts[item.id] ?? '', teamMembers)}</div>
                    {/if}
                  </div>
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
