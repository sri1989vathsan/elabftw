/** Web references stored in existing entity metadata. */
import { ApiC } from './api';
import { entity } from './getEntity';
import type { ValidMetadata, WebLink } from './metadataInterfaces';
import { reloadElements } from './misc';

const ID_PATTERN = /^[a-zA-Z0-9-]{1,80}$/;
const MAX_URL_LENGTH = 2000;
const MAX_LABEL_LENGTH = 500;

async function readMetadata(): Promise<ValidMetadata> {
  const json = await ApiC.getJson(`${entity.type}/${entity.id}`);
  const metadata = json.metadata ? JSON.parse(json.metadata) : {};
  metadata.extra_fields ??= {};
  metadata.elabftw ??= {};
  metadata.elabftw.web_links ??= [];
  return metadata as ValidMetadata;
}

async function saveMetadata(metadata: ValidMetadata): Promise<void> {
  await ApiC.patch(`${entity.type}/${entity.id}`, {
    metadata: JSON.stringify(metadata),
  });
  await reloadElements(['webLinksSection']);
}

export function normalizeWebLinkUrl(input: string): string {
  let candidate = input.trim();
  if (!candidate) throw new Error('Enter a web address');
  if (candidate.length > MAX_URL_LENGTH) {
    throw new Error(`The web address must be ${MAX_URL_LENGTH} characters or fewer`);
  }
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Enter a valid web address');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS web links are supported');
  }
  return url.toString();
}

export async function createWebLink(urlInput: string, labelInput = ''): Promise<WebLink> {
  const url = normalizeWebLinkUrl(urlInput);
  const label = labelInput.trim() || url;
  if (label.length > MAX_LABEL_LENGTH) {
    throw new Error(`The link label must be ${MAX_LABEL_LENGTH} characters or fewer`);
  }

  const metadata = await readMetadata();
  const webLink = {id: crypto.randomUUID(), label, url};
  metadata.elabftw.web_links.push(webLink);
  await saveMetadata(metadata);
  return webLink;
}

export async function deleteWebLink(id: string): Promise<void> {
  if (!ID_PATTERN.test(id)) return;
  const metadata = await readMetadata();
  metadata.elabftw.web_links = metadata.elabftw.web_links.filter(link => link.id !== id);
  await saveMetadata(metadata);
}
