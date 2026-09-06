<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import { core } from '../core';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';

  type OrderStatus = 'requested' | 'ordered' | 'received' | 'cancelled';

  type OrderItem = {
    id: number;
    title: string;
    notes: string | null;
    status: OrderStatus;
    created_at: string;
    userid: number;
    author_fullname: string;
    item_id: number | null;
    item_title: string | null;
  };

  type OrderComment = {
    id: number;
    body: string;
    created_at: string;
    userid: number;
    author_fullname: string;
  };

  type ResourceResult = {
    id: number;
    title: string;
  };

  type OrderUpload = {
    id: number;
    real_name: string;
    long_name: string;
    storage: number;
    filesize: number | null;
    created_at: string;
    userid: number;
    author_fullname: string;
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();

  const STATUSES: OrderStatus[] = ['requested', 'ordered', 'received', 'cancelled'];

  function statusLabel(status: OrderStatus): string {
    return {
      requested: t('Requested'),
      ordered: t('Ordered'),
      received: t('Received'),
      cancelled: t('Cancelled'),
    }[status];
  }

  let items: OrderItem[] = [];
  let loading = true;
  let statusFilter: OrderStatus = 'requested';

  let newTitle = '';
  let newNotes = '';
  let submitting = false;

  // resource link on the new-order form: either search an existing one, or
  // create a brand new minimal resource on the fly (title only)
  let resourceQuery = '';
  let resourceResults: ResourceResult[] = [];
  let searchingResource = false;
  let selectedResource: ResourceResult | null = null;
  let creatingNewResource = false;
  let newResourceTitle = '';
  let resourceSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  // editing an existing order: same resource-link idea as the new-order
  // form, but kept in its own state so it never interferes with it
  let editingItemId: number | null = null;
  let editTitle = '';
  let editNotes = '';
  let editResourceQuery = '';
  let editResourceResults: ResourceResult[] = [];
  let editSearchingResource = false;
  let editSelectedResource: ResourceResult | null = null;
  let editCreatingNewResource = false;
  let editNewResourceTitle = '';
  let editResourceSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  let savingEdit = false;

  const COMMENT_PAGE_SIZE = 5;
  let expandedComments = new Set<number>();
  let fullyExpandedComments = new Set<number>();
  let commentsByItem: Record<number, OrderComment[]> = {};
  let commentsLoading = new Set<number>();
  let commentDrafts: Record<number, string> = {};

  let uploadsByItem: Record<number, OrderUpload[]> = {};
  let uploadingItem = new Set<number>();
  let dragOverItem: number | null = null;

  function visibleComments(itemId: number): OrderComment[] {
    const all = commentsByItem[itemId] ?? [];
    return fullyExpandedComments.has(itemId) ? all : all.slice(-COMMENT_PAGE_SIZE);
  }

  function showAllComments(itemId: number): void {
    fullyExpandedComments = new Set(fullyExpandedComments).add(itemId);
  }

  $: visibleItems = items.filter(item => item.status === statusFilter);
  $: requestedCount = items.filter(item => item.status === 'requested').length;
  $: orderedCount = items.filter(item => item.status === 'ordered').length;
  $: receivedCount = items.filter(item => item.status === 'received').length;
  $: cancelledCount = items.filter(item => item.status === 'cancelled').length;

  async function load(): Promise<void> {
    loading = true;
    try {
      items = await ApiC.getJson(Model.Order) as OrderItem[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load the orders board.');
    } finally {
      loading = false;
    }
  }

  function searchResource(): void {
    if (resourceSearchTimeout) clearTimeout(resourceSearchTimeout);
    const query = resourceQuery.trim();
    if (query === '') {
      resourceResults = [];
      return;
    }
    resourceSearchTimeout = setTimeout(async () => {
      searchingResource = true;
      try {
        resourceResults = await ApiC.getJson(`${Model.Item}?fastq=${encodeURIComponent(query)}&limit=8`) as ResourceResult[];
      } catch (error) {
        notify.error(error instanceof Error ? error.message : 'Could not search resources.');
      } finally {
        searchingResource = false;
      }
    }, 250);
  }

  function pickResource(resource: ResourceResult): void {
    selectedResource = resource;
    resourceQuery = '';
    resourceResults = [];
    creatingNewResource = false;
  }

  function clearResource(): void {
    selectedResource = null;
  }

  function toggleCreatingNewResource(): void {
    creatingNewResource = !creatingNewResource;
    if (creatingNewResource) {
      resourceQuery = '';
      resourceResults = [];
    } else {
      newResourceTitle = '';
    }
  }

  async function submitNewItem(): Promise<void> {
    if (newTitle.trim() === '') return;
    submitting = true;
    try {
      let itemId: number | null = selectedResource?.id ?? null;
      if (creatingNewResource && newResourceTitle.trim() !== '') {
        itemId = await ApiC.post2location(Model.Item, { title: newResourceTitle.trim() });
      }
      await ApiC.post(Model.Order, {
        title: newTitle.trim(),
        notes: newNotes.trim() === '' ? null : newNotes.trim(),
        item_id: itemId,
      });
      newTitle = '';
      newNotes = '';
      selectedResource = null;
      creatingNewResource = false;
      newResourceTitle = '';
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post this order.');
    } finally {
      submitting = false;
    }
  }

  function canManage(item: OrderItem): boolean {
    return core.isAdmin || item.userid === core.currentUserid;
  }

  function startEdit(item: OrderItem): void {
    editingItemId = item.id;
    editTitle = item.title;
    editNotes = item.notes ?? '';
    editResourceQuery = '';
    editResourceResults = [];
    editCreatingNewResource = false;
    editNewResourceTitle = '';
    editSelectedResource = item.item_id !== null ? { id: item.item_id, title: item.item_title ?? '' } : null;
  }

  function cancelEdit(): void {
    editingItemId = null;
  }

  function searchEditResource(): void {
    if (editResourceSearchTimeout) clearTimeout(editResourceSearchTimeout);
    const query = editResourceQuery.trim();
    if (query === '') {
      editResourceResults = [];
      return;
    }
    editResourceSearchTimeout = setTimeout(async () => {
      editSearchingResource = true;
      try {
        editResourceResults = await ApiC.getJson(`${Model.Item}?fastq=${encodeURIComponent(query)}&limit=8`) as ResourceResult[];
      } catch (error) {
        notify.error(error instanceof Error ? error.message : 'Could not search resources.');
      } finally {
        editSearchingResource = false;
      }
    }, 250);
  }

  function pickEditResource(resource: ResourceResult): void {
    editSelectedResource = resource;
    editResourceQuery = '';
    editResourceResults = [];
    editCreatingNewResource = false;
  }

  function clearEditResource(): void {
    editSelectedResource = null;
  }

  function toggleEditCreatingNewResource(): void {
    editCreatingNewResource = !editCreatingNewResource;
    if (editCreatingNewResource) {
      editResourceQuery = '';
      editResourceResults = [];
    } else {
      editNewResourceTitle = '';
    }
  }

  async function saveEdit(item: OrderItem): Promise<void> {
    if (editTitle.trim() === '') return;
    savingEdit = true;
    try {
      let itemId: number | null = editSelectedResource?.id ?? null;
      if (editCreatingNewResource && editNewResourceTitle.trim() !== '') {
        itemId = await ApiC.post2location(Model.Item, { title: editNewResourceTitle.trim() });
      }
      await ApiC.patch(`${Model.Order}/${item.id}`, {
        title: editTitle.trim(),
        notes: editNotes.trim() === '' ? null : editNotes.trim(),
        item_id: itemId,
      });
      editingItemId = null;
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save this order.');
    } finally {
      savingEdit = false;
    }
  }

  async function setStatus(item: OrderItem, status: OrderStatus): Promise<void> {
    const previous = item.status;
    item.status = status;
    items = items;
    try {
      await ApiC.patch(`${Model.Order}/${item.id}`, { status });
    } catch (error) {
      item.status = previous;
      items = items;
      notify.error(error instanceof Error ? error.message : 'Could not update this order.');
    }
  }

  async function deleteItem(item: OrderItem): Promise<void> {
    if (!window.confirm(t('Delete this order? This cannot be undone.'))) return;
    try {
      await ApiC.delete(`${Model.Order}/${item.id}`);
      items = items.filter(existing => existing.id !== item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete this order.');
    }
  }

  async function loadComments(itemId: number): Promise<void> {
    commentsLoading = new Set(commentsLoading).add(itemId);
    try {
      commentsByItem[itemId] = await ApiC.getJson(`${Model.Order}/${itemId}/${Model.Comment}`) as OrderComment[];
      commentsByItem = commentsByItem;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load comments.');
    } finally {
      const next = new Set(commentsLoading);
      next.delete(itemId);
      commentsLoading = next;
    }
  }

  async function toggleComments(item: OrderItem): Promise<void> {
    const next = new Set(expandedComments);
    if (next.has(item.id)) {
      next.delete(item.id);
      expandedComments = next;
      return;
    }
    next.add(item.id);
    expandedComments = next;
    if (!uploadsByItem[item.id]) {
      await loadUploads(item.id);
    }
    if (!commentsByItem[item.id]) {
      await loadComments(item.id);
    }
  }

  async function submitComment(item: OrderItem): Promise<void> {
    const text = (commentDrafts[item.id] ?? '').trim();
    if (!text) return;
    try {
      await ApiC.post(`${Model.Order}/${item.id}/${Model.Comment}`, { body: text });
      commentDrafts[item.id] = '';
      commentDrafts = commentDrafts;
      await loadComments(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post this comment.');
    }
  }

  function canDeleteComment(comment: OrderComment): boolean {
    return core.isAdmin || comment.userid === core.currentUserid;
  }

  async function deleteComment(item: OrderItem, comment: OrderComment): Promise<void> {
    if (!window.confirm(t('Delete this comment?'))) return;
    try {
      await ApiC.delete(`${Model.Order}/${item.id}/${Model.Comment}/${comment.id}`);
      await loadComments(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete this comment.');
    }
  }

  async function loadUploads(itemId: number): Promise<void> {
    try {
      uploadsByItem[itemId] = await ApiC.getJson(`${Model.Order}/${itemId}/${Model.Upload}`) as OrderUpload[];
      uploadsByItem = uploadsByItem;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load attachments.');
    }
  }

  async function uploadFile(item: OrderItem, file: File): Promise<void> {
    uploadingItem = new Set(uploadingItem).add(item.id);
    try {
      const formData = new FormData();
      formData.set('file', file);
      await ApiC.post2location(`${Model.Order}/${item.id}/${Model.Upload}`, formData);
      await loadUploads(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not upload this file.');
    } finally {
      const next = new Set(uploadingItem);
      next.delete(item.id);
      uploadingItem = next;
    }
  }

  async function onFileSelected(item: OrderItem, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await uploadFile(item, file);
    input.value = '';
  }

  function onDragOverAttachments(itemId: number, event: DragEvent): void {
    event.preventDefault();
    dragOverItem = itemId;
  }

  function onDragLeaveAttachments(itemId: number): void {
    if (dragOverItem === itemId) dragOverItem = null;
  }

  async function onFileDropped(item: OrderItem, event: DragEvent): Promise<void> {
    event.preventDefault();
    dragOverItem = null;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    await uploadFile(item, file);
  }

  function canDeleteUpload(upload: OrderUpload): boolean {
    return core.isAdmin || upload.userid === core.currentUserid;
  }

  async function deleteUpload(item: OrderItem, upload: OrderUpload): Promise<void> {
    if (!window.confirm(t('Delete this attachment?'))) return;
    try {
      await ApiC.delete(`${Model.Order}/${item.id}/${Model.Upload}/${upload.id}`);
      await loadUploads(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete this attachment.');
    }
  }

  function downloadUrl(upload: OrderUpload): string {
    return `app/download.php?f=${encodeURIComponent(upload.long_name)}&storage=${upload.storage}&name=${encodeURIComponent(upload.real_name)}`;
  }

  function formatFilesize(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
  }

  onMount(() => {
    void load();
  });
</script>

<div class="orders-board">
  <div class="orders-card orders-new-card">
    <form on:submit|preventDefault={submitNewItem}>
      <label class="sr-only" for="ordersNewTitle">{t('Title')}</label>
      <input
        id="ordersNewTitle"
        class="form-control mb-2"
        type="text"
        maxlength="255"
        placeholder={t('What do you need ordered?')}
        bind:value={newTitle}
        required
      />
      <label class="sr-only" for="ordersNewNotes">{t('Notes')}</label>
      <textarea
        id="ordersNewNotes"
        class="form-control mb-2"
        rows="2"
        placeholder={t('Notes (quantity, supplier, link…) — optional')}
        bind:value={newNotes}
      ></textarea>

      <div class="orders-resource-picker mb-2">
        {#if selectedResource}
          <span class="badge badge-info orders-resource-badge">
            <i class="fas fa-box fa-fw mr-1" aria-hidden="true"></i>{selectedResource.title}
            <button type="button" class="btn-unstyled ml-1" title={t('Remove')} aria-label={t('Remove')} on:click={clearResource}>&times;</button>
          </span>
        {:else if creatingNewResource}
          <div class="d-flex align-items-center">
            <input
              class="form-control form-control-sm mr-2"
              type="text"
              maxlength="255"
              placeholder={t('New resource title…')}
              bind:value={newResourceTitle}
            />
            <button type="button" class="btn btn-ghost btn-sm" on:click={toggleCreatingNewResource}>{t('Cancel')}</button>
          </div>
        {:else}
          <div class="orders-resource-search">
            <input
              class="form-control form-control-sm"
              type="text"
              placeholder={t('Link an existing resource… (optional)')}
              bind:value={resourceQuery}
              on:input={searchResource}
            />
            {#if searchingResource}
              <div class="orders-resource-results orders-muted small p-2">{t('Searching')}…</div>
            {:else if resourceResults.length > 0}
              <ul class="orders-resource-results">
                {#each resourceResults as resource (resource.id)}
                  <li>
                    <button type="button" class="btn-unstyled orders-resource-result" on:click={() => pickResource(resource)}>
                      {resource.title}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
          <button type="button" class="btn btn-ghost btn-sm mt-1" on:click={toggleCreatingNewResource}>
            <i class="fas fa-plus fa-fw mr-1" aria-hidden="true"></i>{t('Add a new resource instead')}
          </button>
        {/if}
      </div>

      <div class="d-flex align-items-center flex-wrap">
        <button type="submit" class="btn btn-primary btn-sm" disabled={submitting || newTitle.trim() === ''}>
          <i class="fas fa-cart-plus fa-fw mr-1" aria-hidden="true"></i>{t('Request order')}
        </button>
      </div>
    </form>
  </div>

  <div class="d-flex flex-wrap align-items-center my-3">
    <div class="btn-group btn-group-sm" role="group" aria-label={t('Filter by status')}>
      <button type="button" class={statusFilter === 'requested' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => statusFilter = 'requested'}>
        {t('Requested')}{#if requestedCount > 0}<span class="badge badge-light ml-1">{requestedCount}</span>{/if}
      </button>
      <button type="button" class={statusFilter === 'ordered' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => statusFilter = 'ordered'}>
        {t('Ordered')}{#if orderedCount > 0}<span class="badge badge-light ml-1">{orderedCount}</span>{/if}
      </button>
      <button type="button" class={statusFilter === 'received' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => statusFilter = 'received'}>
        {t('Received')}{#if receivedCount > 0}<span class="badge badge-light ml-1">{receivedCount}</span>{/if}
      </button>
      <button type="button" class={statusFilter === 'cancelled' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => statusFilter = 'cancelled'}>
        {t('Cancelled')}{#if cancelledCount > 0}<span class="badge badge-light ml-1">{cancelledCount}</span>{/if}
      </button>
    </div>
  </div>

  {#if loading}
    <p class="orders-muted">{t('Loading')}…</p>
  {:else if visibleItems.length === 0}
    <p class="orders-muted">{t('No orders here.')}</p>
  {:else}
    <ul class="orders-list">
      {#each visibleItems as item (item.id)}
        <li class="orders-card orders-item">
          <div class="orders-item-body">
            {#if editingItemId === item.id}
              <div class="orders-edit-form">
                <label class="sr-only" for={`ordersEditTitle-${item.id}`}>{t('Title')}</label>
                <input
                  id={`ordersEditTitle-${item.id}`}
                  class="form-control form-control-sm mb-2"
                  type="text"
                  maxlength="255"
                  bind:value={editTitle}
                  required
                />
                <label class="sr-only" for={`ordersEditNotes-${item.id}`}>{t('Notes')}</label>
                <textarea
                  id={`ordersEditNotes-${item.id}`}
                  class="form-control form-control-sm mb-2"
                  rows="2"
                  bind:value={editNotes}
                ></textarea>

                <div class="orders-resource-picker mb-2">
                  {#if editSelectedResource}
                    <span class="badge badge-info orders-resource-badge">
                      <i class="fas fa-box fa-fw mr-1" aria-hidden="true"></i>{editSelectedResource.title}
                      <button type="button" class="btn-unstyled ml-1" title={t('Remove')} aria-label={t('Remove')} on:click={clearEditResource}>&times;</button>
                    </span>
                  {:else if editCreatingNewResource}
                    <div class="d-flex align-items-center">
                      <input
                        class="form-control form-control-sm mr-2"
                        type="text"
                        maxlength="255"
                        placeholder={t('New resource title…')}
                        bind:value={editNewResourceTitle}
                      />
                      <button type="button" class="btn btn-ghost btn-sm" on:click={toggleEditCreatingNewResource}>{t('Cancel')}</button>
                    </div>
                  {:else}
                    <div class="orders-resource-search">
                      <input
                        class="form-control form-control-sm"
                        type="text"
                        placeholder={t('Link an existing resource… (optional)')}
                        bind:value={editResourceQuery}
                        on:input={searchEditResource}
                      />
                      {#if editSearchingResource}
                        <div class="orders-resource-results orders-muted small p-2">{t('Searching')}…</div>
                      {:else if editResourceResults.length > 0}
                        <ul class="orders-resource-results">
                          {#each editResourceResults as resource (resource.id)}
                            <li>
                              <button type="button" class="btn-unstyled orders-resource-result" on:click={() => pickEditResource(resource)}>
                                {resource.title}
                              </button>
                            </li>
                          {/each}
                        </ul>
                      {/if}
                    </div>
                    <button type="button" class="btn btn-ghost btn-sm mt-1" on:click={toggleEditCreatingNewResource}>
                      <i class="fas fa-plus fa-fw mr-1" aria-hidden="true"></i>{t('Add a new resource instead')}
                    </button>
                  {/if}
                </div>

                <div class="d-flex">
                  <button type="button" class="btn btn-primary btn-sm mr-2" disabled={savingEdit || editTitle.trim() === ''} on:click={() => saveEdit(item)}>
                    {t('Save')}
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm" on:click={cancelEdit}>{t('Cancel')}</button>
                </div>
              </div>
            {:else}
              <div class="orders-item-header">
                <span class={`badge ${item.status === 'received' ? 'badge-success' : item.status === 'cancelled' ? 'badge-secondary' : item.status === 'ordered' ? 'badge-info' : 'badge-warning'}`}>
                  {statusLabel(item.status)}
                </span>
                <strong class="orders-item-title">{item.title}</strong>
                {#if item.item_title}
                  <span class="badge badge-info"><i class="fas fa-box fa-fw mr-1" aria-hidden="true"></i>{item.item_title}</span>
                {/if}
                {#if canManage(item)}
                  <div class="orders-item-actions ml-auto">
                    <select
                      class="form-control form-control-sm orders-status-select"
                      value={item.status}
                      on:change={(event) => setStatus(item, (event.target as HTMLSelectElement).value as OrderStatus)}
                      aria-label={t('Status')}
                    >
                      {#each STATUSES as status (status)}
                        <option value={status}>{statusLabel(status)}</option>
                      {/each}
                    </select>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm orders-icon-button"
                      title={t('Edit')}
                      aria-label={t('Edit')}
                      on:click={() => startEdit(item)}
                    >
                      <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-danger-ghost btn-sm orders-icon-button"
                      title={t('Delete')}
                      aria-label={t('Delete')}
                      on:click={() => deleteItem(item)}
                    >
                      <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                    </button>
                  </div>
                {/if}
              </div>
              {#if item.notes}<p class="orders-item-description mb-1">{item.notes}</p>{/if}
              <div class="orders-muted orders-item-meta">
                {t('Requested by')} {item.author_fullname} · {formatDate(item.created_at)}
              </div>
            {/if}
            <button
              type="button"
              class="btn btn-ghost btn-sm orders-comments-toggle mt-1"
              aria-expanded={expandedComments.has(item.id)}
              on:click={() => toggleComments(item)}
            >
              <i class="fas fa-comment fa-fw mr-1" aria-hidden="true"></i>
              {expandedComments.has(item.id)
                ? t('Hide comments')
                : (commentsByItem[item.id] ? `${t('Comments')} (${commentsByItem[item.id].length})` : t('Comments'))}
            </button>
            {#if expandedComments.has(item.id)}
              <div
                class="orders-attachments"
                class:orders-attachments-drag-over={dragOverItem === item.id}
                on:dragover={(event) => onDragOverAttachments(item.id, event)}
                on:dragleave={() => onDragLeaveAttachments(item.id)}
                on:drop={(event) => onFileDropped(item, event)}
              >
                <div class="d-flex align-items-center flex-wrap mb-1">
                  <strong class="orders-attachments-title">{t('Attachments')}</strong>
                  <label class="btn btn-ghost btn-sm ml-2 mb-0" class:disabled={uploadingItem.has(item.id)}>
                    <i class="fas fa-paperclip fa-fw mr-1" aria-hidden="true"></i>
                    {uploadingItem.has(item.id) ? t('Uploading') + '…' : t('Attach file')}
                    <input type="file" class="orders-file-input" on:change={(event) => onFileSelected(item, event)} disabled={uploadingItem.has(item.id)} />
                  </label>
                  <span class="orders-muted small ml-2">{t('or drag a file here')}</span>
                </div>
                {#if (uploadsByItem[item.id] ?? []).length === 0}
                  <p class="orders-muted mb-2">{t('No attachments yet.')}</p>
                {:else}
                  <ul class="orders-upload-list mb-2">
                    {#each uploadsByItem[item.id] as upload (upload.id)}
                      <li class="orders-upload">
                        <i class="fas fa-file fa-fw mr-1" aria-hidden="true"></i>
                        <a href={downloadUrl(upload)} target="_blank" rel="noopener noreferrer">{upload.real_name}</a>
                        <span class="orders-muted ml-1">{formatFilesize(upload.filesize)}</span>
                        {#if canDeleteUpload(upload)}
                          <button
                            type="button"
                            class="btn btn-danger-ghost btn-sm orders-icon-button ml-auto"
                            title={t('Delete')}
                            aria-label={t('Delete')}
                            on:click={() => deleteUpload(item, upload)}
                          >
                            <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                          </button>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <div class="orders-comments">
                {#if commentsLoading.has(item.id)}
                  <p class="orders-muted mb-0">{t('Loading')}…</p>
                {:else}
                  {#if (commentsByItem[item.id] ?? []).length === 0}
                    <p class="orders-muted mb-2">{t('No comments yet.')}</p>
                  {:else}
                    {#if !fullyExpandedComments.has(item.id) && commentsByItem[item.id].length > COMMENT_PAGE_SIZE}
                      <button type="button" class="btn btn-ghost btn-sm mb-2" on:click={() => showAllComments(item.id)}>
                        {t('Show')} {commentsByItem[item.id].length - COMMENT_PAGE_SIZE} {t('earlier comments')}
                      </button>
                    {/if}
                    <ul class="orders-comment-list">
                      {#each visibleComments(item.id) as comment (comment.id)}
                        <li class="orders-comment">
                          <div class="orders-comment-header">
                            <strong>{comment.author_fullname}</strong>
                            <span class="orders-muted">{formatDate(comment.created_at)}</span>
                            {#if canDeleteComment(comment)}
                              <button
                                type="button"
                                class="btn btn-danger-ghost btn-sm orders-icon-button ml-auto"
                                title={t('Delete comment')}
                                aria-label={t('Delete comment')}
                                on:click={() => deleteComment(item, comment)}
                              >
                                <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                              </button>
                            {/if}
                          </div>
                          <p class="mb-0 orders-comment-body">{comment.body}</p>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  <form class="d-flex" on:submit|preventDefault={() => submitComment(item)}>
                    <label class="sr-only" for={`ordersComment-${item.id}`}>{t('Add a comment')}</label>
                    <input
                      id={`ordersComment-${item.id}`}
                      class="form-control form-control-sm mr-2"
                      type="text"
                      maxlength="5000"
                      placeholder={t('Add a comment…')}
                      bind:value={commentDrafts[item.id]}
                    />
                    <button type="submit" class="btn btn-primary btn-sm" disabled={!(commentDrafts[item.id] ?? '').trim()}>
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
  /* Mirrors FeedbackBoard.svelte's styling approach: explicit background +
     border cards using the app's own real tokens/button classes, so this
     looks and themes exactly like the rest of eLabFTW, light or dark. */
  .orders-board {
    max-width: 46rem;
  }

  .orders-card {
    background: var(--mainbackground);
    border: 1px solid var(--secondary);
    border-radius: 0.5rem;
  }

  .orders-new-card {
    padding: 0.85rem;
  }

  .orders-muted {
    color: var(--secondary);
  }

  .orders-resource-search {
    position: relative;
  }

  .orders-resource-results {
    background: var(--mainbackground);
    border: 1px solid var(--secondary);
    border-radius: 0.35rem;
    left: 0;
    list-style: none;
    margin: 0.2rem 0 0;
    max-height: 12rem;
    overflow-y: auto;
    padding: 0;
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 5;
  }

  .orders-resource-result {
    display: block;
    padding: 0.4rem 0.6rem;
    text-align: left;
    width: 100%;
  }

  .orders-resource-result:hover {
    background: var(--hover-bg, rgba(128, 128, 128, 0.15));
  }

  .orders-resource-badge {
    align-items: center;
    display: inline-flex;
  }

  .orders-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .orders-item {
    padding: 0.7rem;
  }

  .orders-item-header {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .orders-item-title {
    overflow-wrap: anywhere;
  }

  .orders-item-actions {
    align-items: center;
    display: flex;
    gap: 0.3rem;
  }

  .orders-status-select {
    width: auto;
  }

  .orders-icon-button {
    padding: 0.15rem 0.4rem;
  }

  .orders-item-description {
    margin: 0.35rem 0 0.2rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .orders-item-meta {
    font-size: 0.78rem;
  }

  .orders-comments-toggle {
    font-weight: normal;
  }

  .orders-comments {
    border-top: 1px solid var(--secondary);
    margin-top: 0.5rem;
    padding-top: 0.5rem;
  }

  .orders-attachments {
    border: 1px dashed transparent;
    border-radius: 0.35rem;
    padding: 0.2rem;
  }

  .orders-attachments-drag-over {
    background: rgba(var(--primary-rgb, 0, 123, 255), 0.08);
    border-color: var(--primary);
  }

  .orders-attachments-title {
    font-size: 0.85rem;
  }

  .orders-file-input {
    height: 0.1px;
    opacity: 0;
    position: absolute;
    width: 0.1px;
  }

  .orders-upload-list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .orders-upload {
    align-items: center;
    display: flex;
    font-size: 0.85rem;
  }

  .orders-comment-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
  }

  .orders-comment {
    border-left: 2px solid var(--secondary);
    padding-left: 0.5rem;
  }

  .orders-comment-header {
    align-items: center;
    display: flex;
    font-size: 0.78rem;
    gap: 0.4rem;
  }

  .orders-comment-body {
    font-size: 0.85rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
</style>
