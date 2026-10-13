<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';

  type TemplateUpload = {
    id: number;
    real_name: string;
    long_name: string;
    storage: number;
    filesize: number | null;
  };

  type OrderTemplate = {
    id: number;
    title: string;
    body: string | null;
    userid: number;
    author_fullname: string | null;
    created_at: string;
    updated_at: string;
    can_edit: boolean;
    uploads: TemplateUpload[];
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();
  const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

  let templates: OrderTemplate[] = [];
  let loading = true;
  let query = '';
  let showNew = false;
  let newTitle = '';
  let newEditorEl: HTMLDivElement | undefined;
  let newFiles: File[] = [];
  let editingId: number | null = null;
  let editTitle = '';
  let editBodyInitial = '';
  let editEditorEl: HTMLDivElement | undefined;
  let saving = false;
  let uploadingId: number | null = null;
  let expandedIds = new Set<number>();
  let lightbox: { url: string; name: string } | null = null;
  let dragOver = false;

  $: visible = templates.filter(template => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return true;
    const text = `${template.title}\n${template.body ? htmlToText(template.body) : ''}`.toLowerCase();
    return text.includes(needle);
  });

  function htmlToText(html: string): string {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    return holder.innerText || holder.textContent || '';
  }

  const isImage = (upload: TemplateUpload): boolean => IMAGE_EXTENSIONS.test(upload.real_name);
  const downloadUrl = (upload: TemplateUpload): string =>
    `app/download.php?f=${encodeURIComponent(upload.long_name)}&storage=${upload.storage}&name=${encodeURIComponent(upload.real_name)}`;

  function formatSize(bytes: number | null): string {
    if (bytes === null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      templates = await ApiC.getJson(Model.OrderTemplate) as OrderTemplate[];
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not load the templates.');
    } finally {
      loading = false;
    }
  }

  // Bullets, numbering and basic emphasis for the text; the buttons keep the caret in the editor.
  function format(command: string): void {
    document.execCommand(command, false);
  }

  function cleanHtml(el: HTMLElement | undefined): string {
    const html = el?.innerHTML ?? '';
    return el && (el.innerText ?? '').trim() === '' && !el.querySelector('li') ? '' : html;
  }

  // sets the editor's content once, when it appears (not on every keystroke)
  function initialHtml(node: HTMLElement, html: string): void {
    node.innerHTML = html;
  }

  async function uploadFiles(templateId: number, files: File[]): Promise<void> {
    for (const file of files) {
      const formData = new FormData();
      formData.set('file', file);
      try {
        await ApiC.post2location(`${Model.OrderTemplate}/${templateId}/${Model.Upload}`, formData);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
      }
    }
  }

  async function create(): Promise<void> {
    if (newTitle.trim() === '' || saving) return;
    saving = true;
    try {
      const id = await ApiC.post2location(Model.OrderTemplate, { title: newTitle.trim(), body: cleanHtml(newEditorEl) });
      await uploadFiles(id, newFiles);
      newTitle = '';
      newFiles = [];
      showNew = false;
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save this template.');
    } finally {
      saving = false;
    }
  }

  function startEdit(template: OrderTemplate): void {
    editingId = template.id;
    editTitle = template.title;
    editBodyInitial = template.body ?? '';
  }

  async function saveEdit(template: OrderTemplate): Promise<void> {
    if (editTitle.trim() === '' || saving) return;
    saving = true;
    try {
      await ApiC.patch(`${Model.OrderTemplate}/${template.id}`, { title: editTitle.trim(), body: cleanHtml(editEditorEl) });
      editingId = null;
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save this template.');
    } finally {
      saving = false;
    }
  }

  async function addFilesToExisting(template: OrderTemplate, files: File[]): Promise<void> {
    if (files.length === 0) return;
    uploadingId = template.id;
    try {
      await uploadFiles(template.id, files);
      // keep the text being edited: only the file list is refreshed
      const fresh = await ApiC.getJson(`${Model.OrderTemplate}/${template.id}`) as OrderTemplate;
      templates = templates.map(item => item.id === template.id ? { ...item, uploads: fresh.uploads } : item);
    } finally {
      uploadingId = null;
    }
  }

  async function removeUpload(template: OrderTemplate, upload: TemplateUpload): Promise<void> {
    if (!window.confirm(t('Remove this file?'))) return;
    try {
      await ApiC.delete(`${Model.OrderTemplate}/${template.id}/${Model.Upload}/${upload.id}`);
      templates = templates.map(item => item.id === template.id
        ? { ...item, uploads: item.uploads.filter(file => file.id !== upload.id) }
        : item);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not remove this file.');
    }
  }

  async function remove(template: OrderTemplate): Promise<void> {
    if (!window.confirm(t('Delete this template for everyone?'))) return;
    try {
      await ApiC.delete(`${Model.OrderTemplate}/${template.id}`);
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not delete this template.');
    }
  }

  // Copies the formatted text (bullets and numbering survive pasting into an email) plus a plain version.
  async function copy(template: OrderTemplate): Promise<void> {
    const html = template.body ?? '';
    const plain = htmlToText(html);
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      notify.success('copied');
    } catch {
      try {
        await navigator.clipboard.writeText(plain);
        notify.success('copied');
      } catch {
        expandedIds = new Set(expandedIds).add(template.id);
        notify.error('Could not copy automatically; select the text and copy it.');
      }
    }
  }

  function toggleExpanded(id: number): void {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedIds = next;
  }

  const isLong = (body: string | null): boolean => htmlToText(body ?? '').split('\n').length > 8 || (body ?? '').length > 600;

  function pickFiles(event: Event): File[] {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    return files;
  }

  function onDropNew(event: DragEvent): void {
    event.preventDefault();
    dragOver = false;
    newFiles = [...newFiles, ...Array.from(event.dataTransfer?.files ?? [])];
  }

  onMount(load);
