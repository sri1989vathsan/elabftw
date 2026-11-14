/**
 * What the cloning tools do with a plasmid they made: open it as a new tab (it knows the plasmids it was made from), or download it as a
 * GenBank file with a COMMENT line that names them. Exposed as window.CloningOutput.offer(card, spec) with
 * spec = {name, genbank(fileName) -> text, parents: [{id, name}]}, and window.CloningOutput.download(fileName, text).
 */
(function () {
  'use strict';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  function download(fileName, text) {
    const link = element('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 1000);
  }

  // the plasmids it was made from, once each (by tab, or by name for a file)
  function distinctParents(parents) {
    const seen = {};
    return (parents || []).filter(function (parent) {
      const key = parent.id || 'name:' + parent.name;
      if (seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
  }

  // a GenBank text with a COMMENT line before the features
  function withComment(text, comment) {
    const line = 'COMMENT     ' + comment + '\n';
    if (/^FEATURES/m.test(text)) {
      return text.replace(/^FEATURES/m, line + 'FEATURES');
    }
    return text.replace(/^ORIGIN/m, line + 'ORIGIN');
  }


  // a line about a construct: its size, its features and its primers
  function constructInfo(sequence, features) {
    const list = Object.keys(features || {}).map(function (key) {
      return features[key];
    });
    const primers = list.filter(function (feature) {
      return feature.type === 'primer_bind';
    });
    const others = list.filter(function (feature) {
      return feature.type !== 'primer_bind';
    });
    return sequence.length.toLocaleString('en') + ' bp, ' + others.length + ' feature' + (others.length === 1 ? '' : 's') + (others.length ? ' (' + others.slice(0, 6).map(function (feature) {
      return feature.name;
    }).join(', ') + (others.length > 6 ? ', …' : '') + ')' : '') + (primers.length ? ', with ' + primers.length + ' primers attached' : '') + '.';
  }

  function offer(card, spec) {
    const parents = distinctParents(spec.parents);
    const form = element('div', 'tool-card');
    const name = element('input', 'tools-select');
    name.type = 'text';
    name.value = spec.name;
    const message = element('div', 'tool-muted');
    const safe = function () {
      return name.value.trim().replace(/[^A-Za-z0-9_.+() -]+/g, '_').slice(0, 60) || 'plasmid';
    };
    const text = function () {
      const base = spec.genbank(safe().replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40));
      return parents.length > 0 ? withComment(base, 'Made from: ' + parents.map(function (parent) {
        return parent.name;
      }).join(', ') + '.') : base;
    };
    const open = element('button', 'tool-btn tool-btn-primary', 'View the plasmid (new tab)');
    open.type = 'button';
    const show = async function () {
      try {
        const results = await window.bioParsers.anyToJson(text(), { fileName: safe() + '.gb' });
        window.CloningDocs.open(results[0].parsedSequence, safe(), { parents: parents });
        message.textContent = 'Opened' + (parents.length ? ', made from ' + parents.map(function (parent) {
          return parent.name;
        }).join(', ') : '') + '.';
      } catch (error) {
        message.textContent = error.message || String(error);
      }
    };
    open.addEventListener('click', show);
    const save = element('button', 'tool-btn', 'Download as GenBank');
    save.type = 'button';
    save.addEventListener('click', function () {
      download(safe() + '.gb', text());
      message.textContent = 'Downloaded ' + safe() + '.gb.';
    });
    const heading = element('strong', '', spec.title || 'Final plasmid');
    form.append(heading);
    if (spec.info) {
      form.append(element('div', 'tool-muted', spec.info));
    }
    form.append(element('div', 'tool-muted', 'Name'), name);
    if (spec.primers && spec.primers.length > 0) {
      form.append(element('div', 'tool-muted', 'Primers attached (5\' to 3\'):'));
      spec.primers.forEach(function (primer) {
        const row = element('div', 'tool-muted');
        row.append(element('strong', '', primer.name + ' (' + primer.sequence.length + ' b)'));
        const bases = element('div', 'tools-out', primer.sequence);
        bases.style.wordBreak = 'break-all';
        bases.style.userSelect = 'all';
        const copy = element('button', 'tool-btn', 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', function () {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(primer.sequence).then(function () {
              copy.textContent = 'Copied';
            });
          }
        });
        row.append(bases, copy);
        form.append(row);
      });
    }
    if (parents.length > 0) {
      form.append(element('div', 'tool-muted', 'Made from: ' + parents.map(function (parent) {
        return parent.name;
      }).join(', ')));
    }
    form.append(element('div', 'tool-actions'), message);
    const canOpen = Boolean(window.CloningDocs && typeof window.CloningDocs.open === 'function');
    if (canOpen) {
      form.querySelector('.tool-actions').append(open);
    }
    form.querySelector('.tool-actions').append(save);
    // where the editor runs inside a system that keeps plasmids (eLabFTW), it sets window.CloningOutput.saveTarget = {label, save(spec, genbankText)}:
    // the plasmid, its parents (with the ids of their tabs or entries) and its primers go there with one more button
    const target = window.CloningOutput.saveTarget;
    if (target && typeof target.save === 'function') {
      // target.controls(form) may add choices (where it goes ...) and returns a function that gives their values
      const settings = typeof target.controls === 'function' ? target.controls(form, spec) : function () {
        return {};
      };
      const send = element('button', 'tool-btn tool-btn-primary', target.label || 'Save');
      send.type = 'button';
      send.addEventListener('click', async function () {
        send.disabled = true;
        message.textContent = 'Saving…';
        try {
          message.textContent = (await target.save(Object.assign({}, spec, { name: safe(), parents: parents }), text(), settings())) || 'Saved.';
        } catch (error) {
          message.textContent = error.message || String(error);
          send.disabled = false;
        }
      });
      form.querySelector('.tool-actions').prepend(send);
    }
    card.append(form);
    // the new plasmid is shown at once, in its own tab, with its map, features and primers
    if (spec.autoOpen !== false && canOpen) {
      show();
    }
  }

  window.CloningOutput = { offer: offer, download: download, info: constructInfo };
})();
