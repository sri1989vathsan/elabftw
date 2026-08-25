/** Optional workstation-local folder shortcuts stored in entity metadata. */
import { ApiC } from './api';
import { entity } from './getEntity';
import type { LocalFolderLink, ValidMetadata } from './metadataInterfaces';
import { reloadElements } from './misc';

const SCHEME = 'elabftw-folder';
const ID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;

async function readMetadata(): Promise<ValidMetadata> {
  const json = await ApiC.getJson(`${entity.type}/${entity.id}`);
  const metadata = json.metadata ? JSON.parse(json.metadata) : {};
  metadata.extra_fields ??= {};
  metadata.elabftw ??= {};
  metadata.elabftw.local_folder_links ??= [];
  return metadata as ValidMetadata;
}

async function saveMetadata(metadata: ValidMetadata): Promise<void> {
  await ApiC.patch(`${entity.type}/${entity.id}`, {
    metadata: JSON.stringify(metadata),
  });
  await reloadElements(['filesFoldersLinksSection']);
}

export function localFolderUrl(id: string, action: 'open' | 'register' = 'open'): string {
  if (!ID_PATTERN.test(id)) throw new Error('Invalid local folder shortcut');
  return `${SCHEME}://${action}/${encodeURIComponent(id)}`;
}

export function openLocalFolder(id: string, action: 'open' | 'register' = 'open'): void {
  window.location.href = localFolderUrl(id, action);
}

export async function createLocalFolderLink(name: string): Promise<LocalFolderLink> {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('Enter a folder name');
  if (cleanName.length > 200) throw new Error('Folder name is too long');

  const metadata = await readMetadata();
  const link: LocalFolderLink = {
    id: crypto.randomUUID(),
    name: cleanName,
  };
  metadata.elabftw.local_folder_links.push(link);
  await saveMetadata(metadata);
  return link;
}

export async function deleteLocalFolderLink(id: string): Promise<void> {
  if (!ID_PATTERN.test(id)) return;
  const metadata = await readMetadata();
  metadata.elabftw.local_folder_links = metadata.elabftw.local_folder_links
    .filter(link => link.id !== id);
  await saveMetadata(metadata);
}
