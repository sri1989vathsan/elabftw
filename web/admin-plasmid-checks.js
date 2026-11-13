/**
 * Admin panel, Database tab: exact checks on the plasmids' attached GenBank files (names vs sequence, identical sequences, origin and resistance,
 * restriction sites). No model is used and nothing leaves the server. Fork-only file; the server side is plasmid-checks.php.
 */
(function () {
  'use strict';
  const anchor = document.getElementById('plasmidChecksApp');
  if (!anchor) {
    return;
  }
  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : (anchor.dataset.csrf || '');
  };
  const make = function (tag, attributes, text) {
    const node = document.createElement(tag);
    Object.keys(attributes || {}).forEach(function (key) {
      node.setAttribute(key, attributes[key]);
    });
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  };
  const call = function (body) {
    return fetch('plasmid-checks.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json();
    });
  };
  const link = function (entry) {
    return make('a', { href: 'registry.php?mode=view&id=' + entry.id, target: '_blank', rel: 'noopener' }, entry.title || ('#' + entry.id));
  };
  const table = function (heads, rows) {
    const t = make('table', { class: 'table table-sm w-auto' });
    const hr = make('tr');
    heads.forEach(function (h) {
      hr.append(make('th', {}, h));
    });
    t.append(make('thead').appendChild(hr).parentNode);
    const body = make('tbody');
    rows.forEach(function (cells) {
      const tr = make('tr');
      cells.forEach(function (c) {
        const td = make('td');
        if (c instanceof Node) {
          td.append(c);
        } else {
          td.textContent = String(c);
        }
        tr.append(td);
      });
      body.append(tr);
    });
    t.append(body);
    return t;
  };
  const links = function (entries) {
    const span = make('span');
    entries.forEach(function (e, n) {
      if (n) {
        span.append(', ');
      }
      span.append(link(e));
    });
    return span;
  };

  const box = make('div', { class: 'mt-5' });
  box.append(make('h4', {}, 'Plasmid checks'));
  box.append(make('p', { class: 'text-muted' }, 'Exact checks on the sequence files attached to the plasmids (GenBank .gb / .gbk / .ape). No language model is used.'));
  const out = make('div', { class: 'mt-3' });
  const run = function (button, body, draw) {
    button.disabled = true;
    out.textContent = '';
    out.append(make('div', { class: 'text-muted' }, 'Reading the sequence files...'));
    call(body).then(function (data) {
      button.disabled = false;
      out.textContent = '';
      if (data.error) {
        out.append(make('div', { class: 'alert alert-danger' }, data.message ? data.error + ' ' + data.message : data.error));
        return;
      }
      draw(data);
    }).catch(function () {
      button.disabled = false;
      out.textContent = '';
      out.append(make('div', { class: 'alert alert-danger' }, 'The server did not answer.'));
    });
  };
  const buttons = make('div', { class: 'mb-3' });
  const add = function (label, body, draw) {
    const b = make('button', { type: 'button', class: 'btn btn-secondary mr-2 mb-2' }, label);
    b.addEventListener('click', function () {
      run(b, body, draw);
    });
    buttons.append(b);
  };
  add('Names vs. sequence', { action: 'annotations' }, function (data) {
    out.append(make('p', {}, data.rows.length + ' names mention a part that the sequence file does not label (' + data.checked + ' plasmids checked).'));
    out.append(make('p', { class: 'text-muted' }, '"Not found" is unconfirmed: the check only knows one common version of each gene.'));
    out.append(table(['Plasmid', 'Part in the name', 'Sequence file'], data.rows.map(function (r) {
      return [link(r), r.part, r.status];
    })));
  });
  add('Same sequence, different names', { action: 'duplicates' }, function (data) {
    out.append(make('p', {}, data.groups.length + ' groups of plasmids have an identical sequence under different names. A duplicate entry or a mix-up.'));
    out.append(table(['Entries'], data.groups.map(function (g) {
      return [links(g)];
    })));
  });
  add('Origin and resistance', { action: 'origins' }, function (data) {
    out.append(make('p', {}, 'Plasmids that share the same origin and the same resistance cannot be kept together in one cell (' + data.checked + ' plasmids with a sequence file).'));
    out.append(table(['Origin', 'Bacterial resistance', 'Plasmids', 'Examples'], data.rows.map(function (r) {
      return [r.origin, r.resistance, r.count, links(r.examples)];
    })));
  });
  // the Backbone of plasmids that have none: shown first (nothing changes), then filled in on a second click
  const backboneRows = function (rows, all) {
    const shown = rows.filter(function (r) {
      return all || r.clear;
    });
    return table(['Plasmid', 'Backbone', 'Match'], shown.slice(0, 300).map(function (r) {
      return [link(r), r.backbone || '-', Math.round(r.score * 100) + '%' + (r.clear ? '' : ' (not clear enough)')];
    }));
  };
  add('Fill the empty Backbones', { action: 'backbones' }, function (data) {
    out.append(make('p', {}, data.empty + ' plasmids with a sequence file have no Backbone. For ' + data.clear + ' of them the sequence is clear about it (compared with the plasmids of the lab that have one); the others stay empty. Nothing is changed yet.'));
    if (data.clear > 0) {
      const apply = make('button', { type: 'button', class: 'btn btn-primary mb-3' }, 'Fill in the ' + data.clear + ' Backbones now');
      apply.addEventListener('click', function () {
        run(apply, { action: 'backbones_apply' }, function (done) {
          out.append(make('div', { class: 'alert alert-success' }, done.filled + ' Backbones were filled in. Check them: they come from the sequence, not from a person.'));
          out.append(backboneRows(done.rows, false));
        });
      });
      out.append(apply);
    }
    out.append(backboneRows(data.rows, false));
    out.append(make('p', { class: 'text-muted' }, 'Only the clear ones are listed (and only the first 300). A Backbone that is written is never changed.'));
  });
  box.append(buttons);

  // restriction sites
  const sites = make('div', { class: 'border rounded p-3 mb-3' });
  sites.append(make('strong', {}, 'Restriction sites: which backbones take my insert?'));
  const insert = make('textarea', { class: 'form-control mt-2', rows: '4', placeholder: 'Paste the insert sequence (FASTA or plain bases)', 'aria-label': 'Insert sequence' });
  const enzymes = ['EcoRI', 'BamHI', 'HindIII', 'XhoI', 'NotI', 'XbaI', 'SpeI', 'NheI', 'KpnI', 'SacI', 'SalI', 'PstI', 'NcoI', 'NdeI', 'AgeI', 'MluI', 'BsrGI', 'EcoRV', 'BglII', 'ClaI', 'PacI', 'AscI', 'BsaI', 'BsmBI', 'ApaI', 'SmaI'];
  const picks = make('div', { class: 'mt-2' });
  const boxes = enzymes.map(function (name) {
    const label = make('label', { class: 'mr-3 mb-1 d-inline-block' });
    const cb = make('input', { type: 'checkbox', class: 'mr-1' });
    label.append(cb, name);
    picks.append(label);
    return { name: name, cb: cb };
  });
  const go = make('button', { type: 'button', class: 'btn btn-primary mt-2' }, 'Find backbones that cut once with every chosen enzyme');
  go.addEventListener('click', function () {
    run(go, {
      action: 'sites',
      insert: insert.value,
      enzymes: boxes.filter(function (b) {
        return b.cb.checked;
      }).map(function (b) {
        return b.name;
      }),
    }, function (data) {
      if (data.inside.length) {
        out.append(make('div', { class: 'alert alert-warning' }, 'These enzymes also cut inside your insert: ' + data.inside.join(', ') + '.'));
      } else {
        out.append(make('div', { class: 'alert alert-success' }, 'None of the chosen enzymes cuts inside the insert.'));
      }
      out.append(make('p', {}, data.count + ' of ' + data.checked + ' backbones cut exactly once with ' + data.enzymes.join(' + ') + (data.count > data.backbones.length ? ' (the first ' + data.backbones.length + ' are listed)' : '') + '.'));
      out.append(table(['Backbone', 'Length (bp)'], data.backbones.map(function (b) {
        return [link(b), b.length];
      })));
      out.append(make('p', { class: 'text-muted' }, 'Overhang compatibility between different enzymes (BamHI with BglII, for example) is not checked.'));
    });
  });
  sites.append(insert, picks, go);
  box.append(sites, out);
  anchor.append(box);
}());
