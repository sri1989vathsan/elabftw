/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */

// A plain-text "@" mention helper shared by the to-do (sidebar + project
// management) and orders comment boxes. Mentions are stored as plain
// "@Full Name " text in the comment body -- the mentioned user's id is
// tracked separately alongside the draft and sent as mentioned_userids so
// the backend can create a notification, without needing any rich-text
// markup in the comment itself.

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
