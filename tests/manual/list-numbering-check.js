/**
 * Typing "N. " at the start of an empty paragraph starts a numbered list at N (<ol start="N">). Open an experiment in edit mode (it is
 * changed, but left unsaved unless you save it), then:
 *   await new Promise(r => { const s = document.createElement('script'); s.src = '/__tests/list-numbering-check.js'; s.onload = r; document.head.appendChild(s); });
 *   await listNumberingCheck();      // {pass, results}
 * (A list typed right under another list is merged into it by the editor and continues its numbering.)
 * Rule: the whole paragraph is "1", "N." or "N)" with N of 1 to 3 digits, the cursor right after it, then Space. "10.5 mg", "2024. text" and
 * a number inside a sentence stay text. Covers: 1. to 3. then a table then 4. gives a list at 4; 7. gives 7; the non-lists; the sanitized
 * saved text and the print copy keep start (the editor's HTML is what is saved and printed; the server filter is in FilterTest).
 * The key presses are real key events dispatched in the editor's document (the shortcut listens for keydown with Space).
 */
window.listNumberingCheck = async function listNumberingCheck() {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const ed = window.tinymce && tinymce.activeEditor;
  if (!ed) return { pass: false, results: [{ name: 'an editor is open', ok: false, detail: 'open an entry in edit mode' }] };
  const saved = ed.getContent();
  // type text into the last paragraph, then press Space (the shortcut runs on keydown and cancels it when it converts)
  const typeAndSpace = (text) => {
    ed.focus();
    const body = ed.getBody();
    const p = body.lastElementChild && body.lastElementChild.tagName === 'P' ? body.lastElementChild : null;
    ed.selection.setCursorLocation(p, 0);
    ed.insertContent(text);
    const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    ed.getBody().dispatchEvent(ev);
    if (!ev.defaultPrevented) ed.insertContent(' ');
  };
  const newPara = () => { ed.getBody().insertAdjacentHTML('beforeend', '<p><br></p>'); };
  try {
    ed.setContent('<p><br></p>');
    typeAndSpace('1.'); ed.insertContent('one'); ed.execCommand('InsertParagraph'); ed.insertContent('two'); ed.execCommand('InsertParagraph'); ed.insertContent('three');
    let ols = ed.getBody().querySelectorAll('ol');
    check('1. starts a list (no start attribute)', ols.length === 1 && !ols[0].hasAttribute('start'), ed.getContent());
    ed.getBody().insertAdjacentHTML('beforeend', '<table><tbody><tr><td>x</td></tr></tbody></table>');
    newPara(); typeAndSpace('4.'); ed.insertContent('four');
    ols = ed.getBody().querySelectorAll('ol');
    check('after a table, 4. starts a second list at 4', ols.length === 2 && ols[1].getAttribute('start') === '4' && ols[1].textContent.trim() === 'four', ed.getContent());
    check('"4." right after a list that ended at 3 is a continuing list (data-continues)', ols[1].hasAttribute('data-continues'), ed.getContent());
    // delete items 1 and 2 above: the continued list follows (4 -> 2), then the whole first list: it starts at 1
    ols[0].querySelectorAll('li')[0].remove(); ols[0].querySelectorAll('li')[0].remove();
    ed.fire('input');
    check('after deleting items 1 and 2 above, the continued list starts at 2', ed.getBody().querySelectorAll('ol')[1].getAttribute('start') === '2', ed.getContent());
    ed.getBody().querySelector('ol').remove(); ed.fire('input');
    { const o = ed.getBody().querySelector('ol'); check('after deleting the whole first list, the continued list starts at 1 (no start attribute)', o && !o.hasAttribute('start'), ed.getContent()); }
    ed.setContent('<ol><li>a</li><li>b</li><li>c</li></ol><p>x</p><ol start="9" data-continues="true"><li>n</li></ol>');
    check('a stored continuing list is renumbered on load (9 -> 4)', ed.getBody().querySelectorAll('ol')[1].getAttribute('start') === '4', ed.getContent());
    ed.setContent('<ol><li>a</li><li>b</li><li>c</li></ol><table><tbody><tr><td>x</td></tr></tbody></table><ol start="4" data-continues="true"><li>four</li></ol><h2>Heading</h2><p><br></p>');
    ols = ed.getBody().querySelectorAll('ol');
    typeAndSpace('7.');
    ols = ed.getBody().querySelectorAll('ol');
    check('"7." that does not follow the previous list keeps a fixed start 7 (no data-continues)', ols.length === 3 && ols[2].getAttribute('start') === '7' && !ols[2].hasAttribute('data-continues'), ed.getContent());
    ed.getBody().querySelector('ol').remove(); ed.fire('input');
    check('a fixed start 7 stays 7 when the lists above are deleted', ed.getBody().querySelectorAll('ol')[1].getAttribute('start') === '7', ed.getContent());
    ed.setContent('<p><br></p>');
    ed.getBody().insertAdjacentHTML('beforeend', '<h2>Heading</h2>'); newPara(); typeAndSpace('7.');
    ols = ed.getBody().querySelectorAll('ol');
    check('7. in an empty paragraph after a heading starts a list at 7', ols.length === 1 && ols[0].getAttribute('start') === '7', ed.getContent());
    ed.setContent('<p><br></p>'); typeAndSpace('10.5');
    check('"10.5 mg" is not converted', !ed.getBody().querySelector('ol') && /10\.5/.test(ed.getBody().textContent), ed.getContent());
    ed.setContent('<p><br></p>'); typeAndSpace('2024.');
    check('"2024. " (year, more than 3 digits) is not converted', !ed.getBody().querySelector('ol'), ed.getContent());
    ed.setContent('<p>Since 2024.</p>');
    { const p = ed.getBody().firstElementChild; ed.selection.setCursorLocation(p.firstChild, p.firstChild.length); ed.getBody().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })); }
    check('"2024. " inside a sentence is not converted', !ed.getBody().querySelector('ol'), ed.getContent());
    ed.setContent('<p><br></p>'); typeAndSpace('5)');
    check('5) starts a list at 5', ed.getBody().querySelector('ol[start="5"]'), ed.getContent());
    ed.setContent('<p><br></p>'); typeAndSpace('3.'); ed.insertContent('x');
    const html = ed.getContent();
    check('the editor content (what is saved) holds <ol start="3">', /<ol start="3">/.test(html), html);
    // print copy: the view page clones the body; a clone keeps the attribute
    const clone = new DOMParser().parseFromString(html, 'text/html').body.cloneNode(true);
    check('a copy of the text (print copy) keeps start="3"', clone.querySelector('ol[start="3"]'), clone.innerHTML);
  } finally { ed.setContent(saved); }
  return { pass: results.every(r => r.ok), results };
};
