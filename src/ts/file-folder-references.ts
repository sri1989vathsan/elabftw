/** Plain-text file and folder references stored in existing entity metadata. */
import { ApiC } from './api';
import { entity } from './getEntity';
import type { FileFolderReference, ValidMetadata } from './metadataInterfaces';
import { reloadElements } from './misc';

const ID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;
const MAX_REFERENCE_LENGTH = 1000;
const MAX_REFERENCES_PER_ADD = 100;

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
  await reloadElements(['filesFoldersLinksSection']);
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

export async function deleteFileFolderReference(id: string): Promise<void> {
  if (!ID_PATTERN.test(id)) return;
  const metadata = await readMetadata();
  metadata.elabftw.file_folder_references = metadata.elabftw.file_folder_references
    .filter(reference => reference.id !== id);
  await saveMetadata(metadata);
}
