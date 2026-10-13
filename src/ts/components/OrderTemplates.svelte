<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiC } from '../api';
  import i18next from '../i18n';
  import { Model } from '../interfaces';
  import { Notification as AppNotification } from '../Notifications.class';

  type OrderTemplate = {
    id: number;
    title: string;
    body: string | null;
    userid: number;
    author_fullname: string | null;
    created_at: string;
    updated_at: string;
    can_edit: boolean;
  };

  const t = i18next.t.bind(i18next);
  const notify = new AppNotification();

  let templates: OrderTemplate[] = [];
  let loading = true;
  let query = '';
  let showNew = false;
  let newTitle = '';
  let newBody = '';
  let editingId: number | null = null;
  let editTitle = '';
  let editBody = '';
  let saving = false;
  let expandedIds = new Set<number>();

  $: visible = templates.filter(template => {
    const needle = query.trim().toLowerCase();
    return needle === '' || `${template.title}\n${template.body ?? ''}`.toLowerCase().includes(needle);
  });

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

  async function create(): Promise<void> {
    if (newTitle.trim() === '' || saving) return;
    saving = true;
    try {
      await ApiC.post(Model.OrderTemplate, { title: newTitle.trim(), body: newBody });
      newTitle = '';
      newBody = '';
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
    editBody = template.body ?? '';
  }

  async function saveEdit(template: OrderTemplate): Promise<void> {
    if (editTitle.trim() === '' || saving) return;
    saving = true;
    try {
      await ApiC.patch(`${Model.OrderTemplate}/${template.id}`, { title: editTitle.trim(), body: editBody });
      editingId = null;
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : 'Could not save this template.');
    } finally {
      saving = false;
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

  async function copy(template: OrderTemplate): Promise<void> {
    const text = template.body ?? '';
    try {
      await navigator.clipboard.writeText(text);
      notify.success('copied');
    } catch {
      // clipboard blocked: select the text so Ctrl/Cmd+C works
      expandedIds = new Set(expandedIds).add(template.id);
      notify.error('Could not copy automatically; select the text and copy it.');
    }
  }

  function toggleExpanded(id: number): void {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedIds = next;
  }

  const isLong = (body: string | null): boolean => (body ?? '').split('\n').length > 6 || (body ?? '').length > 400;

  onMount(load);
</script>

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
      <label class='sr-only' for='orderTemplateNewBody'>{t('Text')}</label>
      <textarea id='orderTemplateNewBody' class='form-control mb-2' rows='8' placeholder={t('The text, with placeholders like [supplier] or <date> where it needs filling in')} bind:value={newBody}></textarea>
      <div>
        <button type='button' class='btn btn-primary btn-sm mr-1' disabled={newTitle.trim() === '' || saving} on:click={create}>{t('Save')}</button>
        <button type='button' class='btn btn-secondary btn-sm' on:click={() => showNew = false}>{t('Cancel')}</button>
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
          <label class='sr-only' for={`orderTemplateEditBody-${template.id}`}>{t('Text')}</label>
          <textarea id={`orderTemplateEditBody-${template.id}`} class='form-control mb-2' rows='8' bind:value={editBody}></textarea>
          <button type='button' class='btn btn-primary btn-sm mr-1' disabled={editTitle.trim() === '' || saving} on:click={() => saveEdit(template)}>{t('Save')}</button>
          <button type='button' class='btn btn-secondary btn-sm' on:click={() => editingId = null}>{t('Cancel')}</button>
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
            <pre class='order-template-body mb-1' class:collapsed={isLong(template.body) && !expandedIds.has(template.id)}>{template.body}</pre>
            {#if isLong(template.body)}
              <button type='button' class='btn btn-link btn-sm p-0' on:click={() => toggleExpanded(template.id)}>
                {expandedIds.has(template.id) ? t('Show less') : t('Show all')}
              </button>
            {/if}
          {:else}
            <p class='text-muted mb-0'>{t('This template has no text.')}</p>
          {/if}
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .order-templates-search {
    max-width: 20rem;
  }

  .order-template-body {
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 0.95rem;
    margin-bottom: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .order-template-body.collapsed {
    -webkit-box-orient: vertical;
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    overflow: hidden;
  }
</style>
