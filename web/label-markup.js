/**
 * Mixed styles inside one line of a label: **bold**, *italic*, [big]bigger[/big] and [small]smaller[/small] (1.4 and 0.7 times the size of
 * the line). The same rules are in label-markup.php (the printer side); tests/manual/label-markup-cases.json holds the cases both must agree on.
 *
 * parse(text) gives { pieces: [{ text, bold, italic, scale }], marked, plain }: the pieces in reading order, whether any piece differs from
 * plain text, and the text without markers. Markup that does not add up (a marker opened and not closed, closed twice, big inside small,
 * nothing between the markers) is not markup: the line is plain text, as typed. A backslash before * or [ writes that character
 * (the dialog does this for the values of {fields}, so a value with a * is never read as a marker).
 */
(function (root) {
  'use strict';
  const SCALES = { big: 1.4, small: 0.7 };
  const escapeValue = function (value) {
    return String(value).replace(/([*[])/g, '\\$1');
  };
  const unescape = function (text) {
    return text.replace(/\\([*[])/g, '$1');
  };
  const plainResult = function (text) {
    const plain = unescape(text);
    return { pieces: [{ text: plain, bold: false, italic: false, scale: 1 }], marked: false, plain: plain };
  };
  const parse = function (text) {
    text = String(text);
    if (text.indexOf('*') < 0 && text.indexOf('[') < 0) {
      return { pieces: [{ text: text, bold: false, italic: false, scale: 1 }], marked: false, plain: text };
    }
    let bold = false;
    let italic = false;
    let size = '';
    let buffer = '';
    const pieces = [];
    const flush = function () {
      if (buffer === '') {
        return;
      }
      const piece = { text: buffer, bold: bold, italic: italic, scale: size === '' ? 1 : SCALES[size] };
      const last = pieces[pieces.length - 1];
      if (last && last.bold === piece.bold && last.italic === piece.italic && last.scale === piece.scale) {
        last.text += buffer;
      } else {
        pieces.push(piece);
      }
      buffer = '';
    };
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\' && (text[i + 1] === '*' || text[i + 1] === '[')) {
        buffer += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '*') {
        flush();
        if (text[i + 1] === '*') {
          bold = !bold;
          i += 2;
        } else {
          italic = !italic;
          i += 1;
        }
        continue;
      }
      if (c === '[') {
        const tag = /^\[(\/?)(big|small)\]/i.exec(text.slice(i, i + 9));
        if (tag) {
          const name = tag[2].toLowerCase();
          flush();
          if (tag[1] === '') {
            if (size !== '') {
              return plainResult(text);
            }
            size = name;
          } else {
            if (size !== name) {
              return plainResult(text);
            }
            size = '';
          }
          i += tag[0].length;
          continue;
        }
      }
      buffer += c;
      i += 1;
    }
    flush();
    if (bold || italic || size !== '' || pieces.length === 0) {
      return plainResult(text);
    }
    return {
      pieces: pieces,
      marked: pieces.some(function (p) { return p.bold || p.italic || p.scale !== 1; }),
      plain: pieces.map(function (p) { return p.text; }).join('')
    };
  };
  const api = { parse: parse, escapeValue: escapeValue, SCALES: SCALES };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.labelMarkup = api;
})(typeof window !== 'undefined' ? window : globalThis);
