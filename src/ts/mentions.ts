/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { escapeHTML, escapeRegExp } from './misc';

// A plain-text "@" mention helper shared by the to-do (sidebar + project
// management) and orders comment boxes. While composing, a mention is
// just plain "@Full Name " text in the draft (the comment box is a plain
// <input>, which can't render rich content) -- the mentioned user's id is
// tracked separately alongside the draft and sent as mentioned_userids so
// the backend can create a notification. Only once posted does
// wrapMentionsAsHtml() turn "@Full Name" into a <span> the comment
// display can render as a pill; see Filter::commentBody() (only sanitizer
// allowed to keep that span) for the other half of this.

// Returns the partial name being typed after a trailing, unfinished "@..."
// at the end of the text, or null if the cursor isn't in a mention.
export function extractMentionQuery(text: string): string | null {
  const match = text.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1] : null;
}

// Replaces the trailing "@query" with "@Full Name " (note the trailing
// space, so typing can continue right after).
export function applyMention(text: string, query: string, fullname: string): string {
  const atIndex = text.length - query.length - 1;
  return `${text.slice(0, atIndex)}@${fullname} `;
}

/**
 * Escapes the plain-text draft, then wraps every "@Full Name" that
 * matches a real team member in a <span class="elabftw-mention"> pill --
 * called right before posting/saving a comment, never while typing.
 * Longest names first so e.g. "@Jo" doesn't shadow "@Jo Smith".
 */
export function wrapMentionsAsHtml(text: string, teamMembers: { fullname: string }[]): string {
  let result = escapeHTML(text);
  const sorted = [...teamMembers].sort((a, b) => b.fullname.length - a.fullname.length);
  for (const member of sorted) {
    const escapedName = escapeHTML(member.fullname);
    const pattern = new RegExp(`@${escapeRegExp(escapedName)}(?=\\s|$)`, 'g');
    result = result.replace(pattern, `<span class="elabftw-mention">@${escapedName}</span>`);
  }
  return result;
}

/**
 * The inverse of wrapMentionsAsHtml(), for populating a plain-text edit
 * draft from an already-posted (and possibly mention-wrapped) comment
 * body -- otherwise the raw <span> markup would show up as literal text
 * in the edit input.
 */
export function stripMentionHtml(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.textContent ?? '';
}
