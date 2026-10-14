/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { ApiC } from './api';
import { applyMention, extractMentionQuery } from './mentions';

// @-mentions in the comments of experiments, templates and resources.
// The new-comment box stays a plain textarea: picking a name inserts
// "@Full Name " and remembers the user id, which is sent along with the
// comment so the backend can notify that person. Posted comments are
// plain text; the "@Full Name" parts are turned into pills on display.

type Member = { userid: number; fullname: string };

let members: Member[] | null = null;
const picked = new Map<string, number>();

async function getMembers(): Promise<Member[]> {
  if (members === null) {
    try {
      members = await ApiC.getJson('users?currentTeam=1') as Member[];
    } catch {
      members = [];
    }
  }
  return members;
}

/** The ids of the people picked from the list whose "@Name" is still in the text. */
export function mentionedUserids(text: string): number[] {
  const ids: number[] = [];
  for (const [name, id] of picked) {
    if (text.includes(`@${name}`)) {
      ids.push(id);
    }
  }
  picked.clear();
  return ids;
}

/** Wraps "@Full Name" of team members in already rendered comments into pills. */
export async function decorateMentions(root: ParentNode = document): Promise<void> {
  const comments = root.querySelectorAll<HTMLElement>('#commentsDiv .comment');
  if (comments.length === 0) {
    return;
  }
  const names = (await getMembers()).map(m => m.fullname).sort((a, b) => b.length - a.length);
  if (names.length === 0) {
    return;
  }
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`@(${escaped.join('|')})(?=\\s|$|[.,;:!?])`, 'g');
  comments.forEach(comment => {
    const walker = document.createTreeWalker(comment, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) {
      texts.push(walker.currentNode as Text);
    }
    texts.forEach(node => {
      if (node.parentElement?.classList.contains('elabftw-mention') || !node.data.includes('@')) {
        return;
      }
      pattern.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(node.data)) !== null) {
        fragment.append(node.data.slice(last, match.index));
        const pill = document.createElement('span');
        pill.className = 'elabftw-mention';
        pill.textContent = match[0];
        fragment.append(pill);
        last = match.index + match[0].length;
      }
      if (last === 0) {
        return;
      }
      fragment.append(node.data.slice(last));
      node.replaceWith(fragment);
    });
  });
}

const MENTION_FIELDS = '#commentsCreateArea, #addStepInput';
let delegated = false;

function listFor(field: HTMLInputElement | HTMLTextAreaElement): HTMLUListElement {
  const group = field.parentElement as HTMLElement;
  let list = group.querySelector<HTMLUListElement>(':scope > .pm-mention-results');
  if (!list) {
    group.style.position = 'relative';
    list = document.createElement('ul');
    list.className = 'pm-mention-results';
    list.hidden = true;
    group.append(list);
  }
  return list;
}

/**
 * Adds the "@" suggestion list to the new-comment box and the add-a-step
 * box. Listens on the document, so it also covers fields that are drawn
 * again after a reload; safe to call more than once.
 */
export function initCommentMentions(): void {
  if (delegated) {
    return;
  }
  delegated = true;
  const hide = (list: HTMLUListElement) => {
    list.hidden = true;
    list.replaceChildren();
  };
  document.addEventListener('input', async event => {
    const field = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (!(field instanceof Element) || !field.matches(MENTION_FIELDS)) {
      return;
    }
    const list = listFor(field);
    const query = extractMentionQuery(field.value);
    if (query === null) {
      hide(list);
      return;
    }
    const lowered = query.toLowerCase();
    const matches = (await getMembers()).filter(m => m.fullname.toLowerCase().includes(lowered)).slice(0, 8);
    if (matches.length === 0) {
      hide(list);
      return;
    }
    list.replaceChildren(...matches.map(member => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-ghost pm-mention-result';
      button.textContent = member.fullname;
      // mousedown, so the field keeps its focus and the list does not vanish first
      button.addEventListener('mousedown', mouseEvent => {
        mouseEvent.preventDefault();
        field.value = applyMention(field.value, query, member.fullname);
        picked.set(member.fullname, member.userid);
        hide(list);
        field.focus();
      });
      item.append(button);
      return item;
    }));
    list.hidden = false;
  });
  document.addEventListener('focusout', event => {
    const field = event.target as Element;
    if (field instanceof Element && field.matches(MENTION_FIELDS)) {
      const list = listFor(field as HTMLInputElement);
      setTimeout(() => hide(list), 150);
    }
  });
}