</script>

<svelte:window on:keydown={(event) => { if (event.key === 'Escape') lightbox = null; }} />

<div class='order-templates'>
  <div class='d-flex flex-wrap align-items-center mb-3'>
    <button type='button' class='btn btn-primary btn-sm mr-2 mb-2' on:click={() => showNew = !showNew}>
      <i class='fas fa-plus fa-fw mr-1' aria-hidden='true'></i>{t('New template')}
    </button>
    <input
      type='search'
      class='form-control form-control-sm order-templates-search mb-2'
      placeholder={t('Search templates')}
      aria-label={t('Search templates')}
      bind:value={query}
    >
  </div>

  {#if showNew}
    <div class='card card-body mb-3'>
      <label class='sr-only' for='orderTemplateNewTitle'>{t('Title')}</label>
      <input id='orderTemplateNewTitle' class='form-control mb-2' maxlength='255' placeholder={t('Title, for example: Quote request to a supplier')} bind:value={newTitle}>
      <div class='order-template-toolbar mb-1' role='toolbar' aria-label={t('Text formatting')}>
        <button type='button' class='btn btn-ghost btn-sm' title={t('Bullet list')} aria-label={t('Bullet list')} on:mousedown|preventDefault={() => format('insertUnorderedList')}><i class='fas fa-list-ul fa-fw' aria-hidden='true'></i></button>
        <button type='button' class='btn btn-ghost btn-sm' title={t('Numbered list')} aria-label={t('Numbered list')} on:mousedown|preventDefault={() => format('insertOrderedList')}><i class='fas fa-list-ol fa-fw' aria-hidden='true'></i></button>
        <button type='button' class='btn btn-ghost btn-sm' title={t('Bold')} aria-label={t('Bold')} on:mousedown|preventDefault={() => format('bold')}><i class='fas fa-bold fa-fw' aria-hidden='true'></i></button>
        <button type='button' class='btn btn-ghost btn-sm' title={t('Italic')} aria-label={t('Italic')} on:mousedown|preventDefault={() => format('italic')}><i class='fas fa-italic fa-fw' aria-hidden='true'></i></button>
        <button type='button' class='btn btn-ghost btn-sm' title={t('Clear formatting')} aria-label={t('Clear formatting')} on:mousedown|preventDefault={() => format('removeFormat')}><i class='fas fa-eraser fa-fw' aria-hidden='true'></i></button>
      </div>
      <div
        class='form-control order-template-editor mb-2'
        contenteditable='true'
        role='textbox'
        aria-multiline='true'
        aria-label={t('Text')}
        data-placeholder={t('The text, with placeholders like [supplier] where it needs filling in')}
        bind:this={newEditorEl}
      ></div>
      <div
        class='order-template-dropzone mb-2'
        class:drag-over={dragOver}
        role='group'
        aria-label={t('Files')}
        on:dragover|preventDefault={() => dragOver = true}
        on:dragleave={() => dragOver = false}
        on:drop={onDropNew}
      >
        <label class='btn btn-outline-secondary btn-sm mb-0 mr-2'>
          <i class='fas fa-paperclip fa-fw mr-1' aria-hidden='true'></i>{t('Attach files')}
          <input type='file' multiple hidden on:change={(event) => newFiles = [...newFiles, ...pickFiles(event)]}>
        </label>
        <span class='small text-muted'>{t('or drag files here (images show as small pictures)')}</span>
        {#each newFiles as file, index (index)}
          <span class='badge badge-secondary ml-1'>{file.name}
            <button type='button' class='btn-unstyled ml-1' aria-label={t('Remove')} on:click={() => newFiles = newFiles.filter((_, i) => i !== index)}>&times;</button>
          </span>
        {/each}
      </div>
      <div>
        <button type='button' class='btn btn-primary btn-sm mr-1' disabled={newTitle.trim() === '' || saving} on:click={create}>{t('Save')}</button>
        <button type='button' class='btn btn-secondary btn-sm' on:click={() => { showNew = false; newFiles = []; }}>{t('Cancel')}</button>
      </div>
    </div>
  {/if}

  {#if loading}
    <p class='text-muted'>{t('Loading')}…</p>
  {:else if visible.length === 0}
    <div class='alert alert-info'>{templates.length === 0 ? t('No templates yet. Add one with New template.') : t('No template matches your search.')}</div>
  {/if}

  {#each visible as template (template.id)}
    <div class='card mb-3'>
      <div class='card-body'>
        {#if editingId === template.id}
          <label class='sr-only' for={`orderTemplateEditTitle-${template.id}`}>{t('Title')}</label>
          <input id={`orderTemplateEditTitle-${template.id}`} class='form-control mb-2' maxlength='255' bind:value={editTitle}>
          <div class='order-template-toolbar mb-1' role='toolbar' aria-label={t('Text formatting')}>
            <button type='button' class='btn btn-ghost btn-sm' title={t('Bullet list')} aria-label={t('Bullet list')} on:mousedown|preventDefault={() => format('insertUnorderedList')}><i class='fas fa-list-ul fa-fw' aria-hidden='true'></i></button>
            <button type='button' class='btn btn-ghost btn-sm' title={t('Numbered list')} aria-label={t('Numbered list')} on:mousedown|preventDefault={() => format('insertOrderedList')}><i class='fas fa-list-ol fa-fw' aria-hidden='true'></i></button>
            <button type='button' class='btn btn-ghost btn-sm' title={t('Bold')} aria-label={t('Bold')} on:mousedown|preventDefault={() => format('bold')}><i class='fas fa-bold fa-fw' aria-hidden='true'></i></button>
            <button type='button' class='btn btn-ghost btn-sm' title={t('Italic')} aria-label={t('Italic')} on:mousedown|preventDefault={() => format('italic')}><i class='fas fa-italic fa-fw' aria-hidden='true'></i></button>
            <button type='button' class='btn btn-ghost btn-sm' title={t('Clear formatting')} aria-label={t('Clear formatting')} on:mousedown|preventDefault={() => format('removeFormat')}><i class='fas fa-eraser fa-fw' aria-hidden='true'></i></button>
          </div>
          <div
            class='form-control order-template-editor mb-2'
            contenteditable='true'
            role='textbox'
            aria-multiline='true'
            aria-label={t('Text')}
            use:initialHtml={editBodyInitial}
            bind:this={editEditorEl}
          ></div>
          <div class='mb-2'>
            {#each template.uploads as upload (upload.id)}
              <span class='badge badge-secondary mr-1'>{upload.real_name}
                <button type='button' class='btn-unstyled ml-1' aria-label={t('Remove')} title={t('Remove this file')} on:click={() => removeUpload(template, upload)}>&times;</button>
              </span>
            {/each}
            <label class='btn btn-outline-secondary btn-sm mb-0'>
              <i class='fas fa-paperclip fa-fw mr-1' aria-hidden='true'></i>{uploadingId === template.id ? t('Uploading') + '…' : t('Attach files')}
              <input type='file' multiple hidden on:change={(event) => addFilesToExisting(template, pickFiles(event))}>
            </label>
          </div>
          <button type='button' class='btn btn-primary btn-sm mr-1' disabled={editTitle.trim() === '' || saving} on:click={() => saveEdit(template)}>{t('Save')}</button>
          <button type='button' class='btn btn-secondary btn-sm' on:click={() => { editingId = null; void load(); }}>{t('Cancel')}</button>
        {:else}
          <div class='d-flex align-items-start'>
            <h2 class='h5 flex-grow-1 mb-1'>{template.title}</h2>
            <button type='button' class='btn btn-outline-primary btn-sm ml-2' title={t('Copy the text')} aria-label={t('Copy the text')} on:click={() => copy(template)}>
              <i class='fas fa-copy fa-fw mr-1' aria-hidden='true'></i>{t('Copy')}
            </button>
            {#if template.can_edit}
              <button type='button' class='btn btn-ghost btn-sm ml-1' title={t('Edit')} aria-label={t('Edit')} on:click={() => startEdit(template)}><i class='fas fa-pen fa-fw' aria-hidden='true'></i></button>
              <button type='button' class='btn btn-ghost btn-sm' title={t('Delete')} aria-label={t('Delete')} on:click={() => remove(template)}><i class='fas fa-trash fa-fw text-danger' aria-hidden='true'></i></button>
            {/if}
          </div>
          <p class='text-muted small mb-2'>{template.author_fullname ?? ''}</p>
          {#if template.body}
            <div class='order-template-body' class:collapsed={isLong(template.body) && !expandedIds.has(template.id)}>{@html template.body}</div>
            {#if isLong(template.body)}
              <button type='button' class='btn btn-link btn-sm p-0 mb-1' on:click={() => toggleExpanded(template.id)}>
                {expandedIds.has(template.id) ? t('Show less') : t('Show all')}
              </button>
            {/if}
          {:else}
            <p class='text-muted mb-1'>{t('This template has no text.')}</p>
          {/if}
          {#if template.uploads.length > 0}
            <div class='order-template-files mt-2'>
              {#each template.uploads.filter(isImage) as upload (upload.id)}
                <button type='button' class='order-template-thumb' title={upload.real_name} aria-label={`${t('Open')} ${upload.real_name}`} on:click={() => lightbox = { url: downloadUrl(upload), name: upload.real_name }}>
                  <img src={downloadUrl(upload)} alt={upload.real_name} loading='lazy'>
                </button>
              {/each}
              {#each template.uploads.filter(upload => !isImage(upload)) as upload (upload.id)}
                <a class='btn btn-outline-secondary btn-sm' href={downloadUrl(upload)} title={upload.real_name}>
                  <i class='fas fa-file fa-fw mr-1' aria-hidden='true'></i>{upload.real_name}{#if upload.filesize !== null}<span class='text-muted ml-1'>{formatSize(upload.filesize)}</span>{/if}
                </a>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/each}
</div>

{#if lightbox}
  <div class='order-template-lightbox' role='dialog' aria-modal='true' aria-label={lightbox.name} tabindex='-1' on:click={() => lightbox = null} on:keydown={(event) => { if (event.key === 'Escape') lightbox = null; }}>
    <button type='button' class='order-template-lightbox-close btn btn-light btn-sm' aria-label={t('Close')} on:click|stopPropagation={() => lightbox = null}>&times;</button>
    <img src={lightbox.url} alt={lightbox.name} on:click|stopPropagation>
    <div class='order-template-lightbox-name'>{lightbox.name}</div>
  </div>
{/if}

<style>
  .order-templates-search {
    max-width: 20rem;
  }

  .order-template-toolbar {
    display: flex;
    gap: 0.2rem;
  }

  .order-template-editor {
    height: auto;
    min-height: 9rem;
    overflow-y: auto;
    white-space: pre-wrap;
  }

  .order-template-editor:empty::before {
    color: var(--medium, #6c757d);
    content: attr(data-placeholder);
  }

  .order-template-dropzone {
    border: 1px dashed var(--secondary, #adb5bd);
    border-radius: 0.25rem;
    padding: 0.4rem 0.6rem;
  }

  .order-template-dropzone.drag-over {
    background: color-mix(in srgb, var(--primary, #29aeb9) 12%, transparent);
  }

  .order-template-body {
    font-size: 0.95rem;
    overflow-wrap: anywhere;
  }

  .order-template-body :global(ul),
  .order-template-body :global(ol) {
    margin-bottom: 0.5rem;
    padding-left: 1.5rem;
  }

  .order-template-body :global(p) {
    margin-bottom: 0.5rem;
  }

  .order-template-body.collapsed {
    max-height: 11rem;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(#000 70%, transparent);
    mask-image: linear-gradient(#000 70%, transparent);
  }

  .order-template-files {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .order-template-thumb {
    background: #fff;
    border: 1px solid var(--secondary, #ced4da);
    border-radius: 0.25rem;
    cursor: zoom-in;
    height: 4.5rem;
    overflow: hidden;
    padding: 0;
    width: 4.5rem;
  }

  .order-template-thumb img {
    height: 100%;
    object-fit: cover;
    width: 100%;
  }

  .order-template-lightbox {
    align-items: center;
    background: rgba(0, 0, 0, 0.8);
    cursor: zoom-out;
    display: flex;
    flex-direction: column;
    inset: 0;
    justify-content: center;
    padding: 1rem;
    position: fixed;
    z-index: 2000;
  }

  .order-template-lightbox img {
    background: #fff;
    cursor: default;
    max-height: 85vh;
    max-width: 92vw;
    object-fit: contain;
  }

  .order-template-lightbox-name {
    color: #fff;
    margin-top: 0.5rem;
  }

  .order-template-lightbox-close {
    position: absolute;
    right: 1rem;
    top: 1rem;
  }
</style>
