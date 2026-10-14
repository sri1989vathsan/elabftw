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

/** Adds the "@" suggestion list to the new-comment box. Safe to call again after a reload. */
export function initCommentMentions(): void {
  const area = document.getElementById('commentsCreateArea') as HTMLTextAreaElement | null;
  if (!area || area.dataset.mentionsReady === '1') {
    return;
  }
  area.dataset.mentionsReady = '1';
  const group = area.parentElement as HTMLElement;
  group.style.position = 'relative';
  const list = document.createElement('ul');
  list.className = 'pm-mention-results';
  list.hidden = true;
  group.append(list);

  const hide = () => {
    list.hidden = true;
    list.replaceChildren();
  };

  area.addEventListener('input', async () => {
    const query = extractMentionQuery(area.value);
    if (query === null) {
      hide();
      return;
    }
    const lowered = query.toLowerCase();
    const matches = (await getMembers()).filter(m => m.fullname.toLowerCase().includes(lowered)).slice(0, 8);
    if (matches.length === 0) {
      hide();
      return;
    }
    list.replaceChildren(...matches.map(member => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-ghost pm-mention-result';
      button.textContent = member.fullname;
      // mousedown, so the textarea keeps its focus and the list does not vanish first
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        area.value = applyMention(area.value, query, member.fullname);
        picked.set(member.fullname, member.userid);
        hide();
        area.focus();
      });
      item.append(button);
      return item;
    }));
    list.hidden = false;
  });
  area.addEventListener('blur', () => setTimeout(hide, 150));
}
