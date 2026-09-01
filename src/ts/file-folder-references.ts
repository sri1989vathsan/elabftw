/** Plain-text file and folder references stored in existing entity metadata. */
import { ApiC } from './api';
import { entity } from './getEntity';
import type { FileFolderReference, ValidMetadata } from './metadataInterfaces';
import { reloadElements } from './misc';

const ID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;
const MAX_REFERENCE_LENGTH = 1000;
const MAX_REFERENCES_PER_ADD = 100;
const MAX_LABEL_LENGTH = 200;

/**
 * A reference typed/pasted as an smb:// url or a \\server\share UNC path
 * can be opened by the OS's file browser; anything else is just text.
 * Mirrors the same rule in links.html so the clickable list and "insert in
 * main text" stay consistent.
 *
 * host/share/path core shared by both link forms below, e.g. from either
 * "smb://host/share/path" or "\\host\share\path".
 */
function smbCore(text: string): string | null {
  if (text.startsWith('smb://')) return text.slice('smb://'.length);
  if (text.startsWith('\\\\')) return text.slice(2).replaceAll('\\', '/');
  return null;
}

/** Mac/Finder link form. */
export function toSmbHref(text: string): string | null {
  const core = smbCore(text);
  return core === null ? null : `smb://${core}`;
}

/**
 * For contexts where only one link can be embedded (inserting into prose,
 * as opposed to the file/folder list which shows a Mac button and a Windows
 * copy-to-clipboard button side by side): on Mac this can be a real smb://
 * link; on Windows there is no href form that reliably keeps the hostname
 * (file://host/path gets rewritten to file:///path, dropping it, in some
 * browsers), so return null there -- callers fall back to inserting the
 * reference as plain, copyable text.
 */
export function platformSmbHref(text: string): string | null {
  if (navigator.userAgent.includes('Windows')) return null;
  return toSmbHref(text);
}

async function readMetadata(): Promise<ValidMetadata> {
  const json = await ApiC.getJson(`${entity.type}/${entity.id}`);
  const metadata = json.metadata ? JSON.parse(json.metadata) : {};
  metadata.extra_fields ??= {};
  metadata.elabftw ??= {};
  metadata.elabftw.file_folder_references ??= [];
  return metadata as ValidMetadata;
}

async function saveMetadata(metadata: ValidMetadata): Promise<void> {
  await ApiC.patch(`${entity.type}/${entity.id}`, {
    metadata: JSON.stringify(metadata),
  });
  // file/folder references render into two separate sections depending on
  // content: smb://\\server\share ones under Data, everything else under
  // Files / folders (see links.html) -- both need refreshing regardless of
  // which one the just-changed reference actually landed in.
  await reloadElements(['filesFoldersLinksSection', 'dataLinksSection']);
}

export function parseFileFolderReferences(input: string): string[] {
  const references = input
    .split(/\r?\n/)
    .map(reference => reference.trim())
    .filter(Boolean);
  if (references.length === 0) throw new Error('Enter at least one file or folder reference');
  if (references.length > MAX_REFERENCES_PER_ADD) {
    throw new Error(`Add no more than ${MAX_REFERENCES_PER_ADD} references at once`);
  }
  if (references.some(reference => reference.length > MAX_REFERENCE_LENGTH)) {
    throw new Error(`Each reference must be ${MAX_REFERENCE_LENGTH} characters or fewer`);
  }
  return references;
}

export async function createFileFolderReferences(input: string): Promise<FileFolderReference[]> {
  const metadata = await readMetadata();
  const references = parseFileFolderReferences(input).map(text => ({
    id: crypto.randomUUID(),
    text,
  }));
  metadata.elabftw.file_folder_references.push(...references);
  await saveMetadata(metadata);
  return references;
}

/** Single-item add with an optional display label, distinct from the bulk textarea add above. */
export async function createFileFolderReference(text: string, label: string): Promise<FileFolderReference> {
  const trimmedText = text.trim();
  const trimmedLabel = label.trim();
  if (!trimmedText) throw new Error('Enter a file or folder reference');
  if (trimmedText.length > MAX_REFERENCE_LENGTH) {
    throw new Error(`The reference must be ${MAX_REFERENCE_LENGTH} characters or fewer`);
  }
  if (trimmedLabel.length > MAX_LABEL_LENGTH) {
    throw new Error(`The label must be ${MAX_LABEL_LENGTH} characters or fewer`);
  }
  const metadata = await readMetadata();
  const reference: FileFolderReference = {
    id: crypto.randomUUID(),
    text: trimmedText,
    ...(trimmedLabel ? {label: trimmedLabel} : {}),
  };
  metadata.elabftw.file_folder_references.push(reference);
  await saveMetadata(metadata);
  return reference;
}

export async function deleteFileFolderReference(id: string): Promise<void> {
  if (!ID_PATTERN.test(id)) return;
  const metadata = await readMetadata();
  metadata.elabftw.file_folder_references = metadata.elabftw.file_folder_references
    .filter(reference => reference.id !== id);
  await saveMetadata(metadata);
}
