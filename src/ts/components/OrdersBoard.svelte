<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ApiC } from '../api';
  import { core } from '../core';
  import i18next from '../i18n';
  import { EntityType, Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';
  import { applyMention, extractMentionQuery, wrapMentionsAsHtml, stripMentionHtml } from '../mentions';
  import { handleLinkPreviewPaste } from '../linkPreview';

  // Closes a results dropdown on any click outside its own container --
  // none of the search-result/mention dropdowns below had this, so they
  // stayed open until a result was picked, even after clicking elsewhere
  // on the page.
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

  type OrderStatus = 'requested' | 'ordered' | 'received' | 'cancelled' | 'reference';

  type TeamMember = {
    userid: number;
    fullname: string;
  };

  type LinkedItem = {
    id: number;
    title: string;
  };

  type OrderItem = {
    id: number;
    title: string;
    notes: string | null;
    procurement_id: string | null;
    order_number: string | null;
    status: OrderStatus;
    archived: boolean;
    pinned: boolean;
    created_at: string;
    userid: number;
    author_fullname: string;
    items: LinkedItem[];
    uploads: OrderUpload[];
  };

  type Category = {
    id: number;
    title: string;
  };

  type ResourceTemplate = {
    id: number;
    title: string;
  };

  type PendingResource = {
    title: string;
    category: number | null;
    // when set, the new resource is created from this template instead of
    // blank -- category is ignored in that case (the template supplies one)
    template: number | null;
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
    has_extracted_text: boolean;
    // PDF text extraction runs in the background after upload (see
    // OrderUploads::extractOne()) -- 'none' for non-PDFs, 'pending' until
    // the async job runs, then 'done'/'failed'
    extraction_status: 'none' | 'pending' | 'done' | 'failed';
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
      reference: t('Reference'),
    }[status];
  }

  let items: OrderItem[] = [];
  let loading = true;
  let statusFilter: OrderStatus | 'archived' | 'all' = 'requested';
  let ownerFilter: 'mine' | 'all' = 'all';
  let selectedUserId: number | null = null;
  let searchQuery = '';
  // off by default: matching PDF-extracted text needs a per-order subquery
  // against potentially large attachment text, so only pay for it when the
  // user actually wants it
  let searchPdf = false;
  let dateFrom = '';
  let dateTo = '';
  let selectedIds = new Set<number>();

  // pagination: the server is asked for pageSize+1 rows so hasNextPage can
  // be known without a separate COUNT query
  const PAGE_SIZES = [5, 10];
  let pageSize = 10;
  let pageOffset = 0;
  let hasNextPage = false;

  let newTitle = '';
  // notes is a rich-text (contenteditable) field, not a bound string, so a
  // pasted bare URL can render as a link-preview badge like it already does
  // in Todolist's notes/description -- read via newNotesEl.innerHTML at
  // submit time instead
  let newNotesEl: HTMLElement;
  let newFiles: File[] = [];
  let newIsReference = false;
  let submitting = false;

  let categories: Category[] = [];
  let templates: ResourceTemplate[] = [];

  // resources linked on the new-order form: any number of existing
  // resources (searched and picked), plus any number of brand new ones
  // created on the fly (title + optional category)
  let resourceQuery = '';
  let resourceResults: ResourceResult[] = [];
  let searchingResource = false;
  let selectedResources: ResourceResult[] = [];
  let pendingNewResources: PendingResource[] = [];
  let resourceSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  // editing an existing order: same resource-link idea as the new-order
  // form, but kept in its own state so it never interferes with it
  let editingItemId: number | null = null;
  let editTitle = '';
  // same rich-text approach as newNotesEl: editNotesInitial only seeds the
  // contenteditable's starting content, the live value is read from
  // editNotesEl.innerHTML when saving
  let editNotesInitial = '';
  let editNotesEl: HTMLElement;
  let editResourceQuery = '';
  let editResourceResults: ResourceResult[] = [];
  let editSearchingResource = false;
  let editSelectedResources: ResourceResult[] = [];
  let editPendingNewResources: PendingResource[] = [];
  let editResourceSearchTimeout: ReturnType<typeof setTimeout> | null = null;
  let savingEdit = false;

  const COMMENT_PAGE_SIZE = 5;
  let expandedComments = new Set<number>();
  let fullyExpandedComments = new Set<number>();
  let commentsByItem: Record<number, OrderComment[]> = {};
  let commentsLoading = new Set<number>();
  let commentDrafts: Record<number, string> = {};
  let teamMembers: TeamMember[] = [];
  // users @-mentioned in the comment currently being drafted, and the
  // dropdown of matching team members while typing "@something"
  let commentMentions: Record<number, TeamMember[]> = {};
  let mentionCandidates: Record<number, TeamMember[]> = {};

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

  // status/owner/search filtering and pagination all happen server-side,
  // so results stay correct (and fast) regardless of how many orders exist
  // or which page a match happens to be on -- items is already exactly
  // what should be shown.
  $: visibleItems = items;
  // pinned orders get their own section (see markup below): to the left,
  // under the request form, when there's room for the two-column layout;
  // above the main list when the window is too narrow for that
  $: pinnedItems = visibleItems.filter(item => item.pinned);
  $: unpinnedItems = visibleItems.filter(item => !item.pinned);

  let searchDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

  function onSearchInput(): void {
    if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      pageOffset = 0;
      void load();
    }, 300);
  }

  function onSearchPdfChange(): void {
    pageOffset = 0;
    void load();
  }

  function onDateFilterChange(): void {
    pageOffset = 0;
    void load();
  }

  function currentEffectiveUserId(): number | null {
    return selectedUserId ?? (ownerFilter === 'mine' ? core.currentUserid : null);
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      const params: Record<string, string> = {
        status: statusFilter,
        limit: String(pageSize),
        offset: String(pageOffset),
      };
      const effectiveUserId = currentEffectiveUserId();
      if (effectiveUserId !== null) {
        params.userid = String(effectiveUserId);
      }
      const trimmedSearch = searchQuery.trim();
      if (trimmedSearch !== '') {
        params.search = trimmedSearch;
        if (searchPdf) params.search_pdf = '1';
      }
      if (dateFrom !== '') params.date_from = dateFrom;
      if (dateTo !== '') params.date_to = dateTo;
      const fetched = await ApiC.getJson(Model.Order, params) as OrderItem[];
      hasNextPage = fetched.length > pageSize;
      items = fetched.slice(0, pageSize);
      // attachments now come bundled with each order, so this is a single
      // request instead of one per order
      uploadsByItem = Object.fromEntries(items.map(item => [item.id, item.uploads]));
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
        resourceResults = await ApiC.getJson(`${EntityType.Item}?fastq=${encodeURIComponent(query)}&limit=8`) as ResourceResult[];
      } catch (error) {
        notify.error(error instanceof Error ? error.message : 'Could not search resources.');
      } finally {
        searchingResource = false;
      }
    }, 250);
  }

  function pickResource(resource: ResourceResult): void {
    if (!selectedResources.some(r => r.id === resource.id)) {
      selectedResources = [...selectedResources, resource];
    }
    resourceQuery = '';
    resourceResults = [];
  }

  function removeSelectedResource(id: number): void {
    selectedResources = selectedResources.filter(r => r.id !== id);
  }

  // creates one pending resource: from a template when one is picked
  // (category is then whatever the template itself carries), otherwise a
  // blank resource with the chosen category (or none)
  async function createPendingResource(pending: PendingResource): Promise<number> {
    const params: Record<string, unknown> = pending.template !== null
      ? { title: pending.title.trim(), template: pending.template }
      : { title: pending.title.trim(), category: pending.category };
    return ApiC.post2location(EntityType.Item, params);
  }

  function addPendingNewResource(): void {
    pendingNewResources = [...pendingNewResources, { title: '', category: null, template: null }];
  }

  function removePendingNewResource(index: number): void {
    pendingNewResources = pendingNewResources.filter((_, i) => i !== index);
  }

  async function loadCategories(): Promise<void> {
    try {
      categories = await ApiC.getJson(`${Model.Team}/current/resources_categories`) as Category[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load resource categories.');
    }
  }

  async function loadTemplates(): Promise<void> {
    try {
      templates = await ApiC.getJson(`${EntityType.ItemType}/?fastq&scope=2`) as ResourceTemplate[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load resource templates.');
    }
  }

  async function submitNewItem(): Promise<void> {
    if (newTitle.trim() === '') return;
    submitting = true;
    try {
      const itemIds = selectedResources.map(r => r.id);
      for (const pending of pendingNewResources) {
        if (pending.title.trim() === '') continue;
        itemIds.push(await createPendingResource(pending));
      }
      let notesHtml = (newNotesEl?.innerHTML ?? '').trim();
      const orderId = await ApiC.post2location(Model.Order, {
        title: newTitle.trim(),
        // pending images are still local blob: preview URLs at this point --
        // fixed up right below once each one is actually uploaded
        notes: notesHtml === '' ? null : notesHtml,
        item_ids: itemIds,
        status: newIsReference ? 'reference' : undefined,
      });
      for (const file of newFiles) {
        try {
          await uploadFileToOrder(orderId, file);
        } catch (error) {
          notify.error(error instanceof Error ? error.message : `Could not attach ${file.name}.`);
        }
      }
      let notesChanged = false;
      for (const pending of pendingNoteImages) {
        try {
          const newId = await uploadFileToOrder(orderId, pending.file);
          const uploads = await ApiC.getJson(`${Model.Order}/${orderId}/${Model.Upload}`) as OrderUpload[];
          const upload = uploads.find(u => u.id === newId);
          if (upload) {
            notesHtml = notesHtml.replace(
              new RegExp(`<img[^>]*data-pending-image="${pending.placeholderId}"[^>]*>`),
              `<img src="${downloadUrl(upload)}" alt="${pending.file.name}" class="orders-note-image">`,
            );
            notesChanged = true;
          }
        } catch (error) {
          notify.error(error instanceof Error ? error.message : `Could not upload ${pending.file.name}.`);
        }
      }
      if (notesChanged) {
        await ApiC.patch(`${Model.Order}/${orderId}`, { notes: notesHtml });
      }
      newTitle = '';
      if (newNotesEl) newNotesEl.innerHTML = '';
      newFiles = [];
      newIsReference = false;
      selectedResources = [];
      pendingNewResources = [];
      pendingNoteImages = [];
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post this order.');
    } finally {
      submitting = false;
    }
  }

  function onNewFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      newFiles = [...newFiles, ...Array.from(input.files)];
    }
    input.value = '';
  }

  function removeNewFile(index: number): void {
    newFiles = newFiles.filter((_, i) => i !== index);
  }

  let newFilesDragOver = false;

  function onNewFilesDragOver(event: DragEvent): void {
    event.preventDefault();
    newFilesDragOver = true;
  }

  function onNewFilesDragLeave(): void {
    newFilesDragOver = false;
  }

  function onNewFilesDropped(event: DragEvent): void {
    event.preventDefault();
    newFilesDragOver = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      newFiles = [...newFiles, ...Array.from(files)];
    }
  }

  function canManage(item: OrderItem): boolean {
    return core.isAdmin || item.userid === core.currentUserid;
  }

  function startEdit(item: OrderItem): void {
    editingItemId = item.id;
    editTitle = item.title;
    editNotesInitial = item.notes ?? '';
    editResourceQuery = '';
    editResourceResults = [];
    editPendingNewResources = [];
    editSelectedResources = item.items.map(i => ({ id: i.id, title: i.title }));
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
        editResourceResults = await ApiC.getJson(`${EntityType.Item}?fastq=${encodeURIComponent(query)}&limit=8`) as ResourceResult[];
      } catch (error) {
        notify.error(error instanceof Error ? error.message : 'Could not search resources.');
      } finally {
        editSearchingResource = false;
      }
    }, 250);
  }

  function pickEditResource(resource: ResourceResult): void {
    if (!editSelectedResources.some(r => r.id === resource.id)) {
      editSelectedResources = [...editSelectedResources, resource];
    }
    editResourceQuery = '';
    editResourceResults = [];
  }

  function removeEditSelectedResource(id: number): void {
    editSelectedResources = editSelectedResources.filter(r => r.id !== id);
  }

  function addEditPendingNewResource(): void {
    editPendingNewResources = [...editPendingNewResources, { title: '', category: null, template: null }];
  }

  function removeEditPendingNewResource(index: number): void {
    editPendingNewResources = editPendingNewResources.filter((_, i) => i !== index);
  }

  async function saveEdit(item: OrderItem): Promise<void> {
    if (editTitle.trim() === '') return;
    savingEdit = true;
    try {
      const itemIds = editSelectedResources.map(r => r.id);
      for (const pending of editPendingNewResources) {
        if (pending.title.trim() === '') continue;
        itemIds.push(await createPendingResource(pending));
      }
      const notesHtml = (editNotesEl?.innerHTML ?? '').trim();
      await ApiC.patch(`${Model.Order}/${item.id}`, {
        title: editTitle.trim(),
        notes: notesHtml === '' ? null : notesHtml,
        item_ids: itemIds,
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
      // the current tab is filtered server-side by status, so an order that
      // just moved to a different status needs a reload to drop out of (or
      // into) the list being shown -- mirrors setArchived()/setPinned().
      await load();
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

  async function setArchived(item: OrderItem, archived: boolean): Promise<void> {
    try {
      await ApiC.patch(`${Model.Order}/${item.id}`, { archived });
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update this order.');
    }
  }

  async function setPinned(item: OrderItem, pinned: boolean): Promise<void> {
    try {
      await ApiC.patch(`${Model.Order}/${item.id}`, { pinned });
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update this order.');
    }
  }

  function selectTab(next: OrderStatus | 'archived' | 'all'): void {
    statusFilter = next;
    selectedIds = new Set();
    pageOffset = 0;
    void load();
  }

  function setOwnerFilter(next: 'mine' | 'all'): void {
    ownerFilter = next;
    selectedUserId = null;
    pageOffset = 0;
    void load();
  }

  function onSelectedUserChange(): void {
    pageOffset = 0;
    void load();
  }

  function onPageSizeChange(): void {
    pageOffset = 0;
    void load();
  }

  function goToPrevPage(): void {
    pageOffset = Math.max(0, pageOffset - pageSize);
    void load();
  }

  function goToNextPage(): void {
    pageOffset += pageSize;
    void load();
  }

  function toggleSelect(id: number): void {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds = next;
  }

  function toggleSelectAllVisible(): void {
    const manageableIds = visibleItems.filter(canManage).map(i => i.id);
    const allSelected = manageableIds.length > 0 && manageableIds.every(id => selectedIds.has(id));
    selectedIds = allSelected ? new Set() : new Set(manageableIds);
  }

  async function bulkSetStatus(status: OrderStatus): Promise<void> {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map(id => ApiC.patch(`${Model.Order}/${id}`, { status })));
      selectedIds = new Set();
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update the selected orders.');
    }
  }

  async function bulkSetArchived(archived: boolean): Promise<void> {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map(id => ApiC.patch(`${Model.Order}/${id}`, { archived })));
      selectedIds = new Set();
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not update the selected orders.');
    }
  }

  async function bulkDelete(): Promise<void> {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`${t('Delete')} ${ids.length} ${t('orders')}? ${t('This cannot be undone.')}`)) return;
    try {
      await Promise.all(ids.map(id => ApiC.delete(`${Model.Order}/${id}`)));
      selectedIds = new Set();
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete the selected orders.');
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
    if (!commentsByItem[item.id]) {
      await loadComments(item.id);
    }
  }

  async function submitComment(item: OrderItem): Promise<void> {
    const text = (commentDrafts[item.id] ?? '').trim();
    if (!text) return;
    try {
      const mentionedUserids = (commentMentions[item.id] ?? [])
        .filter(m => text.includes(`@${m.fullname}`))
        .map(m => m.userid);
      const body = wrapMentionsAsHtml(text, teamMembers);
      await ApiC.post(`${Model.Order}/${item.id}/${Model.Comment}`, { body, mentioned_userids: mentionedUserids });
      commentDrafts[item.id] = '';
      commentDrafts = commentDrafts;
      commentMentions[item.id] = [];
      commentMentions = commentMentions;
      await loadComments(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not post this comment.');
    }
  }

  function canDeleteComment(comment: OrderComment): boolean {
    return core.isAdmin || comment.userid === core.currentUserid;
  }

  let editingCommentId: number | null = null;
  let editCommentDraft = '';

  function startEditComment(comment: OrderComment): void {
    editingCommentId = comment.id;
    editCommentDraft = stripMentionHtml(comment.body);
  }

  function cancelEditComment(): void {
    editingCommentId = null;
  }

  async function saveEditComment(item: OrderItem, comment: OrderComment): Promise<void> {
    const text = editCommentDraft.trim();
    if (!text) return;
    try {
      const body = wrapMentionsAsHtml(text, teamMembers);
      await ApiC.patch(`${Model.Order}/${item.id}/${Model.Comment}/${comment.id}`, { body });
      editingCommentId = null;
      await loadComments(item.id);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save this comment.');
    }
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

  async function uploadFileToOrder(orderId: number, file: File): Promise<number> {
    const formData = new FormData();
    formData.set('file', file);
    return ApiC.post2location(`${Model.Order}/${orderId}/${Model.Upload}`, formData);
  }

  function isImageFile(file: File): boolean {
    return file.type.startsWith('image/');
  }

  // Pasting/dropping an image straight into a plain contenteditable, left to
  // the browser's own default handling, embeds it inline as a giant base64
  // data: URI -- blowing straight through the notes length limit for
  // anything but a tiny image. Upload it for real instead and insert a link
  // to the persisted file, the same way an attached file already works, so
  // it also renders inline on the card (see the {@html item.notes} above).
  async function insertUploadedImage(file: File, orderId: number, el: HTMLElement): Promise<void> {
    try {
      const newId = await uploadFileToOrder(orderId, file);
      const uploads = await ApiC.getJson(`${Model.Order}/${orderId}/${Model.Upload}`) as OrderUpload[];
      const upload = uploads.find(u => u.id === newId);
      if (!upload) return;
      el.focus();
      document.execCommand('insertHTML', false, `<img src="${downloadUrl(upload)}" alt="${file.name}" class="orders-note-image">`);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
    }
  }

  // Before the order exists there's nowhere to upload to yet -- show a live
  // local preview immediately (so pasting/dropping still feels instant) and
  // queue the real upload for submitNewItem() to run once orderId exists,
  // then swap the preview for the persisted file's real link.
  type PendingNoteImage = { placeholderId: string; file: File };
  let pendingNoteImages: PendingNoteImage[] = [];

  function queueNoteImageForCreate(file: File, el: HTMLElement): void {
    const placeholderId = `pending-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingNoteImages = [...pendingNoteImages, { placeholderId, file }];
    el.focus();
    document.execCommand(
      'insertHTML',
      false,
      `<img src="${URL.createObjectURL(file)}" data-pending-image="${placeholderId}" alt="${file.name}" class="orders-note-image">`,
    );
  }

  function handleNotesPaste(event: ClipboardEvent, orderId: number | null, el: HTMLElement): void {
    const imageFile = Array.from(event.clipboardData?.files ?? []).find(isImageFile);
    if (imageFile) {
      event.preventDefault();
      if (orderId !== null) {
        void insertUploadedImage(imageFile, orderId, el);
      } else {
        queueNoteImageForCreate(imageFile, el);
      }
      return;
    }
    handleLinkPreviewPaste(event, el);
  }

  function handleNotesDrop(event: DragEvent, orderId: number | null, el: HTMLElement): void {
    const imageFile = Array.from(event.dataTransfer?.files ?? []).find(isImageFile);
    if (!imageFile) return;
    event.preventDefault();
    if (orderId !== null) {
      void insertUploadedImage(imageFile, orderId, el);
    } else {
      queueNoteImageForCreate(imageFile, el);
    }
  }

  async function uploadFile(item: OrderItem, file: File): Promise<void> {
    uploadingItem = new Set(uploadingItem).add(item.id);
    try {
      await uploadFileToOrder(item.id, file);
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
      mentionCandidates[itemId] = [];
      mentionCandidates = mentionCandidates;
      return;
    }
    const lower = query.toLowerCase();
    mentionCandidates[itemId] = teamMembers.filter(m => m.fullname.toLowerCase().includes(lower)).slice(0, 5);
    mentionCandidates = mentionCandidates;
  }

  function pickMention(itemId: number, member: TeamMember): void {
    const text = commentDrafts[itemId] ?? '';
    const query = extractMentionQuery(text) ?? '';
    commentDrafts[itemId] = applyMention(text, query, member.fullname);
    commentDrafts = commentDrafts;
    if (!(commentMentions[itemId] ?? []).some(m => m.userid === member.userid)) {
      commentMentions[itemId] = [...(commentMentions[itemId] ?? []), member];
      commentMentions = commentMentions;
    }
    mentionCandidates[itemId] = [];
    mentionCandidates = mentionCandidates;
  }

  onMount(() => {
    // a notification (mention in a comment) links here with ?order=<id>
    // -- make sure that order is actually visible (it may be in a
    // different status tab, or not "mine") before opening its comments
    const orderParam = Number(new URLSearchParams(window.location.search).get('order'));
    const hasOrderParam = Number.isInteger(orderParam) && orderParam > 0;
    if (hasOrderParam) {
      statusFilter = 'all';
      ownerFilter = 'all';
    }
    void load().then(async () => {
      if (!hasOrderParam) return;
      let item = items.find(i => i.id === orderParam);
      if (!item) {
        // not on the first page of results -- fetch it directly rather
        // than making the user hunt for it, and pin it to the top of the
        // currently-loaded list so it actually renders
        try {
          item = await ApiC.getJson(`${Model.Order}/${orderParam}`) as OrderItem;
          items = [item, ...items];
        } catch {
          return;
        }
      }
      void toggleComments(item);
      await tick();
      document.getElementById(`order-item-${orderParam}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    void loadTeamMembers();
    void loadCategories();
    void loadTemplates();
  });
</script>

<div class="orders-board">
<div class="orders-layout">
  <div class="orders-form-column">
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
      <button
        type="button"
        class="btn btn-ghost btn-sm orders-reference-toggle mb-2"
        class:active={newIsReference}
        aria-pressed={newIsReference}
        title={t('This is a reference (catalog info, not an actual order) — always stays pinned')}
        on:click={() => newIsReference = !newIsReference}
      >
        <i class="fas fa-thumbtack fa-fw mr-1" aria-hidden="true"></i>{t('Reference')}
      </button>
      <label class="sr-only" for="ordersNewNotes">{t('Notes')}</label>
      <div
        id="ordersNewNotes"
        class="form-control mb-2 orders-notes-editor"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        data-placeholder={t('Notes (quantity, supplier, link…) — optional')}
        bind:this={newNotesEl}
        on:paste={(event) => handleNotesPaste(event, null, newNotesEl)}
        on:dragover|preventDefault
        on:drop={(event) => handleNotesDrop(event, null, newNotesEl)}
      ></div>

      <div class="orders-resource-picker mb-2">
        {#if selectedResources.length > 0}
          <div class="mb-1">
            {#each selectedResources as resource (resource.id)}
              <span class="badge badge-info orders-resource-badge mr-1">
                <i class="fas fa-box fa-fw mr-1" aria-hidden="true"></i>{resource.title}
                <button type="button" class="btn-unstyled ml-1" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeSelectedResource(resource.id)}>&times;</button>
              </span>
            {/each}
          </div>
        {/if}
        <div class="orders-resource-search" use:clickOutside={() => { resourceResults = []; }}>
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
        {#each pendingNewResources as pending, index (index)}
          <div class="d-flex align-items-center mt-1 flex-wrap orders-pending-resource">
            <input
              class="form-control form-control-sm mr-2 mb-1"
              type="text"
              maxlength="255"
              placeholder={t('New resource title…')}
              bind:value={pending.title}
            />
            <select class="form-control form-control-sm mr-2 mb-1 orders-category-select" bind:value={pending.template} title={t('Start from a template (optional)')}>
              <option value={null}>{t('No template')}</option>
              {#each templates as template (template.id)}
                <option value={template.id}>{template.title}</option>
              {/each}
            </select>
            <select class="form-control form-control-sm mr-2 mb-1 orders-category-select" bind:value={pending.category} disabled={pending.template !== null} title={t('Category (ignored if a template is picked)')}>
              <option value={null}>{t('No category')}</option>
              {#each categories as category (category.id)}
                <option value={category.id}>{category.title}</option>
              {/each}
            </select>
            <button type="button" class="btn btn-danger-ghost btn-sm orders-icon-button mb-1" title={t('Remove')} aria-label={t('Remove')} on:click={() => removePendingNewResource(index)}>
              <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
            </button>
          </div>
        {/each}
        <button type="button" class="btn btn-ghost btn-sm mt-1" on:click={addPendingNewResource}>
          <i class="fas fa-plus fa-fw mr-1" aria-hidden="true"></i>{t('Add a new resource instead')}
        </button>
      </div>

      <div
        class="orders-attachments mb-2"
        class:orders-attachments-drag-over={newFilesDragOver}
        on:dragover={onNewFilesDragOver}
        on:dragleave={onNewFilesDragLeave}
        on:drop={onNewFilesDropped}
      >
        <label class="btn btn-ghost btn-sm mb-0">
          <i class="fas fa-paperclip fa-fw mr-1" aria-hidden="true"></i>{t('Attach files')}
          <input type="file" class="orders-file-input" multiple on:change={onNewFilesSelected} />
        </label>
        <span class="orders-muted small ml-2">{t('or drag files here')}</span>
        {#if newFiles.length > 0}
          <ul class="orders-upload-list mt-1">
            {#each newFiles as file, index (file.name + index)}
              <li class="orders-upload">
                <i class="fas fa-file fa-fw mr-1" aria-hidden="true"></i>
                {file.name}
                <button type="button" class="btn btn-danger-ghost btn-sm orders-icon-button ml-auto" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeNewFile(index)}>
                  <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="d-flex align-items-center flex-wrap">
        <button type="submit" class="btn btn-primary btn-sm" disabled={submitting || newTitle.trim() === ''}>
          <i class="fas fa-cart-plus fa-fw mr-1" aria-hidden="true"></i>{t('Request order')}
        </button>
      </div>
    </form>
  </div>
  {#if pinnedItems.length > 0}
    <div class="orders-pinned-section">
      <h2 class="h6 orders-pinned-heading"><i class="fas fa-thumbtack fa-fw mr-1" aria-hidden="true"></i>{t('Pinned')}</h2>
      <ul class="orders-list">
        {#each pinnedItems as item (item.id)}
          {@render orderCard(item)}
        {/each}
      </ul>
    </div>
  {/if}
  </div>

  <div class="orders-list-column">
  <div class="d-flex flex-wrap align-items-center my-3 orders-toolbar-row" style="gap:0.5rem">
    <div class="btn-group btn-group-sm" role="group" aria-label={t('Filter by status')}>
      <button type="button" class={statusFilter === 'all' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectTab('all')}>
        {t('All')}
      </button>
      <button type="button" class={statusFilter === 'requested' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectTab('requested')}>
        {t('Requested')}
      </button>
      <button type="button" class={statusFilter === 'ordered' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectTab('ordered')}>
        {t('Ordered')}
      </button>
      <button type="button" class={statusFilter === 'received' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectTab('received')}>
        {t('Received')}
      </button>
      <button type="button" class={statusFilter === 'cancelled' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectTab('cancelled')}>
        {t('Cancelled')}
      </button>
      <button type="button" class={statusFilter === 'reference' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectTab('reference')} title={t('Shared team references, visible to everyone regardless of the Mine/Everyone filter')}>
        <i class="fas fa-thumbtack fa-fw mr-1" aria-hidden="true"></i>{t('Reference')}
      </button>
      <button type="button" class={statusFilter === 'archived' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => selectTab('archived')}>
        <i class="fas fa-box-archive fa-fw mr-1" aria-hidden="true"></i>{t('Archived')}
      </button>
    </div>
    <div class="btn-group btn-group-sm" role="group" aria-label={t('Filter by owner')}>
      <button type="button" class={ownerFilter === 'mine' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => setOwnerFilter('mine')}>
        <i class="fas fa-user fa-fw mr-1" aria-hidden="true"></i>{t('My orders')}
      </button>
      <button type="button" class={ownerFilter === 'all' ? 'btn btn-sm btn-secondary' : 'btn btn-sm btn-ghost'} on:click={() => setOwnerFilter('all')}>
        <i class="fas fa-users fa-fw mr-1" aria-hidden="true"></i>{t('Everyone')}
      </button>
    </div>
    {#if core.isAdmin}
      <select class="form-control form-control-sm orders-user-filter" style="width:auto" bind:value={selectedUserId} on:change={onSelectedUserChange} title={t('Filter by user')}>
        <option value={null}>{t('All users')}</option>
        {#each teamMembers as member (member.userid)}
          <option value={member.userid}>{member.fullname}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="d-flex flex-wrap align-items-start mb-3 orders-toolbar-row" style="gap:0.75rem">
    <div class="orders-search flex-grow-1">
      <input
        class="form-control form-control-sm"
        type="search"
        placeholder={t('Search orders…')}
        title={t('Searches title, notes, linked resource, requester and comments; attachment content is optional (see checkbox)')}
        bind:value={searchQuery}
        on:input={onSearchInput}
      />
      <label class="orders-muted small orders-search-pdf">
        <input type="checkbox" bind:checked={searchPdf} on:change={onSearchPdfChange} />
        {t('Also search inside PDF attachments (slower)')}
      </label>
    </div>
    <div class="d-flex align-items-center flex-wrap" style="gap:0.5rem">
      <label class="orders-muted small mb-0" for="ordersDateFrom">{t('From')}</label>
      <input
        id="ordersDateFrom"
        class="form-control form-control-sm"
        style="width:auto"
        type="date"
        bind:value={dateFrom}
        on:change={onDateFilterChange}
        title={t('Requested on or after')}
      />
      <label class="orders-muted small mb-0" for="ordersDateTo">{t('To')}</label>
      <input
        id="ordersDateTo"
        class="form-control form-control-sm"
        style="width:auto"
        type="date"
        bind:value={dateTo}
        on:change={onDateFilterChange}
        title={t('Requested on or before')}
      />
    </div>
    <div class="d-flex align-items-center flex-wrap" style="gap:0.5rem">
      <select class="form-control form-control-sm" style="width:auto" bind:value={pageSize} on:change={onPageSizeChange} title={t('Items per page')}>
        {#each PAGE_SIZES as size (size)}
          <option value={size}>{size} {t('/ page')}</option>
        {/each}
      </select>
      <div class="btn-group btn-group-sm" role="group" aria-label={t('Pagination')}>
        <button type="button" class="btn btn-sm btn-ghost" disabled={pageOffset === 0} on:click={goToPrevPage}>
          <i class="fas fa-chevron-left fa-fw" aria-hidden="true"></i>{t('Previous')}
        </button>
        <button type="button" class="btn btn-sm btn-ghost" disabled={!hasNextPage} on:click={goToNextPage}>
          {t('Next')}<i class="fas fa-chevron-right fa-fw" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </div>

  {#if selectedIds.size > 0}
    <div class="orders-bulk-bar d-flex align-items-center flex-wrap mb-2">
      <span class="mr-2">{selectedIds.size} {t('selected')}</span>
      <select
        class="form-control form-control-sm mr-2"
        style="width:auto"
        value=""
        on:change={(event) => {
          const value = (event.target as HTMLSelectElement).value;
          if (value !== '') void bulkSetStatus(value as OrderStatus);
          (event.target as HTMLSelectElement).value = '';
        }}
        aria-label={t('Move to status')}
      >
        <option value="" disabled>{t('Move to status…')}</option>
        {#each STATUSES as status (status)}
          <option value={status}>{statusLabel(status)}</option>
        {/each}
      </select>
      {#if statusFilter === 'archived'}
        <button type="button" class="btn btn-secondary btn-sm mr-2" on:click={() => bulkSetArchived(false)}>
          <i class="fas fa-box-open fa-fw mr-1" aria-hidden="true"></i>{t('Unarchive')}
        </button>
      {:else}
        <button type="button" class="btn btn-secondary btn-sm mr-2" on:click={() => bulkSetArchived(true)}>
          <i class="fas fa-box-archive fa-fw mr-1" aria-hidden="true"></i>{t('Archive')}
        </button>
      {/if}
      <button type="button" class="btn btn-danger-ghost btn-sm mr-2" on:click={bulkDelete}>
        <i class="fas fa-trash fa-fw mr-1" aria-hidden="true"></i>{t('Delete')}
      </button>
      <button type="button" class="btn btn-ghost btn-sm" on:click={() => selectedIds = new Set()}>{t('Clear selection')}</button>
    </div>
  {/if}

  {#if loading}
    <p class="orders-muted">{t('Loading')}…</p>
  {:else if visibleItems.length === 0}
    <p class="orders-muted">{t('No orders here.')}</p>
  {:else}
    <div class="mb-1">
      <label class="btn-unstyled d-inline-flex align-items-center orders-select-all">
        <input type="checkbox" class="mr-1" checked={visibleItems.some(canManage) && visibleItems.filter(canManage).every(i => selectedIds.has(i.id))} on:change={toggleSelectAllVisible} />
        {t('Select all')}
      </label>
    </div>
    <ul class="orders-list">
      {#each unpinnedItems as item (item.id)}
        {@render orderCard(item)}
      {/each}
    </ul>
  {/if}
  </div>
</div>
</div>

{#snippet orderCard(item)}
        <li id={`order-item-${item.id}`} class="orders-card orders-item" class:orders-item-pinned={item.pinned}>
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
                <div
                  id={`ordersEditNotes-${item.id}`}
                  class="form-control form-control-sm mb-2 orders-notes-editor"
                  contenteditable="true"
                  role="textbox"
                  aria-multiline="true"
                  bind:this={editNotesEl}
                  on:paste={(event) => handleNotesPaste(event, item.id, editNotesEl)}
                  on:dragover|preventDefault
                  on:drop={(event) => handleNotesDrop(event, item.id, editNotesEl)}
                >{@html editNotesInitial}</div>

                <div class="orders-resource-picker mb-2">
                  {#if editSelectedResources.length > 0}
                    <div class="mb-1">
                      {#each editSelectedResources as resource (resource.id)}
                        <span class="badge badge-info orders-resource-badge mr-1">
                          <i class="fas fa-box fa-fw mr-1" aria-hidden="true"></i>{resource.title}
                          <button type="button" class="btn-unstyled ml-1" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeEditSelectedResource(resource.id)}>&times;</button>
                        </span>
                      {/each}
                    </div>
                  {/if}
                  <div class="orders-resource-search" use:clickOutside={() => { editResourceResults = []; }}>
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
                  {#each editPendingNewResources as pending, index (index)}
                    <div class="d-flex align-items-center mt-1 flex-wrap orders-pending-resource">
                      <input
                        class="form-control form-control-sm mr-2 mb-1"
                        type="text"
                        maxlength="255"
                        placeholder={t('New resource title…')}
                        bind:value={pending.title}
                      />
                      <select class="form-control form-control-sm mr-2 mb-1 orders-category-select" bind:value={pending.template} title={t('Start from a template (optional)')}>
                        <option value={null}>{t('No template')}</option>
                        {#each templates as template (template.id)}
                          <option value={template.id}>{template.title}</option>
                        {/each}
                      </select>
                      <select class="form-control form-control-sm mr-2 mb-1 orders-category-select" bind:value={pending.category} disabled={pending.template !== null} title={t('Category (ignored if a template is picked)')}>
                        <option value={null}>{t('No category')}</option>
                        {#each categories as category (category.id)}
                          <option value={category.id}>{category.title}</option>
                        {/each}
                      </select>
                      <button type="button" class="btn btn-danger-ghost btn-sm orders-icon-button mb-1" title={t('Remove')} aria-label={t('Remove')} on:click={() => removeEditPendingNewResource(index)}>
                        <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                      </button>
                    </div>
                  {/each}
                  <button type="button" class="btn btn-ghost btn-sm mt-1" on:click={addEditPendingNewResource}>
                    <i class="fas fa-plus fa-fw mr-1" aria-hidden="true"></i>{t('Add a new resource instead')}
                  </button>
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
                {#if canManage(item)}
                  <input
                    type="checkbox"
                    class="mr-1"
                    checked={selectedIds.has(item.id)}
                    on:change={() => toggleSelect(item.id)}
                    aria-label={t('Select')}
                  />
                {/if}
                <select
                  class={`form-control form-control-sm orders-status-select orders-status-select-${item.status}`}
                  value={item.status}
                  on:change={(event) => setStatus(item, (event.target as HTMLSelectElement).value as OrderStatus)}
                  aria-label={t('Status')}
                >
                  {#each STATUSES as status (status)}
                    <option value={status}>{statusLabel(status)}</option>
                  {/each}
                </select>
                <span class="orders-muted orders-item-id" title={t('Order ID')}>#{item.id}</span>
                <strong class="orders-item-title">{item.title}</strong>
                {#each item.items as linkedItem (linkedItem.id)}
                  <span class="badge badge-info"><i class="fas fa-box fa-fw mr-1" aria-hidden="true"></i>{linkedItem.title}</span>
                {/each}
                {#if item.procurement_id}
                  <span class="badge badge-light" title={t('Beschaffungs-ID, extracted from an uploaded order confirmation PDF')}>{t('Procurement ID')}: {item.procurement_id}</span>
                {/if}
                {#if item.order_number}
                  <span class="badge badge-light" title={t('Bestellung Nr., extracted from an uploaded order confirmation PDF')}>{t('Order #')}: {item.order_number}</span>
                {/if}
                {#if canManage(item)}
                  <div class="orders-item-actions ml-auto">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm orders-icon-button"
                      class:orders-icon-button-active={item.pinned}
                      disabled={item.status === 'reference'}
                      title={item.status === 'reference' ? t('A reference always stays pinned') : item.pinned ? t('Unpin') : t('Pin to top')}
                      aria-label={item.status === 'reference' ? t('A reference always stays pinned') : item.pinned ? t('Unpin') : t('Pin to top')}
                      on:click={() => setPinned(item, !item.pinned)}
                    >
                      <i class="fas fa-thumbtack fa-fw" aria-hidden="true"></i>
                    </button>
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
                      class="btn btn-ghost btn-sm orders-icon-button"
                      title={item.archived ? t('Unarchive') : t('Archive')}
                      aria-label={item.archived ? t('Unarchive') : t('Archive')}
                      on:click={() => setArchived(item, !item.archived)}
                    >
                      <i class={`fas ${item.archived ? 'fa-box-open' : 'fa-box-archive'} fa-fw`} aria-hidden="true"></i>
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
              {#if item.notes}<div class="orders-item-description mb-1">{@html item.notes}</div>{/if}
              <div class="orders-muted orders-item-meta">
                {t('Requested by')} {item.author_fullname} · {formatDate(item.created_at)}
              </div>
            {/if}
            <div
              class="orders-attachments mt-1"
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
                      {#if upload.has_extracted_text}
                        <i class="fas fa-magnifying-glass fa-fw ml-1 orders-muted" title={t('Content is searchable')} aria-label={t('Content is searchable')}></i>
                      {:else if upload.extraction_status === 'pending'}
                        <i class="fas fa-spinner fa-spin fa-fw ml-1 orders-muted" title={t('Extracting text for search…')} aria-label={t('Extracting text for search')}></i>
                      {/if}
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
                              <div class="ml-auto d-flex">
                                <button
                                  type="button"
                                  class="btn btn-ghost btn-sm orders-icon-button"
                                  title={t('Edit comment')}
                                  aria-label={t('Edit comment')}
                                  on:click={() => startEditComment(comment)}
                                >
                                  <i class="fas fa-pen fa-fw" aria-hidden="true"></i>
                                </button>
                                <button
                                  type="button"
                                  class="btn btn-danger-ghost btn-sm orders-icon-button"
                                  title={t('Delete comment')}
                                  aria-label={t('Delete comment')}
                                  on:click={() => deleteComment(item, comment)}
                                >
                                  <i class="fas fa-trash fa-fw" aria-hidden="true"></i>
                                </button>
                              </div>
                            {/if}
                          </div>
                          {#if editingCommentId === comment.id}
                            <div class="d-flex">
                              <input
                                type="text"
                                class="form-control form-control-sm mr-2"
                                maxlength="5000"
                                bind:value={editCommentDraft}
                                on:keydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveEditComment(item, comment); } }}
                              />
                              <button type="button" class="btn btn-primary btn-sm mr-1" disabled={!editCommentDraft.trim()} on:click={() => saveEditComment(item, comment)}>{t('Save')}</button>
                              <button type="button" class="btn btn-ghost btn-sm" on:click={cancelEditComment}>{t('Cancel')}</button>
                            </div>
                            {#if wrapMentionsAsHtml(editCommentDraft, teamMembers).includes('elabftw-mention')}
                              <div class="orders-mention-preview small orders-muted mt-1">{@html wrapMentionsAsHtml(editCommentDraft, teamMembers)}</div>
                            {/if}
                          {:else}
                            <p class="mb-0 orders-comment-body">{@html comment.body}</p>
                          {/if}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                  <form
                    class="d-flex orders-comment-form"
                    on:submit|preventDefault={() => submitComment(item)}
                    use:clickOutside={() => { mentionCandidates[item.id] = []; mentionCandidates = mentionCandidates; }}
                  >
                    <label class="sr-only" for={`ordersComment-${item.id}`}>{t('Add a comment')}</label>
                    <input
                      id={`ordersComment-${item.id}`}
                      class="form-control form-control-sm mr-2"
                      type="text"
                      maxlength="5000"
                      placeholder={t('Add a comment… (type @ to mention someone)')}
                      bind:value={commentDrafts[item.id]}
                      on:input={() => onCommentInput(item.id)}
                    />
                    {#if (mentionCandidates[item.id] ?? []).length > 0}
                      <ul class="orders-resource-results orders-mention-results">
                        {#each mentionCandidates[item.id] as member (member.userid)}
                          <li>
                            <button type="button" class="btn-unstyled orders-resource-result" on:click={() => pickMention(item.id, member)}>
                              {member.fullname}
                            </button>
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    <button type="submit" class="btn btn-primary btn-sm" disabled={!(commentDrafts[item.id] ?? '').trim()}>
                      {t('Post')}
                    </button>
                  </form>
                  {#if wrapMentionsAsHtml(commentDrafts[item.id] ?? '', teamMembers).includes('elabftw-mention')}
                    <div class="orders-mention-preview small orders-muted mt-1">{@html wrapMentionsAsHtml(commentDrafts[item.id] ?? '', teamMembers)}</div>
                  {/if}
                {/if}
              </div>
            {/if}
          </div>
        </li>
{/snippet}

<style>
  /* Mirrors FeedbackBoard.svelte's styling approach: explicit background +
     border cards using the app's own real tokens/button classes, so this
     looks and themes exactly like the rest of eLabFTW, light or dark. */
  .orders-board {
    max-width: 100%;
  }

  .orders-layout {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
  }

  .orders-form-column {
    flex: 1 1 22rem;
    max-width: 28rem;
  }

  .orders-list-column {
    flex: 3 1 32rem;
    min-width: 0;
  }

  .orders-pinned-section {
    margin-top: 1rem;
  }

  .orders-pinned-heading {
    color: var(--secondary);
    margin-bottom: 0.5rem;
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

  .orders-search {
    max-width: 20rem;
    min-width: 12rem;
  }

  .orders-search span {
    display: block;
    margin-top: 0.15rem;
  }

  .orders-search-pdf {
    align-items: center;
    display: flex;
    gap: 0.3rem;
    margin: 0.15rem 0 0;
  }

  .orders-select-all {
    color: var(--secondary);
    cursor: pointer;
    font-size: 0.85rem;
  }

  .orders-bulk-bar {
    background: var(--mainbackground);
    border: 1px solid var(--secondary);
    border-radius: 0.5rem;
    padding: 0.5rem 0.7rem;
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

  .orders-item-pinned {
    background: color-mix(in srgb, var(--primary) 6%, var(--mainbackground));
    border-color: var(--primary);
  }

  .orders-icon-button-active {
    color: var(--primary);
  }

  .orders-reference-toggle {
    border: 1px solid var(--secondary);
  }

  .orders-reference-toggle.active {
    background: color-mix(in srgb, var(--primary) 10%, var(--mainbackground));
    border-color: var(--primary);
    color: var(--primary);
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
    font-weight: 700;
    border: none;
    color: #212529;
    background-color: #ffc107;
  }

  .orders-status-select-ordered {
    color: #fff;
    background-color: #17a2b8;
  }

  .orders-status-select-received {
    color: #fff;
    background-color: #28a745;
  }

  .orders-status-select-cancelled {
    color: #fff;
    background-color: #4d4c4c;
  }

  .orders-status-select-reference {
    color: #fff;
    background-color: #6f42c1;
  }

  .orders-category-select {
    max-width: 12rem;
  }

  .orders-icon-button {
    padding: 0.15rem 0.4rem;
  }

  .orders-item-description {
    margin: 0.35rem 0 0.2rem;
    overflow-wrap: anywhere;
  }

  /* an image pasted/dropped into notes shouldn't be able to blow the card
     out to its own full size -- cap it to a fixed box (not a percentage of
     the card, which has no width of its own and would just grow to match
     the image instead of constraining it) and only ever shrink a bigger
     image down to fit, never stretch a small one up to fill the box. */
  .orders-note-image {
    max-height: 18rem;
    max-width: min(100%, 24rem);
    width: auto;
    height: auto;
    object-fit: contain;
  }

  .orders-notes-editor {
    height: auto;
    min-height: 4rem;
    overflow-y: auto;
  }

  .orders-notes-editor:focus {
    outline: none;
  }

  .orders-notes-editor:empty::before {
    color: var(--secondary);
    content: attr(data-placeholder);
  }

  .orders-item-id {
    font-weight: 400;
  }

  .orders-item-meta {
    font-size: 0.78rem;
  }

  .orders-comment-form {
    position: relative;
  }

  .orders-mention-results {
    top: auto;
    bottom: 100%;
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
