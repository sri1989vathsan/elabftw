/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import $ from 'jquery';
import tinymce from 'tinymce/tinymce';
import { getTinymceBaseConfig } from './tinymce';
import { marked } from 'marked';
import type { MathJaxObject } from '@mathjax/src/js/components/startup.js';
import { Target } from './interfaces';
import type { Entity } from './interfaces';
import { ApiC } from './api';
declare const MathJax: MathJaxObject;

interface EditorInterface {
  type: string;
  typeAsInt: number;
  init(page: string): void;
  getContent(): string;
  setContent(content: string): void;
  switch(entity: Entity): Promise<Response>;
  replaceContent(content: string): void;
}

// Convert the content along with the content_type in the same request:
// computing "current" content server-side (from entityData at the start of
// the request) is fragile against anything else that might also PATCH the
// body around the same time, whereas the editor always knows its own
// up-to-the-moment content directly.
function elementToMarkdown(el: Element): string {
  let out = '';
  el.childNodes.forEach(node => {
    out += nodeToMarkdown(node);
  });
  return out;
}

function listToMarkdown(list: Element, ordered: boolean): string {
  let out = '';
  let i = 1;
  Array.from(list.children).forEach(child => {
    if (child.tagName.toLowerCase() === 'li') {
      const prefix = ordered ? `${i}. ` : '- ';
      out += prefix + elementToMarkdown(child).trim() + '\n';
      i++;
    }
  });
  return out + '\n';
}

function nodeToMarkdown(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    return '#'.repeat(parseInt(tag[1], 10)) + ' ' + elementToMarkdown(el).trim() + '\n\n';
  }
  const inner = elementToMarkdown(el);
  switch (tag) {
    case 'br':
      return '  \n';
    case 'p':
    case 'div':
      return inner.trim() + '\n\n';
    case 'strong':
    case 'b':
      return '**' + inner.trim() + '**';
    case 'em':
    case 'i':
      return '_' + inner.trim() + '_';
    case 'a':
      return `[${inner.trim()}](${el.getAttribute('href') ?? ''})`;
    case 'img':
      return `![${el.getAttribute('alt') ?? ''}](${el.getAttribute('src') ?? ''})`;
    case 'pre':
      return '```\n' + inner.trim() + '\n```\n\n';
    case 'code':
      return el.parentElement?.tagName.toLowerCase() === 'pre' ? inner : '`' + inner.trim() + '`';
    case 'blockquote':
      return '> ' + inner.trim().replace(/\n/g, '\n> ') + '\n\n';
    case 'ul':
      return listToMarkdown(el, false);
    case 'ol':
      return listToMarkdown(el, true);
    case 'li':
      return inner.trim();
    default:
      return inner;
  }
}

// only covers the formatting the markdown editor's own (restricted) toolbar
// can produce -- bold, italic, headings, links, images, lists, code, quotes
function htmlToMarkdown(html: string): string {
  if (html.trim() === '') {
    return '';
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return elementToMarkdown(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}

class Editor {
  type: string;
  typeAsInt: number;
}

class TinyEditor extends Editor implements EditorInterface {
  constructor() {
    super();
    this.type = 'tiny';
    this.typeAsInt = 1;
  }
  init(page: string = 'edit'): void {
    tinymce.init(getTinymceBaseConfig(page));
  }
  getContent(): string {
    return tinymce.activeEditor.getContent();
  }
  setContent(content: string): void {
    tinymce.get(0).insertContent(content);
  }
  replaceContent(content: string): void {
    tinymce.get(0).setContent(content);
  }
  switch(entity: Entity): Promise<Response> {
    const params = {};
    params[Target.ContentType] = 2;
    params[Target.Body] = htmlToMarkdown(this.getContent());
    return ApiC.patch(`${entity.type}/${entity.id}`, params);
  }
}

export class MdEditor extends Editor implements EditorInterface {
  constructor() {
    super();
    this.type = 'md';
    this.typeAsInt = 2;
  }
  switch(entity: Entity): Promise<Response> {
    const params = {};
    params[Target.ContentType] = 1;
    params[Target.Body] = marked(this.getContent()) as string;
    return ApiC.patch(`${entity.type}/${entity.id}`, params);
  }
  init(): void {
    /* eslint-disable-next-line */
    ($('.markdown-textarea') as any).markdown({
      hiddenButtons: ['cmdPreview'],
      onPreview: ed => {
        const html = marked(ed.$textarea.val()) as string;

        window.setTimeout(() => {
          void MathJax.typesetPromise().catch(error => {
            console.error('Markdown preview MathJax error:', error);
          });
        }, 0);

        return html;
      },
    });
  }
  getContent(): string {
    return (document.getElementById('body_area') as HTMLTextAreaElement).value;
  }
  setContent(content: string): void {
    const cursorPosition = $('#body_area').prop('selectionStart');
    const oldcontent = ($('#body_area').val() as string);
    const before = oldcontent.substring(0, cursorPosition);
    const after = oldcontent.substring(cursorPosition);
    $('#body_area').val(before + content + after);
  }
  replaceContent(content: string): void {
    $('#body_area').val(content);
  }
}

export function getEditor(): EditorInterface {
  if (document.getElementById('entityBodyEditorDiv')) {
    return document.getElementById('entityBodyEditorDiv').dataset.contentType === '2' ? new MdEditor() : new TinyEditor();
  }
  return new TinyEditor();
}
