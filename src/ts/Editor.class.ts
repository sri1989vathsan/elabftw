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
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
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

abstract class Editor {
  type: string;
  typeAsInt: number;
  abstract getContent(): string;
  switch(entity: Entity): Promise<Response> {
    const switchingToMarkdown = this.type === 'tiny';
    const currentBody = this.getContent();
    const body = switchingToMarkdown
      ? htmlToMarkdown(currentBody)
      : markdownToHtml(currentBody);
    return ApiC.patch(`${entity.type}/${entity.id}`, {
      [Target.Body]: body,
      [Target.ContentType]: switchingToMarkdown ? 2 : 1,
    });
  }
}

/**
 * Convert normal rich text to readable Markdown while retaining eLabFTW's
 * structured widgets as raw HTML. Markdown supports embedded HTML, so these
 * blocks remain intact and become editable widgets again after switching
 * back to TinyMCE instead of losing formula/style data in a lossy conversion.
 */
export function htmlToMarkdown(html: string): string {
  const converter = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    headingStyle: 'atx',
    strongDelimiter: '**',
  });
  converter.keep(node => {
    if (!(node instanceof HTMLElement)) return false;
    return node.matches([
      // Formula spreadsheets need their encoded data and inline appearance.
      // Ordinary tables must not be kept here: retaining every <table>
      // caused otherwise-normal editor content to appear as one large HTML
      // embed after switching to Markdown.
      'table.elabftw-spreadsheet',
      '.elabftw-note-block',
      '.elabftw-date-reference',
      '[id^="experiment-title-"]',
      'hr[class*="elabftw-"]',
      'details',
      'figure',
      'audio',
      'video',
      'iframe',
    ].join(','));
  });
  return converter.turndown(html).trim();
}

/** Render Markdown before changing the stored content type to HTML. */
export function markdownToHtml(markdown: string): string {
  const rendered = marked.parse(normalizeCompactHeadings(markdown)) as string;
  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
  });
}

/**
 * Accept compact ATX headings such as `####Heading` in addition to the
 * CommonMark form `#### Heading`. Do not rewrite examples inside fenced code.
 */
export function normalizeCompactHeadings(markdown: string): string {
  let fenceMarker = '';
  return markdown.split('\n').map(line => {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1].charAt(0);
      if (!fenceMarker) {
        fenceMarker = marker;
      } else if (fenceMarker === marker) {
        fenceMarker = '';
      }
      return line;
    }
    if (fenceMarker) return line;
    return line.replace(/^( {0,3}#{1,6})(?=[^#\s])/, '$1 ');
  }).join('\n');
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
}

export class MdEditor extends Editor implements EditorInterface {
  constructor() {
    super();
    this.type = 'md';
    this.typeAsInt = 2;
  }
  init(): void {
    /* eslint-disable-next-line */
    ($('.markdown-textarea') as any).markdown({
      onPreview: ed => {
        const html = marked(normalizeCompactHeadings(ed.$textarea.val())) as string;

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
