/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { ApiC } from './api';
import { Model } from './interfaces';
import { escapeHTML } from './misc';

type LinkPreviewResponse = {
  hostname: string;
  title: string | null;
};

/**
 * A bare URL pasted into a rich-text field is turned into an anchor badge
 * showing the page's title (most sites already bake their own name into
 * it, e.g. "Addgene: pCALNL-GFP" -- prepending the hostname again would
 * just repeat that), falling back to the hostname if no title could be
 * fetched, or the fetch fails outright -- a link preview is a nicety,
 * never something that should block a paste. Callers insert the returned
 * HTML at the current selection, e.g. via
 * `document.execCommand('insertHTML', false, html)`.
 */
export async function buildLinkPreviewHtml(url: string): Promise<string> {
  const escapedUrl = escapeHTML(url);
  const fallback = `<a href="${escapedUrl}" target="_blank" rel="noreferrer noopener">${escapedUrl}</a>`;
  try {
    const preview = await ApiC.getJson(`${Model.LinkPreview}?url=${encodeURIComponent(url)}`) as LinkPreviewResponse;
    const label = preview.title || preview.hostname;
    // no icon: Filter::body()'s HTMLPurifier allowlist doesn't include a
    // bare <i> element, so one here would just get silently stripped on
    // save -- and elabftw-link-preview must stay in Filter::body()'s
    // Attr.AllowedClasses (src/Services/Filter.php) or this class gets
    // stripped too, leaving a plain unstyled link.
    return `<a href="${escapedUrl}" target="_blank" rel="noreferrer noopener" class="elabftw-link-preview">${escapeHTML(label)}</a>`;
  } catch {
    return fallback;
  }
}

/**
 * Plain-text page title (or the hostname, if no title could be fetched)
 * -- for a plain string field like a weblink's label, not a rich-text
 * one, so no HTML markup here.
 */
export async function fetchLinkPreviewLabel(url: string): Promise<string> {
  try {
    const preview = await ApiC.getJson(`${Model.LinkPreview}?url=${encodeURIComponent(url)}`) as LinkPreviewResponse;
    return preview.title || preview.hostname;
  } catch {
    return url;
  }
}

export const BARE_URL_PATTERN = /^https?:\/\/\S+$/i;

/** Upgrade pasted bare links after insertion, without changing destinations. */
export async function upgradeNoteLinks(root: HTMLElement): Promise<void> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest('a, code, pre')) nodes.push(node);
  }
  for (const node of nodes) {
    const text = node.data;
    const matches = [...text.matchAll(/(?:https?:\/\/|www\.)[^\s<>]+/gi)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const label = match[0].replace(/[.,;!?)\]]+$/, '');
      fragment.append(text.slice(offset, match.index));
      const anchor = document.createElement('a');
      anchor.href = /^www\./i.test(label) ? `https://${label}` : label;
      anchor.textContent = label;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      fragment.append(anchor);
      offset = match.index + label.length;
    }
    fragment.append(text.slice(offset));
    node.replaceWith(fragment);
  }
  const requests = new Map<string, Promise<string>>();
  // Sequential lookups keep large notes from flooding the preview service.
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (!root.isConnected) break;
    if (!root.contains(anchor) || anchor.hasAttribute('data-link-preview-pending')) continue;
    const url = anchor.href;
    const originalLabel = anchor.textContent ?? '';
    if (!/^https?:\/\//i.test(url)
      || !/^(?:https?:\/\/|www\.)\S+$/i.test(originalLabel.trim())) continue;
    if (!requests.has(url)) requests.set(url, fetchLinkPreviewLabel(url));
    const label = await requests.get(url)!;
    // A lookup must not overwrite edits made while it was in flight.
    if (!root.isConnected || !root.contains(anchor) || anchor.href !== url
      || anchor.textContent !== originalLabel) continue;
    anchor.textContent = label;
    anchor.classList.add('elabftw-link-preview');
    root.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * Paste handler for a rich-text (contenteditable) field: if what's on the
 * clipboard is JUST a bare http(s) URL (nothing else pasted alongside it),
 * replace the default paste with a link-preview badge. Anything else
 * (regular text, a URL mixed with other text, an image, ...) falls
 * through to the field's normal paste behavior untouched.
 *
 * The title lookup is a server round-trip that itself fetches the external
 * page, so it can take a noticeable moment -- long enough that waiting for
 * it before inserting anything made a paste feel stuck. Insert the plain
 * link immediately instead, then swap in the titled version once the
 * lookup resolves, in the background.
 */
export function handleLinkPreviewPaste(event: ClipboardEvent, el: HTMLElement): void {
  const text = event.clipboardData?.getData('text/plain').trim() ?? '';
  if (!BARE_URL_PATTERN.test(text)) return;
  event.preventDefault();
  el.focus();
  const escapedUrl = escapeHTML(text);
  const pendingId = `link-preview-pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  document.execCommand(
    'insertHTML',
    false,
    `<a href="${escapedUrl}" target="_blank" rel="noreferrer noopener" data-link-preview-pending="${pendingId}">${escapedUrl}</a>`,
  );
  void upgradeLinkPreview(text, pendingId);
}

/**
 * Looks up the pasted-in placeholder anchor by its one-off marker (rather
 * than holding a direct element reference) so a stale lookup harmlessly
 * finds nothing if the anchor was since edited, undone, or removed --
 * across however many other notes fields exist elsewhere on the same page.
 */
async function upgradeLinkPreview(url: string, pendingId: string): Promise<void> {
  const selector = `[data-link-preview-pending="${pendingId}"]`;
  if (!document.querySelector(selector)) return;
  try {
    const preview = await ApiC.getJson(`${Model.LinkPreview}?url=${encodeURIComponent(url)}`) as LinkPreviewResponse;
    const anchor = document.querySelector<HTMLAnchorElement>(selector);
    if (!anchor) return;
    anchor.textContent = preview.title || preview.hostname;
    anchor.classList.add('elabftw-link-preview');
    anchor.removeAttribute('data-link-preview-pending');
  } catch {
    document.querySelector<HTMLAnchorElement>(selector)?.removeAttribute('data-link-preview-pending');
  }
}
