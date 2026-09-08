import { ApiC } from './api';
import { entity } from './getEntity';
import type { ValidMetadata, WebLink } from './metadataInterfaces';
import { reloadElements } from './misc';

const LABCOLLECTOR_TYPES = new Set([
  'plasmids',
  'strains',
  'chemicals',
  'samples',
  'antibodies',
  'storage',
]);

const LABCOLLECTOR_LINK_ID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;

export function buildLabCollectorUrl(type: string, id: string): string {
  if (!LABCOLLECTOR_TYPES.has(type) || !/^[1-9]\d*$/.test(id)) {
    throw new Error('Invalid LabCollector link');
  }
  const url = new URL(`http://bs-labcollect01.ethz.ch/moor/${type}.php`);
  url.searchParams.set('search', '1');
  url.searchParams.set('strict', 'on');
  url.searchParams.set('by_id', id);
  return url.toString();
}

/**
 * Look up a record's real name and storage location via the team's
 * configured LabCollector API (see LabCollectorClient::getSummary()).
 * Shared by both entry points that can insert a LabCollector link: the
 * helper box below an experiment's metadata, and the TinyMCE Insert-menu
 * dialog. Returns null (rather than throwing) whenever LabCollector isn't
 * configured, unreachable, or the record has no recognizable name -- callers
 * fall back to a bare id reference in that case.
 */
export async function lookupLabCollectorRecord(module: string, id: string): Promise<{ name: string; storage: string } | null> {
  try {
    const response = await fetch(`/labcollector-lookup.php?module=${encodeURIComponent(module)}&id=${encodeURIComponent(id)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const json = await response.json();
    return json.name ? json : null;
  } catch {
    return null;
  }
}

/**
 * Record a LabCollector link in the entity's metadata (mirrors web-links.ts)
 * so it shows up in the "LabCollector links" section of the Links panel,
 * the same way an inserted web link does -- regardless of which of the
 * three entry points (helper box's two buttons, TinyMCE Insert-menu dialog)
 * created it.
 */
export async function createLabCollectorLink(label: string, url: string): Promise<WebLink> {
  const json = await ApiC.getJson(`${entity.type}/${entity.id}`);
  const metadata = (json.metadata ? JSON.parse(json.metadata) : {}) as ValidMetadata;
  metadata.extra_fields ??= {};
  metadata.elabftw ??= {};
  metadata.elabftw.labcollector_links ??= [];
  const link = {id: crypto.randomUUID(), label, url};
  metadata.elabftw.labcollector_links.push(link);
  await ApiC.patch(`${entity.type}/${entity.id}`, { metadata: JSON.stringify(metadata) });
  await reloadElements(['labcollectorLinksSection']);
  return link;
}

export async function deleteLabCollectorLink(id: string): Promise<void> {
  if (!LABCOLLECTOR_LINK_ID_PATTERN.test(id)) return;
  const json = await ApiC.getJson(`${entity.type}/${entity.id}`);
  const metadata = (json.metadata ? JSON.parse(json.metadata) : {}) as ValidMetadata;
  metadata.extra_fields ??= {};
  metadata.elabftw ??= {};
  metadata.elabftw.labcollector_links = (metadata.elabftw.labcollector_links ?? []).filter(link => link.id !== id);
  await ApiC.patch(`${entity.type}/${entity.id}`, { metadata: JSON.stringify(metadata) });
  await reloadElements(['labcollectorLinksSection']);
}
