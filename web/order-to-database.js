/**
 * "Add from an order": the lines of an order (the name, the vendor, the link, the catalog number, the clone, the sequence of a primer...) are
 * read into a short table with a tick each; the other columns of an entry are in a window that opens for a row. The ticked rows become
 * entries of the modules of the database, in My entries or in the Database. Opened from the Database page and from the orders page.
 * Exposed as window.OrderToDatabase.open({ orderId }).
 */
(function () {
  'use strict';

  const VENDORS = {
    'thermofisher.com': 'Thermo Fisher Scientific',
    'fishersci.com': 'Thermo Fisher Scientific',
    'cellsignal.com': 'Cell Signaling Technology',
    'abcam.com': 'Abcam',
    'biolegend.com': 'BioLegend',
    'sigmaaldrich.com': 'Sigma-Aldrich',
    'merckmillipore.com': 'Merck',
    'scbt.com': 'Santa Cruz Biotechnology',
    'addgene.org': 'Addgene',
    'idtdna.com': 'IDT',
    'microsynth.com': 'Microsynth',
    'corning.com': 'Corning',
    'bio-rad.com': 'Bio-Rad',
    'rndsystems.com': 'R&D Systems',
    'bdbiosciences.com': 'BD Biosciences',
    'novusbio.com': 'Novus Biologicals',
    'invitrogen.com': 'Thermo Fisher Scientific',
    'neb.com': 'New England Biolabs',
    'sarstedt.com': 'Sarstedt',
    'eppendorf.com': 'Eppendorf',
    'vwr.com': 'VWR',
    // the suppliers of the shops of the lab
    'agilent.com': 'Agilent',
    'axonlab.com': 'Axon Lab',
    'bd.com': 'BD Biosciences',
    'bechtle.com': 'Bechtle',
    'bioconcept.ch': 'BioConcept',
    'brack.ch': 'Brack',
    'brunschwig.ch': 'Brunschwig',
    'brutsch.ch': 'Brütsch-Rüegger Tools',
    'bruetsch.ch': 'Brütsch-Rüegger Tools',
    'conrad.ch': 'Conrad',
    'dell.com': 'Dell',
    'digitec.ch': 'Digitec',
    'distrelec.ch': 'Distrelec',
    'faust.ch': 'Faust',
    'gilson.com': 'Gilson',
    'huberlab.ch': 'Huberlab',
    'kaiserkraft.ch': 'Kaiser+Kraft',
    'linde-gas.ch': 'Linde',
    'lubio.ch': 'Lubio Science',
    'lucerna-chem.ch': 'Lucerna-Chem',
    'lyreco.com': 'Lyreco',
    'merckgroup.com': 'Merck',
    'mt.com': 'Mettler Toledo',
    'milian.ch': 'Milian',
    'promega.com': 'Promega',
    'qiagen.com': 'Qiagen',
    'carlroth.com': 'Roth',
    'rs-online.com': 'RS',
    'sfs.ch': 'SFS',
    'starlabgroup.com': 'Starlab',
    'starlab.ch': 'Starlab',
    'stemcell.com': 'STEMCELL Technologies',
    'thorlabs.com': 'Thorlabs',
    'vitaris.ch': 'Vitaris',
  };
  // names that are written in the order by hand (no link): the vendor is put right when the name is near ("Simga", "Carl Roth", "Thermo")
  const VENDOR_NAMES = Object.keys(VENDORS).map(function (domain) {
    return VENDORS[domain];
  }).concat(['Sarstedt', 'Corning', 'Eppendorf', 'DBSSE', 'Carl Roth', 'Fisher Scientific', 'Thermo', 'Invitrogen', 'Millipore', 'Sigma']);
  const VENDOR_ALIASES = { 'carl roth': 'Roth', 'roth': 'Roth', 'thermo': 'Thermo Fisher Scientific', 'fisher scientific': 'Thermo Fisher Scientific', 'fisher': 'Thermo Fisher Scientific', 'invitrogen': 'Thermo Fisher Scientific', 'millipore': 'Merck', 'sigma': 'Sigma-Aldrich' };
  const HOSTS = ['Mouse', 'Rabbit', 'Rat', 'Goat', 'Donkey', 'Sheep', 'Hamster', 'Chicken'];

  const token = function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  };
  const element = function (tag, className, text, style) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text) {
      node.textContent = text;
    }
    if (style) {
      node.setAttribute('style', style);
    }
    return node;
  };

  // the primer tools (the melting temperature) are loaded when they are not there
  let toolsLoading = null;
  function loadPrimerTools() {
    if (window.PrimerTools) {
      return Promise.resolve();
    }
    if (!toolsLoading) {
      toolsLoading = new Promise(function (resolve) {
        const script = document.createElement('script');
        script.src = 'primer-tools.js?v=' + Date.now();
        script.onload = resolve;
        script.onerror = resolve;
        document.head.append(script);
      });
    }
    return toolsLoading;
  }

  // a file or a text as the content of a sequence file sent with the entry
  function toBase64(text) {
    return window.btoa(unescape(encodeURIComponent(text)));
  }
  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result).split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  const addgeneId = function (link) {
    const found = /addgene\.org\/(?:plasmid\/)?(\d{3,7})\b/i.exec(link || '');
    return found ? found[1] : '';
  };

  // ---- reading an order
  function linesOf(html) {
    // a block starts a new line as well as ends one (two links pasted one after the other are two lines)
    const prepared = String(html || '').replace(/<\/(p|div|li|h\d)>|<(p|div|li|h\d)\b[^>]*>|<br\s*\/?>/gi, '\n');
    const doc = new DOMParser().parseFromString(prepared, 'text/html');
    doc.querySelectorAll('a[href]').forEach(function (a) {
      // spaces around the address: a link next to another one is not one address
      a.replaceWith(doc.createTextNode(' ' + a.getAttribute('href') + ' '));
    });
    return (doc.body.textContent || '').split(/\n+/).map(function (l) {
      return l.trim();
    }).filter(Boolean);
  }

  function vendorOfLink(link) {
    try {
      const host = new URL(link).hostname.replace(/^www\./, '');
      const known = Object.keys(VENDORS).find(function (domain) {
        return host === domain || host.endsWith('.' + domain);
      });
      return known ? VENDORS[known] : '';
    } catch (error) {
      return '';
    }
  }

  // the catalog number a vendor puts in the address of a product
  function catalogOfLink(link) {
    const patterns = [/abcam\.com\/.*?\b(ab\d{3,7})\b/i, /thermofisher\.com\/.*\/([A-Za-z0-9-]{4,})\/?(?:\?.*)?$/i, /sigmaaldrich\.com\/.*\/product\/[^/]+\/([A-Za-z0-9-]+)/i, /cellsignal\.com\/products\/.*?\/(\d{3,6})(?:\?|$)/i, /biolegend\.com\/.*?\/(\d{5,7})(?:\?|$)/i, /corning\.com\/.*\/([A-Za-z0-9-]{4,})\.html/i, /carlroth\.com\/.*\/p\/([A-Za-z0-9.-]+?)(?:[?#\/]|$)/i, /promega\.[a-z]+\/.*[?&]catNum=([A-Za-z0-9]+)/i];
    for (const pattern of patterns) {
      const found = pattern.exec(link);
      if (found) {
        return found[1];
      }
    }
    return '';
  }

  // a vendor typed with a slip ("Simga") is put right when the link says which vendor it is
  function distance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) {
      d[i] = [i];
    }
    for (let j = 1; j <= b.length; j++) {
      d[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  // the vendor that a name written by hand means, when it is near to a vendor that is known; otherwise the name as it was written
  function vendorOfName(typed) {
    const word = typed.toLowerCase().replace(/[^a-z0-9]/g, '');
    const alias = VENDOR_ALIASES[typed.toLowerCase().trim()];
    if (alias) {
      return alias;
    }
    if (word.length < 4) {
      return typed;
    }
    const found = VENDOR_NAMES.find(function (name) {
      return name.toLowerCase().replace(/[^a-z0-9]/g, '') === word;
    }) || VENDOR_NAMES.find(function (name) {
      return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).some(function (token) {
        return token.length >= 4 && distance(word, token) <= 2;
      });
    });
    return found ? (VENDOR_ALIASES[found.toLowerCase()] || found) : typed;
  }

  function fixVendor(typed, link) {
    const known = vendorOfLink(link);
    if (typed !== '' && known === '') {
      return vendorOfName(typed);
    }
    if (typed === '' || known === '') {
      return typed || known;
    }
    const word = typed.toLowerCase().replace(/[^a-z0-9]/g, '');
    const near = known.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).some(function (token) {
      return word.length >= 4 && distance(word, token) <= 2;
    });
    return near ? known : typed;
  }

  function guessModule(row) {
    if (row.sequence) {
      return 'Primers';
    }
    // a link says what it is: a plasmid at Addgene or Benchling, an oligo at IDT or Microsynth
    if (/addgene\.org|benchling\.com/i.test(row.link || '') || /\baddgene\b/i.test(row.name)) {
      return 'Plasmids';
    }
    if (/idtdna\.com|microsynth\.com/i.test(row.link || '')) {
      return 'Primers';
    }
    if (/\bplasmid\b/i.test(row.name)) {
      return 'Plasmids';
    }
    if (/antibod|\banti[- ]|\bmAb\b|monoclonal|polyclonal|\bIgG\b|streptavidin/i.test(row.name)) {
      return 'Antibodies';
    }
    // a marker (CD45) or a dye of an antibody (Spark Blue, Alexa Fluor 488, FITC, Brilliant Violet 421) in the name
    if (/\bCD\d{1,3}[a-z]?\b|\b(spark blue|alexa ?fluor|brilliant violet|pacific blue|percp|fitc|dylight)\b|\bBV\d{3}\b/i.test(row.name)) {
      return 'Antibodies';
    }
    // the vendors that sell antibodies (proteins, cytokines and kits of the same vendors are reagents)
    if (!/recombinant|protein|cytokine|elisa|\bkit\b|medium|buffer/i.test(row.name)
      && /biolegend|cellsignal|cell signaling|novusbio|novus biologicals|proteintech|ptglab|genetex|jacksonimmuno|jackson immunoresearch|scbt\.com|santa cruz|rndsystems|r&d systems|(abcam\.com|thermofisher\.com)\/[^?#]*antibod/i.test(String(row.vendor || '') + ' ' + String(row.link || ''))) {
      return 'Antibodies';
    }
    if (/\b(tubes?|tips?|plates?|flasks?|dish(es)?|pipettes?|gloves?|filters?|falcon|eppendorf|syringes?|needles?|slides?|coverslips?)\b/i.test(row.name)) {
      return 'Consumables';
    }
    // the vendors that sell little else than consumables
    if (/starlab|sarstedt|corning|kaiser|lyreco/i.test(String(row.vendor || '') + ' ' + String(row.link || ''))) {
      return 'Consumables';
    }
    return 'Reagents';
  }

  function parseOrder(order) {
    const titleParts = String(order.title || '').split(';').map(function (p) {
      return p.trim();
    });
    const base = { name: titleParts[0] || '', vendor: titleParts[1] || '', link: '', catalog: '', clone: '', host: '', sequence: '' };
    const keyed = {};
    const primers = [];
    linesOf(order.notes).forEach(function (line) {
      const primer = /^(.*?):\s*5'?\s*-?\s*([ACGTUNacgtun\s]{8,}?)\s*-?\s*3'?/.exec(line);
      if (primer) {
        primers.push({ name: primer[1].trim(), sequence: primer[2].replace(/\s+/g, '').toUpperCase() });
        return;
      }
      const field = /^(link|url|clone|catalog(?: number)?|amount|vendor|supplier|host|sequence|target)\s*:\s*(.+)$/i.exec(line);
      if (field) {
        keyed[field[1].toLowerCase().replace(/ number$/, '')] = field[2].trim();
      }
    });
    const rows = [];
    const make = function (extra) {
      const row = Object.assign({}, base, extra);
      row.link = row.link || keyed.link || keyed.url || '';
      if (!row.link) {
        const found = /https?:\/\/\S+/.exec(String(order.notes || ''));
        row.link = found ? found[0].replace(/["'<>)]+$/, '') : '';
      }
      row.vendor = fixVendor(row.vendor || keyed.vendor || keyed.supplier || '', row.link);
      row.catalog = row.catalog || keyed.catalog || catalogOfLink(row.link);
      row.clone = row.clone || keyed.clone || ((/\bclone\s+([A-Za-z0-9-]+)/i.exec(row.name) || [])[1] || '');
      const hostFound = new RegExp('(?<!anti[- ])\\b(' + HOSTS.join('|') + ')\\b(?=[^,;]*\\b(?:anti|mAb|monoclonal|polyclonal|IgG|antibody)\\b)', 'i').exec(row.name);
      row.host = row.host || keyed.host || (hostFound ? hostFound[1][0].toUpperCase() + hostFound[1].slice(1).toLowerCase() : '');
      row.moduleTitle = guessModule(row);
      readName(row);
      row.fields = null;
      row.ticked = row.name.trim() !== '';
      rows.push(row);
    };
    // the distinct links of the notes (a link is in the text of the notes once, whatever the page makes of it): an order with several of them is several items
    const links = [];
    linesOf(order.notes).forEach(function (line) {
      (line.match(/https?:\/\/[^\s"'<>)]+/g) || []).forEach(function (found) {
        const url = found.replace(/[.,;]+$/, '');
        if (!links.some(function (known) {
          return known.link === url;
        })) {
          // the words before the link on its line name the item ("Ampicillin: https://...")
          const label = line.replace(/https?:\/\/\S+/g, '').replace(/^\s*(link|url|website|page|product)\s*[:\-]?/i, '').replace(/[:\-\s]+$/, '').trim();
          links.push({ link: url, label: /^(link|url)$/i.test(label) ? '' : label });
        }
      });
    });
    if (primers.length > 0) {
      primers.forEach(function (p) {
        make({ name: p.name, sequence: p.sequence });
      });
    } else if (links.length >= 2) {
      links.forEach(function (item) {
        make({ name: item.label || linkName(item.link), link: item.link, catalog: catalogOfLink(item.link), vendor: '' });
      });
    } else {
      make({});
    }
    return rows;
  }

  // the value that goes in each field of a module, from what the line said
  function defaultsFor(module, row) {
    const values = {};
    const benchling = /benchling\.com/i.test(row.link || '');
    (module.fields || []).forEach(function (f) {
      let value = '';
      if (/^benchling/i.test(f.name)) {
        value = benchling ? row.link : '';
      } else if (/^(supplier|vendor)/i.test(f.name)) {
        value = row.vendor;
      } else if (/^(link|url|website)/i.test(f.name)) {
        // a Benchling link has its own column in the modules that have one
        value = benchling && (module.fields || []).some(function (g) {
          return /^benchling/i.test(g.name);
        }) ? '' : row.link;
      } else if (/^catalog/i.test(f.name)) {
        value = row.catalog;
      } else if (/^clone/i.test(f.name)) {
        value = row.clone;
      } else if (/^host/i.test(f.name)) {
        value = row.host;
      } else if (/^target( gene)?$/i.test(f.name)) {
        value = row.target || '';
      } else if (/^sequence/i.test(f.name)) {
        value = row.sequence;
      } else if (/^purification/i.test(f.name)) {
        value = row.purification || '';
      } else if (/^tm\b/i.test(f.name)) {
        value = row.tm ? String(row.tm) : '';
      } else if (/^orientation/i.test(f.name)) {
        value = row.orientation || '';
      } else if (/^concentration/i.test(f.name)) {
        value = row.concentration || '';
      } else if (/^pack size/i.test(f.name)) {
        value = row.pack || '';
      } else if (/^lot/i.test(f.name)) {
        value = row.lot || '';
      } else if (/^isotype/i.test(f.name)) {
        value = row.isotype || '';
      } else if (/^(species )?reactivity/i.test(f.name)) {
        value = row.reactivity || '';
      } else if (/^applications?/i.test(f.name)) {
        value = row.applications || '';
      } else if (/^(conjugate(?!d)|dye)/i.test(f.name)) {
        value = row.conjugate || '';
      } else if (/^clonality/i.test(f.name)) {
        value = row.clonality || '';
      } else if (/^antibody type/i.test(f.name)) {
        // an antibody of an order is a primary one, unless it is an antibody against an antibody (anti-mouse IgG, anti-rabbit IgG (H+L))
        value = row.antibodyType || (/secondary|\banti-?(mouse|rabbit|goat|rat|donkey|chicken|human|sheep) ?ig[gm]|\(h\+l\)/i.test(row.name) ? 'Secondary' : 'Primary');
      } else if (/^cas\b/i.test(f.name)) {
        value = row.cas || '';
      } else if (/^backbone/i.test(f.name)) {
        value = String(row.backbone || '').split(',')[0].trim();
      } else if (/^resistance/i.test(f.name)) {
        value = row.resistance || '';
      } else if (/^conjugated$/i.test(f.name)) {
        // no conjugate found (not in the order, not on the page): the antibody is not conjugated
        value = row.conjugate ? (/^(un|none|no\b)/i.test(row.conjugate) ? 'No' : 'Yes') : 'No';
      }
      if (f.type === 'select' && value !== '') {
        const match = (f.options || []).find(function (o) {
          return String(o).toLowerCase() === String(value).toLowerCase() || String(value).toLowerCase().indexOf(String(o).toLowerCase()) === 0;
        });
        // a host that is not in the list is "Other"
        value = match || ((f.options || []).indexOf('Other') !== -1 ? 'Other' : '');
      }
      values[f.name] = value;
    });
    return values;
  }

  // what else the text of a line tells: the concentration, the size of a pack, the target of an antibody, the direction of a primer
  function readName(row) {
    const name = row.name || '';
    const conc = /(\d+(?:[.,]\d+)?\s*(?:mg\/ml|µg\/µl|ug\/ul|µg\/ml|ng\/µl|mM|µM|uM|nM|M|%))(?![A-Za-z])/i.exec(name);
    row.concentration = row.concentration || (conc ? conc[1].replace(/\s+/g, ' ') : '');
    const pack = /(\d+\s*(?:x\s*\d+\s*)?(?:pcs|pieces|pack|pk|per (?:case|box|pack)|\/(?:case|box|pack)))/i.exec(name);
    row.pack = row.pack || (pack ? pack[1] : '');
    const target = /\banti[- ]\s*(?:mouse|rabbit|rat|goat|human)?\s*([A-Za-z0-9-]{2,})/i.exec(name) || /^([A-Za-z0-9-]{2,})\s*\(/.exec(name);
    row.target = row.target || (target && /antibod/i.test(row.moduleTitle || '') ? target[1] : '');
    if (/antibod/i.test(row.moduleTitle || '')) {
      const marker = /\b(CD\d{1,3}[a-z]?)\b/i.exec(name);
      row.target = row.target || (marker ? marker[1].toUpperCase() : '');
      const dye = /\b(spark blue(?: ?\d{3})?|alexa ?fluor ?\d{3}|AF ?\d{3}|FITC|PerCP(?:-Cy5\.5)?|APC(?:-Cy7)?|PE(?:-Cy\d)?|brilliant violet ?\d{3}|BV ?\d{3}|pacific blue|dylight ?\d{3}|biotin|HRP)\b/i.exec(name);
      row.conjugate = row.conjugate || (dye ? dye[1] : '');
    }
    if (!row.orientation) {
      if (/(^|[\s_-])(fwd|forward|for|f)$|\b(fwd|forward)\b/i.test(name)) {
        row.orientation = 'Forward';
      } else if (/(^|[\s_-])(rev|reverse|r)$|\b(rev|reverse)\b/i.test(name)) {
        row.orientation = 'Reverse';
      }
    }
  }

  // ---- the details of a vendor page. The server has no internet and the browser cannot read the page of another site, so the user copies
  // the page (select everything, copy) and pastes it here: the text is read in the browser, nothing is sent anywhere.
  const TEXT_LABELS = [
    ['Catalog number', 'cat no\\.? ?/ ?id\\.?|plasmid #|product #|code|catalog(?:ue)? (?:number|no\\.?|#)|catalog(?:ue)?|cat\\.? ?(?:no\\.?|#)|article (?:number|no\\.?|code)|art\\.? ?(?:no\\.?|nr\\.?|#)|product (?:code|number|no\\.?)|item (?:number|no\\.?)|order (?:number|no\\.?|code)|mfr\\.? part (?:number|no\\.?)|part (?:number|no\\.?)|reference|sku'],
    ['CAS number', 'cas (?:number|no\\.?|#)|cas'],
    ['Clone number', 'clone (?:number|name|id|no\\.?|#)|clone'],
    ['Host / Isotype', 'host ?/ ?isotype'],
    ['Clonality', 'clonality|clonal type|class'],
    ['Antibody type', 'antibody type'],
    ['Antibody source', 'antibody source|source'],
    ['Host species', 'host species|host'],
    ['Isotype', 'isotype'],
    ['Reacts with', 'verified reactivity|reacts with|species reactivity|tested reactivity|reactivity'],
    ['Applications', 'tested applications|application\\(s\\)|technique\\(s\\)|applications?|suitable for'],
    ['Conjugate', 'conjugated to|conjugation|conjugate|dye'],
    // "Target retrieval: citrate buffer" and "Antigen retrieval" (the staining conditions) are not the target of the antibody
    ['Target', 'target(?! (?:retrieval|site|region|cells?|species))|gene name|antigen(?! (?:retrieval|affinity|presentation))'],
    ['Label', 'label|format'],
    ['Concentration', 'igg concentration|approx\\.? protein concentrations?|concentration range|concentration'],
    ['Size / concentration', 'size ?/ ?concentration'],
    ['Pack size', 'pack(?:age|ing)? size|pack qty\\.?|unit of measure|packaging unit|packing|unit size|content|quantity|amount|size'],
    ['Supplier', 'supplier|brand|manufacturer'],
    ['Vector backbone', 'vector backbone|backbone'],
    ['Bacterial resistance', 'bacterial resistance\\(s\\)|bacterial resistance|resistance'],
  ];

  // the text of an image (a screenshot of a page: a table does not paste well, an image keeps it). The reading is done in the browser with
  // the files of web/ocr (tesseract.js, English): nothing is sent anywhere and the server needs no internet.
  let ocrLoading = null;
  function readImage(file, onProgress) {
    const here = function (name) {
      return new URL('ocr/' + name, window.location.href).href;
    };
    if (!ocrLoading) {
      ocrLoading = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = here('tesseract.min.js');
        script.onload = resolve;
        script.onerror = function () {
          ocrLoading = null;
          reject(new Error('The reader of images could not be loaded.'));
        };
        document.head.append(script);
      });
    }
    return ocrLoading.then(function () {
      return window.Tesseract.createWorker('eng', 1, {
        workerPath: here('worker-wrapper.js'),
        corePath: here('tesseract-core-simd-lstm.wasm.js'),
        langPath: new URL('ocr', window.location.href).href,
        workerBlobURL: false,
        logger: function (m) {
          if (onProgress && m.status === 'recognizing text') {
            onProgress(Math.round(m.progress * 100));
          }
        },
      });
    }).then(function (worker) {
      return worker.recognize(file).then(function (result) {
        return worker.terminate().then(function () {
          return result.data.text;
        });
      });
    });
  }

  // the text of a PDF (a datasheet saved as PDF): the lines of each page are rebuilt from the places of the words, so that a label and its
  // value that are side by side stay on one line. A page that has no text (a scan) is drawn and read like an image. The files are those of
  // web/ocr (pdf.js); nothing is sent anywhere.
  let pdfLoading = null;
  function loadPdfjs() {
    if (!pdfLoading) {
      pdfLoading = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = new URL('ocr/pdf.min.js', window.location.href).href;
        script.onload = function () {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('ocr/pdf.worker.min.js', window.location.href).href;
          resolve(window.pdfjsLib);
        };
        script.onerror = function () {
          pdfLoading = null;
          reject(new Error('The reader of PDF files could not be loaded.'));
        };
        document.head.append(script);
      });
    }
    return pdfLoading;
  }

  async function readPdf(file, onProgress) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = Math.min(doc.numPages, 8);
    const texts = [];
    let scans = 0;
    for (let number = 1; number <= pages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const rows = [];
      content.items.forEach(function (item) {
        if (String(item.str || '').trim() === '') {
          return;
        }
        const y = Math.round(item.transform[5]);
        let row = rows.find(function (candidate) {
          return Math.abs(candidate.y - y) <= 3;
        });
        if (!row) {
          row = { y: y, parts: [] };
          rows.push(row);
        }
        row.parts.push({ x: item.transform[4], text: item.str });
      });
      rows.sort(function (a, b) {
        return b.y - a.y;
      });
      const text = rows.map(function (row) {
        return row.parts.sort(function (a, b) {
          return a.x - b.x;
        }).map(function (part) {
          return part.text;
        }).join(' ');
      }).join('\n');
      if (text.replace(/\s+/g, '').length >= 40) {
        texts.push(text);
      } else if (scans < 3) {
        // a page that is a picture: it is drawn and read like an image (the first three of them)
        scans += 1;
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
        const blob = await new Promise(function (resolve) {
          canvas.toBlob(resolve, 'image/png');
        });
        texts.push(await readImage(blob, null));
      }
      if (onProgress) {
        onProgress(Math.round(number / pages * 100));
      }
    }
    return texts.join('\n');
  }

  // {name, sku, brand, description, props} from the text of a product page
  function readPageText(text, link) {
    const lines = String(text || '').split(/\r\n|\r|\n/).map(function (line) {
      return line.replace(/\s*[|\u2502]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    const page = { name: '', sku: '', brand: vendorOfLink(link || ''), description: '', props: {} };
    // the name is the first line that looks like the title of a product (the bars of the line, "... | Abcam", are still there: the name is cut
    // at them by cleanPageName; "Product name" in front of it is the label that link-page.php gives to the name of the product)
    const named = String(text || '').split(/\r\n|\r|\n/).map(function (line) {
      return line.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    page.name = (named.find(function (line) {
      return line.length >= 6 && line.length <= 200 && (/antibod|\bab\d{4,7}\b|\[[^\]]+\]/i.test(line));
    }) || named.find(function (line) {
      return line.length >= 6 && line.length <= 200;
    }) || '').replace(/^product name\s+/i, '');
    if (BLOCKED_PAGE.test(page.name)) {
      page.name = '';
    }
    TEXT_LABELS.forEach(function (entry) {
      const label = entry[1];
      const same = new RegExp('^(?:' + label + ')\\s*[:\\-]\\s*(.+)$|^(?:' + label + ')\\s+(.+)$', 'i');
      const alone = new RegExp('^(?:' + label + ')\\s*:?$', 'i');
      for (let i = 0; i < lines.length; i++) {
        let value = '';
        // the label alone on its line: the value is the next line (checked first: "Clone number" is not the label "Clone" with "number")
        if (alone.test(lines[i])) {
          value = lines[i + 1] || '';
        } else {
          const found = same.exec(lines[i]);
          value = found ? (found[1] || found[2] || '').trim() : '';
        }
        // a pages repeats the label in the value ("Suitable for: IHC-P, WB"): the label is taken off
        value = value.replace(/^(?:suitable for|reacts with|tested applications|species reactivity)\s*:\s*/i, '');
        // a value is short: a long line is a sentence that starts with the word
        // a heading is not a value ("Target data", "Product details", "Application notes" are the titles of the parts of a page)
        const heading = /^(data|information|info|details?|overview|summary|profile|description|specifications?|specs|properties|notes?|sheets?|section|tab|images?|figures?)$/i.test(value);
        if (value !== '' && !heading && value.length <= 120 && !/^(is|are|of|for|to|and|the|in|with)\b/i.test(value) && !/^[\/:]/.test(value)) {
          page.props[entry[0]] = value;
          break;
        }
      }
    });
    const whole = lines.join('\n');
    const props = page.props;
    // fields that give two things in one: "Host / Isotype  Rabbit / IgG", "Antibody Source  Monoclonal Mouse IgG1 Clone # 196908" (or just
    // "Rabbit"), "Size/Concentration  150 uL, 1000 ug/ml"
    if (props['Host / Isotype']) {
      const parts = props['Host / Isotype'].split('/').map(function (part) {
        return part.trim();
      });
      props['Host species'] = props['Host species'] || parts[0] || '';
      props.Isotype = props.Isotype || parts[1] || '';
    }
    if (props['Antibody source']) {
      const source = props['Antibody source'];
      const host = HOSTS.find(function (name) {
        return new RegExp('\\b' + name + '\\b', 'i').test(source);
      });
      const isotype = /\bIg[GMAED]\d?[a-z]*/i.exec(source);
      const clone = /\bclone\s*#?\s*([A-Za-z0-9-]+)/i.exec(source);
      if (host && !props['Host species']) {
        props['Host species'] = host;
      }
      if (isotype && !props.Isotype) {
        props.Isotype = isotype[0];
      }
      if (clone && !props['Clone number']) {
        props['Clone number'] = clone[1];
      }
    }
    if (props['Size / concentration']) {
      const parts = props['Size / concentration'].split(',').map(function (part) {
        return part.trim();
      });
      props['Pack size'] = props['Pack size'] || parts[0] || '';
      props.Concentration = props.Concentration || parts[1] || '';
    }
    // the clonality: a label of its own (Abcam: "Clonality", Thermo: "Class"), the "Antibody Type" of BioLegend, the antibody source of R&D, the
    // title ("... Polyclonal Antibody") or a sentence ("mouse monoclonal IgG2a")
    const clonal = function (text) {
      return /mono/i.test(text || '') ? 'Monoclonal' : (/poly/i.test(text || '') ? 'Polyclonal' : '');
    };
    props.Clonality = clonal(props.Clonality) || clonal(props['Antibody type']) || clonal(props['Antibody source']) || clonal(lines.slice(0, 40).join(' '));
    if (props.Clonality === '') {
      delete props.Clonality;
    }
    // "Antibody Type  Monoclonal" is the clonality: only "Primary" or "Secondary" stays as the type of the antibody
    if (props['Antibody type'] && !/^(primary|secondary)/i.test(props['Antibody type'])) {
      delete props['Antibody type'];
    }
    // "Label  Unconjugated" (Novus) is the conjugate when it says so
    if (!props.Conjugate && props.Label && /^(un)?conjugated|alexa|fitc|biotin|hrp|dylight|\bcy\d|\bapc\b|\bpe\b|[A-Za-z]+ ?\d{3}$/i.test(props.Label)) {
      props.Conjugate = props.Label;
    }
    // what is written in a sentence of the page: the application is "FC - Quality tested" (the application is FC), the clone in the notes
    // ("Clone 30-F11 reacts with..."), the conjugate in the preparation ("conjugated with Spark Blue 574 under...")
    if (page.props.Applications) {
      page.props.Applications = page.props.Applications.replace(/\s*[-\u2013]\s*quality tested/i, '').replace(/\s*see (?:reactivity|application|all) (?:data|images?).*$/i, '').trim();
    }
    if (!page.props['Clone number']) {
      const clone = /\bclone\s*(?:no\.?|number|name)?\s*[:#]?\s*([A-Za-z0-9]*\d[A-Za-z0-9-]*)/i.exec(whole);
      if (clone) {
        page.props['Clone number'] = clone[1];
      }
    }
    if (!page.props.Conjugate) {
      const conjugate = /\bconjugated\s+(?:with|to)\s+([A-Za-z0-9\u2122\u00AE\- ]{2,40}?)(?=\s+(?:under|and|at|in|by|using)\b|[.,;]|$)/i.exec(whole);
      if (conjugate) {
        page.props.Conjugate = conjugate[1].replace(/[\u2122\u00AE]/g, '').trim();
      }
    }
    // the catalog numbers written as "Cat. No. 103183" (there can be several: the line decides, by its link, which one is the product)
    // the numbers of the lines of the RRID (the identifier of the product itself) come first: a number in a sentence ("recommended for...
    // (Cat. No. 103163)") is another product
    const cats = [];
    const addCats = function (text) {
      const pattern = /\bcat(?:alog(?:ue)?)?\.?\s*(?:no\.?|number|#)\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9-]{2,})/gi;
      let found;
      while ((found = pattern.exec(text)) !== null) {
        if (cats.indexOf(found[1]) === -1) {
          cats.push(found[1]);
        }
      }
    };
    addCats(lines.filter(function (line) {
      return /\bRRID\b|\bAB_\d{5,}/.test(line);
    }).join('\n'));
    addCats(whole);
    page.cats = cats;
    // the catalog number of a product that has it in its title (Abcam: "... (ab105389)")
    const inTitle = /\((ab\d{4,7})\)|\b(ab\d{4,7})\b/i.exec(lines.slice(0, 12).join(' '));
    // the numbers that vendors write in the title or the heading: "(A-11122)", "(GTX113617)", "(66009-1-Ig)" (a number with a letter in it),
    // "sc-9996", "MAB1259", "NB100-1770"
    const head = lines.slice(0, 6).join(' ');
    const bracket = /\(([A-Za-z]{1,4}[A-Za-z0-9-]*\d[A-Za-z0-9-]*|\d+[A-Za-z][A-Za-z0-9-]*)\)/.exec(head);
    const typed = /\b(sc-\d{3,6}|MAB\d{3,5}[A-Z]?|NB\d{2,3}-\d{3,5})\b|(?:^|\s)#(\d{3,6})\b/.exec(head);
    // a short token in brackets after "Antibody" is the clone (Santa Cruz: "(B-2)"), a longer one the catalog number (Thermo: "(A-11122)")
    [typed && (typed[1] || typed[2]), bracket && bracket[1].length >= 5 ? bracket[1] : ''].forEach(function (number) {
      if (number && cats.indexOf(number) === -1) {
        cats.push(number);
      }
    });
    // a sentence of the page: "mouse monoclonal IgG2a kappa provided at 200 ug/ml for WB, IP, IF, FCM and ELISA"
    if (!props.Isotype) {
      const isotype = /\bIg[GMAED]\d?[a-z]*/.exec(whole);
      if (isotype) {
        props.Isotype = isotype[0];
      }
    }
    if (!props.Concentration) {
      const concentration = /\b(?:at|of)\s+(\d+(?:[.,]\d+)?\s*(?:\u00B5g|\u03BCg|ug|mg)\/(?:ml|\u00B5l|\u03BCl|ul))/i.exec(whole);
      if (concentration) {
        props.Concentration = concentration[1];
      }
    }
    if (!props.Applications) {
      const applications = /\bfor\s+((?:(?:WB|IP|IF|IHC(?:\([A-Z]\))?|FCM|FC|ELISA|ICC|ChIP)(?:\s*,\s*and\s+|\s*,\s*|\s+and\s+)?)+)/.exec(whole);
      if (applications) {
        props.Applications = applications[1].replace(/[,\s]+(?:and)?\s*$/, '').replace(/\s+and\s+/g, ', ');
      }
    }
    // the values as they are kept: the clone without "(RUO)", the isotype without the host and the chain ("Mouse IgG1, kappa" is IgG1)
    if (props['Clone number']) {
      props['Clone number'] = props['Clone number'].replace(/\s*\(.*?\)\s*$/, '').trim();
    }
    if (props.Isotype) {
      const kept = /\bIg[GMAED]\d?[a-z]*/.exec(props.Isotype);
      props.Isotype = kept ? kept[0] : props.Isotype;
    }
    // Santa Cruz: "GFP Antibody (B-2): sc-9996", the clone is in the brackets of the heading
    if (!props['Clone number']) {
      const heading = /\bantibody\s*\(([A-Za-z0-9-]{2,})\)/i.exec(head);
      if (heading && heading[1].length < 5 && cats.indexOf(heading[1]) === -1) {
        props['Clone number'] = heading[1];
      }
    }
    page.sku = props['Catalog number'] || (inTitle ? (inTitle[1] || inTitle[2]) : '') || cats[0] || '';
    page.description = lines.slice(0, 12).join(' ').slice(0, 600);
    return page;
  }

  // what a label of a page means for a line of the order
  const PAGE_LABELS = [
    ['catalog', /^(catalog(ue)?( (number|no\.?|#))?|cat\.? ?(no\.?|#)|product (code|number|id)|item (number|no\.?)|sku|mpn|part (number|no\.?))$/i],
    ['clone', /^clone( (number|name|id))?$/i],
    ['host', /^host( species)?$/i],
    ['target', /^(target|gene( name)?|antigen|immunogen name)$/i],
    ['isotype', /^isotype$/i],
    ['reactivity', /^(reacts with|species reactivity|reactivity|tested reactivity)$/i],
    ['applications', /^(applications?|tested applications?|suitable for)$/i],
    ['conjugate', /^(conjugate|conjugation|label|dye)$/i],
    ['concentration', /^(concentration|conc\.?)$/i],
    ['pack', /^(pack(age|ing)?( size)?|packaging unit|unit size|size|amount|content|quantity)$/i],
    ['cas', /^cas( (number|no\.?|#))?$/i],
    ['clonality', /^clonality$/i],
    ['antibodyType', /^antibody type$/i],
    ['vendor', /^(supplier|brand|manufacturer)$/i],
    ['backbone', /^vector backbone$/i],
    ['resistance', /^bacterial resistance$/i],
  ];

  // the details read from a page are put in the line: what the line has already is kept
  function applyPage(row, page) {
    if (!page || page.error) {
      return false;
    }
    const props = page.props || {};
    row.props = props;
    Object.keys(props).forEach(function (label) {
      const entry = PAGE_LABELS.find(function (item) {
        return item[1].test(label.trim());
      });
      // what the line has already is kept, but a conjugate that the page gives in full ("Spark Blue 574") replaces the one of the name ("spark blue")
      const longer = entry && entry[0] === 'conjugate' && row.conjugate && props[label].toLowerCase().indexOf(String(row.conjugate).toLowerCase()) === 0 && props[label].length > String(row.conjugate).length;
      if (entry && (!row[entry[0]] || longer)) {
        row[entry[0]] = props[label];
      }
    });
    // several catalog numbers on the page: the one that is in the link is the product
    const inLink = (page.cats || []).find(function (number) {
      return String(row.link || '').indexOf(number) !== -1;
    });
    row.catalog = row.catalog || inLink || page.sku || (page.cats || [])[0] || page.mpn || '';
    row.vendor = row.vendor || String(page.brand || '');
    // the name of the page is used for a line that has no name of its own
    if (row.name.trim() === '' && page.name && !/^(product )?(details|information|overview|description)$/i.test(String(page.name).trim())) {
      row.name = String(page.name).trim();
    }
    const said = [page.name, page.description].join(' ');
    row.clone = row.clone || ((/\bclone\s*(?:no\.?\s*)?[:#]?\s*([A-Za-z0-9-]{2,})/i.exec(said) || [])[1] || '') || ((/\[([A-Za-z0-9-]{2,})\]/.exec(page.name || '') || [])[1] || '');
    // the target of an antibody is in its name: "Anti-Nestin antibody"
    if (!row.target && /antibod|\banti[- ]/i.test(said + ' ' + row.name)) {
      const target = /\banti[- ]\s*(?:mouse|rabbit|rat|goat|human)?\s*([A-Za-z0-9-]{2,})/i.exec(row.name || '') || /\banti[- ]\s*(?:mouse|rabbit|rat|goat|human)?\s*([A-Za-z0-9-]{2,})/i.exec(page.name || '');
      row.target = target ? target[1] : '';
    }
    // "Vimentin antibody": the word before "antibody" is the target (not "Monoclonal antibody", "Rabbit antibody"...)
    if (!row.target) {
      const before = /^([A-Za-z][A-Za-z0-9-]{2,})\s+antibod/i.exec(String(row.name || '').trim());
      if (before && !/^(primary|secondary|monoclonal|polyclonal|recombinant|purified|rabbit|mouse|goat|rat|human|donkey|sheep|chicken|unconjugated|conjugated|control|isotype|anti)$/i.test(before[1])) {
        row.target = before[1];
      }
    }
    if (row.host) {
      const known = HOSTS.find(function (name) {
        return new RegExp('\\b' + name + '\\b', 'i').test(row.host);
      });
      row.host = known || row.host;
    } else {
      const found = new RegExp('\\b(' + HOSTS.join('|') + ')\\b(?=[^.]{0,40}\\b(?:monoclonal|polyclonal|antibody|IgG)\\b)', 'i').exec(said);
      row.host = found ? found[1][0].toUpperCase() + found[1].slice(1).toLowerCase() : '';
    }
    // the name of the line can say it too ("polyclonal anti-GFP")
    row.clonality = row.clonality || (/monoclonal/i.test(row.name) ? 'Monoclonal' : (/polyclonal/i.test(row.name) ? 'Polyclonal' : ''));
    row.fields = null;
    return true;
  }

  // ---- the page behind a link, read by the server when it can reach the internet (link-page.php): without internet it fails and is not asked
  // again for half an hour; the page and the pasted text, screenshot or PDF all go through readPageText
  const pagesOfLinks = new Map();
  // not asked for 3 minutes after the server could not be reached (not after a page that could not be read: another page can be)
  function pagesDown() {
    try {
      return Date.now() - Number(window.localStorage.getItem('otd-page-down-v2') || 0) < 3 * 60 * 1000;
    } catch (error) {
      return false;
    }
  }
  function pageFromLink(link) {
    if (!/^https?:\/\//i.test(link || '')) {
      return Promise.resolve(null);
    }
    if (pagesOfLinks.has(link)) {
      return pagesOfLinks.get(link);
    }
    const work = (async function () {
      if (pagesDown()) {
        return null;
      }
      const stop = new AbortController();
      const timer = window.setTimeout(function () {
        stop.abort();
      }, 9000);
      let unreachable = false;
      try {
        const response = await fetch('link-page.php?url=' + encodeURIComponent(link), { credentials: 'same-origin', signal: stop.signal });
        if (!response.ok) {
          unreachable = true;
        } else {
          const answer = await response.json();
          // the page of this link could not be read (a block, an error page): the other links are still asked
          return answer && answer.ok && answer.text ? readPageText(answer.text, link) : null;
        }
      } catch (error) {
        unreachable = true;
      } finally {
        window.clearTimeout(timer);
      }
      if (unreachable) {
        try {
          window.localStorage.setItem('otd-page-down-v2', String(Date.now()));
        } catch (error) {
          // asked again next time
        }
      }
      return null;
    }());
    pagesOfLinks.set(link, work);
    return work;
  }

  // the name of an item from its link alone: from the title of the page ("Anti-vimentin antibody - rabbit polyclonal (ab137321) | Abcam"), or
  // when the page cannot be read from the end of the address ("vimentin-antibody-ab137321" gives "Vimentin antibody")
  // the title of a page that a shop gives to a robot (Sigma-Aldrich: "Powered and protected by Privacy") is not the name of a product
  const BLOCKED_PAGE = /^(powered and protected by|access denied|just a moment|attention required|pardon our interruption|are you a (robot|human)|robot or human|verify you are|checking your browser|please enable (javascript|cookies)|security check|request blocked|forbidden|403\b|404\b|page not found|error\b)/i;
  function cleanPageName(name) {
    if (BLOCKED_PAGE.test(String(name || '').trim())) {
      return '';
    }
    // a bare product code ("AB155120") is not a name
    if (/^[A-Za-z]{0,5}\d{3,}[A-Za-z0-9-]*$/.test(String(name || '').replace(/\s*[|\u2013\u2014].*$/, '').trim())) {
      return '';
    }
    return String(name || '').replace(/\s*[|–—]\s*[^|–—]+$/, '').replace(/\s*\((?:ab|[A-Z]{1,4})?-?\d[A-Za-z0-9-]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  }
  function nameFromLink(link) {
    let segment = '';
    try {
      const parts = new URL(link).pathname.split('/').filter(Boolean);
      // the last part that has letters (an address can end with a bare number)
      segment = decodeURIComponent(parts.reverse().find(function (part) {
        return /[A-Za-z]{3,}/.test(part);
      }) || '');
    } catch (error) {
      return '';
    }
    segment = segment.replace(/\.(html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ');
    // the catalog number at the end ("ab137321", "MAB1259", "12345")
    segment = segment.replace(/\s+(?:ab|mab|sc|nb|gtx)?\d{3,}[a-z0-9]*$/i, '').trim();
    return segment === '' ? '' : segment.charAt(0).toUpperCase() + segment.slice(1);
  }

  // the name of an item that is only a link: from the address; when that says nothing (the vendor's own name, a bare code), the vendor and the catalog number
  function linkName(link) {
    const typed = nameFromLink(link);
    const vendor = vendorOfLink(link);
    const catalog = catalogOfLink(link);
    if (typed === '' || typed.length < 4 || (vendor !== '' && normalName(typed) !== '' && normalName(vendor).indexOf(normalName(typed)) !== -1)) {
      return [vendor, catalog].filter(Boolean).join(' ');
    }
    return typed;
  }

  // ---- an item is added once. The lines of an order that are in the Database already are found (a primer by its letters, on either strand;
  // the other items by the same name or the same catalog number: a similar name is another product), so that they are not added again.
  let primerListPromise = null;
  function primersOnce() {
    if (!primerListPromise) {
      primerListPromise = window.PrimerTools.allPrimers().catch(function () {
        primerListPromise = null;
        return [];
      });
    }
    return primerListPromise;
  }
  function forgetPrimers() {
    primerListPromise = null;
  }
  function normalName(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  // The search of the Database does not take "/", "(", "%" or "_" in its text (the name "Ampicillin 100 mg/ml" found nothing, so an entry that was
  // added was not seen and could be added again): the longest part of the name without such a sign is searched, the names are compared after.
  function searchTerm(name) {
    const parts = String(name || '').split(/[^\p{L}\p{N}\- ]+/u).map(function (part) {
      return part.trim();
    }).filter(Boolean);
    parts.sort(function (a, b) {
      return b.length - a.length;
    });
    return parts[0] || String(name || '').trim();
  }
  // {id, title} of the entry that is there, or null
  async function findExisting(row) {
    if (row.sequence) {
      await loadPrimerTools();
      const tools = window.PrimerTools;
      if (!tools) {
        return null;
      }
      const forward = tools.clean(row.sequence);
      const reverse = tools.reverseComplement(forward);
      const found = (await primersOnce()).find(function (primer) {
        return primer.sequence === forward || primer.sequence === reverse;
      });
      return found ? { id: found.id, title: found.title } : null;
    }
    const term = String(row.name || '').trim();
    if (term === '') {
      return null;
    }
    const response = await fetch('api/v2/inventory?limit=50&q=' + encodeURIComponent(searchTerm(term)), { credentials: 'same-origin' });
    const entries = response.ok ? await response.json().catch(function () {
      return [];
    }) : [];
    const wanted = normalName(term);
    const catalog = String(row.catalog || '').toLowerCase();
    const same = (Array.isArray(entries) ? entries : []).find(function (entry) {
      return normalName(entry.title) === wanted || (catalog.length >= 4 && String(entry.metadata || '').toLowerCase().indexOf(catalog) !== -1);
    });
    return same ? { id: same.id, title: same.title } : null;
  }
  async function markExisting(list) {
    for (const row of list) {
      try {
        row.existing = await findExisting(row);
      } catch (error) {
        row.existing = null;
      }
      if (row.existing) {
        row.ticked = false;
      }
    }
  }

  // ---- the window
  function open(options) {
    const settings = options || {};
    const back = element('div', '', '', 'position:fixed;inset:0;z-index:1055;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:2rem 1rem');
    const box = element('div', '', '', 'background:var(--bg,#fff);color:inherit;border-radius:8px;max-width:980px;width:100%;padding:1rem 1.25rem;box-shadow:0 8px 30px rgba(0,0,0,.3)');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    back.append(box);
    document.body.append(back);
    const close = function () {
      back.remove();
    };
    back.addEventListener('mousedown', function (event) {
      if (event.target === back) {
        close();
      }
    });
    box.append(element('h5', '', 'Add from an order'));
    const search = element('input', 'form-control form-control-sm mb-1');
    search.type = 'search';
    search.placeholder = 'Search an order by number, title, vendor or status';
    search.setAttribute('aria-label', 'Search orders');
    // my orders or everyone's, and the order of the list: the newest first or the oldest first
    let mineOnly = true;
    let newestFirst = true;
    try {
      mineOnly = window.localStorage.getItem('orderToDatabaseMine') !== '0';
    } catch (error) {
      mineOnly = true;
    }
    const filters = element('div', 'd-flex flex-wrap align-items-center mb-1', '', 'gap:.5rem');
    const scope = element('div', 'btn-group btn-group-sm');
    const scopeButtons = [['My orders', true], ['All orders', false]].map(function (item) {
      const b = element('button', 'btn btn-outline-secondary', item[0]);
      b.type = 'button';
      b.addEventListener('click', function () {
        mineOnly = item[1];
        try {
          window.localStorage.setItem('orderToDatabaseMine', mineOnly ? '1' : '0');
        } catch (error) {
          // not remembered
        }
        syncScope();
        if (typeof refill === 'function') {
          refill();
        }
      });
      scope.append(b);
      return b;
    });
    const syncScope = function () {
      scopeButtons[0].classList.toggle('active', mineOnly);
      scopeButtons[1].classList.toggle('active', !mineOnly);
    };
    syncScope();
    const sorter = element('select', 'form-control form-control-sm w-auto');
    sorter.setAttribute('aria-label', 'Sort the orders');
    [['new', 'Newest first'], ['old', 'Oldest first']].forEach(function (o) {
      const option = element('option', '', o[1]);
      option.value = o[0];
      sorter.append(option);
    });
    sorter.addEventListener('change', function () {
      newestFirst = sorter.value === 'new';
      if (typeof refill === 'function') {
        refill();
      }
    });
    let refill = null;
    let myId = 0;
    filters.append(scope, sorter);
    const pick = element('select', 'form-control form-control-sm mb-2');
    pick.setAttribute('aria-label', 'Order');
    const info = element('p', 'small text-muted mb-2', 'Loading the orders...');
    const tableBox = element('div');
    const message = element('p', 'small mb-2');
    const buttons = element('div', 'd-flex flex-wrap justify-content-end mt-2', '', 'gap:.5rem');
    // the folder the entries of "My entries" are filed in (the Database has its own folders)
    const folderRow = element('div', 'd-flex align-items-center mt-2', '', 'gap:.5rem');
    const folderChoice = element('select', 'form-control form-control-sm', '', 'width:auto;max-width:60%');
    folderChoice.setAttribute('aria-label', 'Folder for My entries');
    const noFolder = element('option', '', 'No folder (Unfiled)');
    noFolder.value = '0';
    folderChoice.append(noFolder);
    folderRow.append(element('span', 'small text-muted', 'File My entries in the folder:'), folderChoice);
    fetch('registry-transfer.php?folders=1', { credentials: 'same-origin' }).then(function (r) {
      return r.json();
    }).then(function (body) {
      // your own folders only: not the folders of the Database, not the folders of the others
      (body.folders || []).filter(function (f) {
        return !f.database && Number(f.owner) === Number(body.me);
      }).forEach(function (f) {
        const option = element('option', '', f.path);
        option.value = String(f.id);
        folderChoice.append(option);
      });
    }).catch(function () {
      // without the list the entries stay unfiled
    });
    // the place the things of the order are stored in (one container each); none leaves them unstored
    const storageRow = element('div', 'd-flex align-items-center mt-2', '', 'gap:.5rem');
    const storageChoice = element('select', 'form-control form-control-sm', '', 'width:auto;max-width:60%');
    storageChoice.setAttribute('aria-label', 'Store them in');
    const noStorage = element('option', '', 'Not stored yet');
    noStorage.value = '0';
    storageChoice.append(noStorage);
    storageRow.append(element('span', 'small text-muted', 'Store them in:'), storageChoice);
    fetch('api/v2/storage_units?hierarchy=1', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(function (r) {
      return r.json();
    }).then(function (units) {
      // the places that hold things directly: a box, a rack or any place without places inside
      units.filter(function (u) {
        return Number(u.children_count) === 0;
      }).sort(function (a, b) {
        return String(a.full_path).localeCompare(String(b.full_path), undefined, { numeric: true, sensitivity: 'base' });
      }).forEach(function (u) {
        const option = element('option', '', u.full_path);
        option.value = String(u.id);
        storageChoice.append(option);
      });
    }).catch(function () {
      // without the list the entries stay unstored
    });
    box.append(filters, search, pick, info, tableBox, message, folderRow, storageRow, buttons);

    let modules = [];
    let rows = [];
    const moduleByTitle = function (title) {
      return modules.find(function (m) {
        return m.title === title;
      }) || modules[0];
    };

    const detail = function (row) {
      const module = moduleByTitle(row.moduleTitle);
      if (!row.fields) {
        row.fields = defaultsFor(module, row);
      }
      const layer = element('div', '', '', 'position:fixed;inset:0;z-index:1060;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:3rem 1rem');
      const card = element('div', '', '', 'background:var(--bg,#fff);border-radius:8px;max-width:560px;width:100%;padding:1rem 1.25rem;box-shadow:0 8px 30px rgba(0,0,0,.3)');
      layer.append(card);
      card.append(element('h6', '', row.name || 'New entry'), element('p', 'small text-muted', 'All the columns of ' + module.title + '. What the order said is filled in.'));
      const inputs = {};
      (module.fields || []).forEach(function (f) {
        const label = element('label', 'd-block mb-2');
        label.append(element('span', 'd-block small text-muted', f.name));
        let input;
        if (f.type === 'select') {
          input = element('select', 'form-control form-control-sm');
          const blank = element('option', '', '');
          blank.value = '';
          input.append(blank);
          (f.options || []).forEach(function (o) {
            const option = element('option', '', o);
            option.value = o;
            input.append(option);
          });
        } else {
          input = element('input', 'form-control form-control-sm');
          input.type = f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text');
        }
        input.value = row.fields[f.name] || '';
        inputs[f.name] = input;
        label.append(input);
        card.append(label);
      });
      // the modules that need a sequence file (plasmids): the file, or the sequence pasted, is attached to the entry, and then it can go in the Database
      let fileInput = null;
      let pasted = null;
      if (module.settings && module.settings.requires_sequence_file) {
        card.append(element('h6', 'mt-3', 'Sequence'));
        card.append(element('p', 'small text-muted mb-1', row.sequenceFile ? 'Attached: ' + row.sequenceFile.name : 'No sequence yet: without one the entry can only go to My entries.'));
        fileInput = element('input', 'form-control-file mb-2');
        fileInput.type = 'file';
        fileInput.accept = '.gb,.gbk,.gbff,.fasta,.fa,.fna,.dna';
        pasted = element('textarea', 'form-control form-control-sm mb-2');
        pasted.rows = 3;
        pasted.placeholder = 'or paste the sequence (bases only, or FASTA)';
        card.append(fileInput, pasted);
      }
      const done = element('button', 'btn btn-primary btn-sm', 'Done');
      done.type = 'button';
      done.addEventListener('click', async function () {
        Object.keys(inputs).forEach(function (name) {
          row.fields[name] = inputs[name].value;
        });
        const safe = (row.name || 'sequence').replace(/[^A-Za-z0-9_.-]+/g, '_');
        if (fileInput && fileInput.files && fileInput.files[0]) {
          row.sequenceFile = { name: fileInput.files[0].name, content: await fileToBase64(fileInput.files[0]) };
        } else if (pasted && pasted.value.trim() !== '') {
          const text = pasted.value.trim();
          row.sequenceFile = { name: safe + '.fasta', content: toBase64(text.charAt(0) === '>' ? text : '>' + (row.name || 'sequence') + '\n' + text.replace(/\s+/g, '')) };
        }
        layer.remove();
        draw();
      });
      card.append(element('div', 'text-right', '', '').appendChild(done) && done.parentNode);
      document.body.append(layer);
    };

    const draw = function () {
      tableBox.replaceChildren();
      if (rows.length === 0) {
        tableBox.append(element('p', 'text-muted', 'Choose an order.'));
        buttons.replaceChildren();
        return;
      }
      const table = element('table', 'table table-sm mb-0', '', 'table-layout:fixed;width:100%');
      const head = element('tr');
      [['', '5%'], ['Name', '38%'], ['Vendor', '22%'], ['Module', '18%'], ['', '17%']].forEach(function (h) {
        const th = element('th', '', h[0]);
        th.style.width = h[1];
        head.append(th);
      });
      const thead = element('thead');
      thead.append(head);
      const all = element('input');
      all.type = 'checkbox';
      all.checked = rows.every(function (r) {
        return r.ticked || r.existing;
      });
      all.setAttribute('aria-label', 'Select all');
      all.addEventListener('change', function () {
        rows.forEach(function (r) {
          r.ticked = all.checked && r.name.trim() !== '' && !r.existing;
        });
        draw();
      });
      head.firstChild.append(all);
      const body = element('tbody');
      rows.forEach(function (row) {
        const tr = element('tr', '', '', row.ticked ? '' : 'opacity:.5');
        const tick = element('input');
        tick.type = 'checkbox';
        tick.checked = row.ticked;
        // an item that is in the Database already is not added again
        tick.disabled = Boolean(row.existing);
        tick.title = row.existing ? 'This is in the Database already' : '';
        tick.setAttribute('aria-label', 'Add this row');
        tick.addEventListener('change', function () {
          row.ticked = tick.checked;
          draw();
        });
        const c0 = element('td');
        c0.append(tick);
        const name = element('input', 'form-control form-control-sm');
        name.type = 'text';
        name.value = row.name;
        name.addEventListener('input', function () {
          row.name = name.value;
        });
        const c1 = element('td');
        c1.append(name);
        const vendor = element('input', 'form-control form-control-sm');
        vendor.type = 'text';
        vendor.value = row.vendor;
        vendor.addEventListener('input', function () {
          row.vendor = vendor.value;
          if (row.fields) {
            Object.keys(row.fields).forEach(function (k) {
              if (/^(supplier|vendor)/i.test(k)) {
                row.fields[k] = row.vendor;
              }
            });
          }
        });
        const c2 = element('td');
        c2.append(vendor);
        const mod = element('select', 'form-control form-control-sm');
        modules.forEach(function (m) {
          const option = element('option', '', m.title);
          option.value = m.title;
          mod.append(option);
        });
        mod.value = row.moduleTitle;
        mod.addEventListener('change', function () {
          row.moduleTitle = mod.value;
          row.fields = null;
        });
        const c3 = element('td');
        c3.append(mod);
        const more = element('button', 'btn btn-secondary btn-sm', 'Details...');
        more.type = 'button';
        more.title = 'Catalog number, clone, link and the other columns';
        more.addEventListener('click', function () {
          detail(row);
        });
        const hint = element('div', 'small text-muted', [row.catalog ? 'cat. ' + row.catalog : '', row.link ? 'link' : 'no link', row.sequenceFile ? 'sequence' : ''].filter(Boolean).join(' · '));
        if (row.existing) {
          const link = element('a', '', row.existing.title);
          link.href = 'registry.php?mode=view&id=' + row.existing.id;
          link.target = '_blank';
          link.rel = 'noopener';
          link.style.fontSize = 'inherit';
          hint.textContent = '';
          hint.append(document.createTextNode('In the Database: '), link);
        }
        const c4 = element('td');
        c4.append(more, hint);
        tr.append(c0, c1, c2, c3, c4);
        body.append(tr);
      });
      table.append(thead, body);
      tableBox.append(table);
      // plasmids from Addgene: their sequences come from the Addgene account of the user (the page of a plasmid shows the sequence when signed in)
      const wantSequence = rows.filter(function (r) {
        const mod = moduleByTitle(r.moduleTitle);
        return r.ticked && addgeneId(r.link) !== '' && mod && mod.settings && mod.settings.requires_sequence_file && !r.sequenceFile;
      });
      if (wantSequence.length > 0) {
        const helper = element('div', 'small border rounded p-2 mt-2');
        helper.append(element('div', 'font-weight-bold', 'Sequences from Addgene (' + wantSequence.length + ')'));
        helper.append(element('div', 'text-muted mb-1', 'Addgene shows the sequences only when you are signed in. In a tab where you are signed in to addgene.org, open the console, paste the script, and it saves one file. Choose that file here and the plasmids get their sequences.'));
        const copy = element('button', 'btn btn-secondary btn-sm mr-2', 'Copy the script');
        copy.type = 'button';
        copy.addEventListener('click', async function () {
          const pairs = wantSequence.map(function (r) {
            return [rows.indexOf(r), addgeneId(r.link)];
          });
          const script = '(async()=>{const ids=' + JSON.stringify(pairs) + ';const out={};for(const [k,a] of ids){try{const h=await (await fetch("/"+a+"/sequences/",{credentials:"include"})).text();const d=new DOMParser().parseFromString(h,"text/html");const t=[...d.querySelectorAll("textarea")].map(x=>x.value||x.textContent).filter(v=>v.trim().startsWith(">"));out[k]={addgene:a,fasta:t[0]||""};}catch(e){out[k]={addgene:a,fasta:""};}await new Promise(r=>setTimeout(r,1500));}const l=document.createElement("a");l.href=URL.createObjectURL(new Blob([JSON.stringify(out)],{type:"application/json"}));l.download="addgene-sequences.json";l.click();console.log("done",Object.values(out).filter(x=>x.fasta).length,"of",ids.length);})();';
          try {
            await navigator.clipboard.writeText(script);
            copy.textContent = 'Copied';
          } catch (error) {
            window.prompt('Copy this script', script);
          }
        });
        const load = element('input', 'form-control-file d-inline-block', '', 'width:auto');
        load.type = 'file';
        load.accept = '.json';
        load.setAttribute('aria-label', 'The file the script saved');
        load.addEventListener('change', async function () {
          if (!load.files || !load.files[0]) {
            return;
          }
          try {
            const found = JSON.parse(await load.files[0].text());
            Object.keys(found).forEach(function (key) {
              const r = rows[Number(key)];
              if (r && found[key].fasta) {
                r.sequenceFile = { name: (r.name || 'sequence').replace(/[^A-Za-z0-9_.-]+/g, '_') + '.fasta', content: toBase64(found[key].fasta) };
              }
            });
            draw();
          } catch (error) {
            message.className = 'small mb-2 text-danger';
            message.textContent = 'This is not the file of the script.';
          }
        });
        helper.append(copy, load);
        tableBox.append(helper);
      }
      // the lines with a link: the page of the product is opened, copied (Ctrl+A, Ctrl+C) and pasted here; its details (catalog number,
      // clone, host, target...) are read from the text, in the browser (the server has no internet)
      const withLink = rows.map(function (r, index) {
        return { row: r, index: index };
      }).filter(function (item) {
        return item.row.ticked && /^https?:\/\//i.test(item.row.link || '') && !/addgene\.org/i.test(item.row.link);
      });
      if (withLink.length > 0) {
        const helper = element('div', 'small border rounded p-2 mt-2');
        helper.append(element('div', 'font-weight-bold', 'Fill in from the page of the vendor'));
        helper.append(element('div', 'text-muted mb-1', 'Open the page, select everything (Ctrl+A), copy it (Ctrl+C) and paste it in the box. The catalog number, clone, host, target and the other columns are read from it, here in your browser. A screenshot or a PDF of the page (a datasheet) can be pasted, dropped or chosen instead.'));
        const which = element('select', 'form-control form-control-sm mb-1', '', 'width:auto;max-width:100%');
        withLink.forEach(function (item) {
          const option = element('option', '', (item.row.name || 'line ' + (item.index + 1)) + ' (' + item.row.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40) + ')');
          option.value = String(item.index);
          which.append(option);
        });
        const open = element('a', 'btn btn-secondary btn-sm mr-2 mb-1', 'Open the page');
        open.target = '_blank';
        open.rel = 'noopener';
        const sync = function () {
          open.href = rows[Number(which.value)].link;
        };
        which.addEventListener('change', sync);
        sync();
        const paste = element('textarea', 'form-control form-control-sm mb-1', '', 'min-height:5rem');
        paste.placeholder = 'Paste the text of the page here';
        const fill = element('button', 'btn btn-primary btn-sm mb-1', 'Fill in');
        fill.type = 'button';
        fill.addEventListener('click', function () {
          const target = rows[Number(which.value)];
          const page = readPageText(paste.value, target.link);
          const found = Object.keys(page.props).length + (page.sku ? 1 : 0);
          if (paste.value.trim() === '' || found === 0) {
            message.className = 'small mb-2 text-danger';
            message.textContent = 'Nothing could be read from this text. Copy the whole page (Ctrl+A, Ctrl+C) of the product and paste it again.';
            return;
          }
          applyPage(target, page);
          draw();
          message.className = 'small mb-2';
          message.textContent = 'Filled in from the page: ' + [target.catalog ? 'catalog ' + target.catalog : '', target.clone ? 'clone ' + target.clone : '', target.host ? 'host ' + target.host : '', target.target ? 'target ' + target.target : ''].filter(Boolean).join(', ') + '. Details... shows all the columns.';
        });
        // an image (a screenshot of the page) pasted in the box, dropped on it or chosen is read by the browser, and its text is filled in
        const image = element('input', 'form-control-file d-inline-block ml-2 mb-1', '', 'width:auto');
        image.type = 'file';
        image.accept = 'image/*,application/pdf,.pdf';
        image.setAttribute('aria-label', 'A screenshot or a PDF of the page');
        const fromImage = async function (file) {
          message.className = 'small mb-2';
          const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
          message.textContent = 'Reading the ' + (isPdf ? 'PDF' : 'image') + '... (the first time it takes a little longer)';
          try {
            const text = await (isPdf ? readPdf : readImage)(file, function (percent) {
              message.textContent = 'Reading the ' + (isPdf ? 'PDF' : 'image') + '... ' + percent + '%';
            });
            paste.value = (paste.value.trim() === '' ? '' : paste.value + '\n') + text;
            fill.click();
          } catch (error) {
            message.className = 'small mb-2 text-danger';
            message.textContent = 'The file could not be read: ' + (error.message || error);
          }
        };
        const imageOf = function (list) {
          return Array.from(list || []).find(function (file) {
            return /^image\//.test(file.type) || file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
          });
        };
        paste.addEventListener('paste', function (event) {
          const file = imageOf(event.clipboardData && event.clipboardData.files);
          if (file) {
            event.preventDefault();
            fromImage(file);
          }
        });
        paste.addEventListener('dragover', function (event) {
          event.preventDefault();
        });
        paste.addEventListener('drop', function (event) {
          const file = imageOf(event.dataTransfer && event.dataTransfer.files);
          if (file) {
            event.preventDefault();
            fromImage(file);
          }
        });
        image.addEventListener('change', function () {
          if (image.files && image.files[0]) {
            fromImage(image.files[0]);
          }
        });
        paste.placeholder = 'Paste the text of the page here, or paste or drop a screenshot (an image) or a PDF of it';
        const pick = element('div', 'd-flex flex-wrap align-items-center');
        pick.append(open, which, image);
        helper.append(pick, paste, fill);
        tableBox.append(helper);
      }
      const ticked = rows.filter(function (r) {
        return r.ticked && r.name.trim() !== '' && !r.existing;
      });
      const already = rows.filter(function (r) {
        return r.existing;
      }).length;
      info.textContent = (already > 0 ? already + ' of the lines ' + (already === 1 ? 'is' : 'are') + ' in the Database already (not added again). ' : '') + rows.length + (rows.length === 1 ? ' line' : ' lines') + ' read, ' + ticked.length + ' ticked. Untick a row to leave it out. Details... shows the other columns.';
      buttons.replaceChildren();
      const cancel = element('button', 'btn btn-secondary btn-sm', 'Close');
      cancel.type = 'button';
      cancel.addEventListener('click', close);
      const mine = element('button', 'btn btn-secondary btn-sm', 'Add ' + ticked.length + ' to My entries');
      const lab = element('button', 'btn btn-primary btn-sm', 'Add ' + ticked.length + ' to the Database');
      [mine, lab].forEach(function (b) {
        b.type = 'button';
        b.disabled = ticked.length === 0;
      });
      mine.addEventListener('click', function () {
        add(ticked, 'personal');
      });
      lab.addEventListener('click', function () {
        add(ticked, 'both');
      });
      buttons.append(cancel, mine, lab);
    };

    // one add at a time (a second click while it works would add everything twice)
    let adding = false;
    const add = async function (ticked, register) {
      if (adding) {
        return;
      }
      adding = true;
      message.className = 'small mb-2';
      message.textContent = 'Adding...';
      // what is in the Database already is left out, also what the same ticks say twice; each is looked for again just before it is added
      const seen = new Set();
      const unique = [];
      for (const row of ticked) {
        if (row.existing) {
          continue;
        }
        const tools = window.PrimerTools;
        const letters = row.sequence && tools ? [tools.clean(row.sequence), tools.reverseComplement(tools.clean(row.sequence))].sort()[0] : '';
        const key = row.sequence ? 'seq:' + letters : 'name:' + normalName(row.moduleTitle + ' ' + row.name);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        try {
          row.existing = await findExisting(row);
        } catch (error) {
          row.existing = null;
        }
        if (!row.existing) {
          unique.push(row);
        }
      }
      const skipped = ticked.length - unique.length;
      ticked = unique;
      if (ticked.length === 0) {
        message.className = 'small mb-2 text-danger';
        message.textContent = 'Nothing was added: ' + (skipped === 1 ? 'it is' : 'they are') + ' in the Database already.';
        draw();
        adding = false;
        return;
      }
      const groups = {};
      ticked.forEach(function (row) {
        const module = moduleByTitle(row.moduleTitle);
        if (!row.fields) {
          row.fields = defaultsFor(module, row);
        }
        (groups[module.id] = groups[module.id] || { module: module, rows: [] }).rows.push(row);
      });
      let made = 0;
      const problems = [];
      // a module that needs a sequence file (plasmids): the rows that have one go where you chose, the others to My entries
      const batches = [];
      Object.keys(groups).forEach(function (key) {
        const group = groups[key];
        const needsFile = Boolean(group.module.settings && group.module.settings.requires_sequence_file);
        if (register === 'both' && needsFile) {
          const withFile = group.rows.filter(function (r) {
            return r.sequenceFile;
          });
          const without = group.rows.filter(function (r) {
            return !r.sequenceFile;
          });
          if (withFile.length > 0) {
            batches.push({ module: group.module, register: 'both', rows: withFile });
          }
          if (without.length > 0) {
            batches.push({ module: group.module, register: 'personal', rows: without });
            problems.push(without.length + ' ' + group.module.title + ' without a sequence were added to My entries: they need a sequence file before they can go in the Database.');
          }
        } else {
          batches.push({ module: group.module, register: register, rows: group.rows });
        }
      });
      try {
        for (const batch of batches) {
          const group = batch;
          const response = await fetch('registry-transfer.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
            body: JSON.stringify({
              category: group.module.id,
              register: batch.register,
              folder_id: Number(folderChoice.value) || 0,
              storage_id: Number(storageChoice.value) || 0,
              rows: group.rows.map(function (r) {
                const fields = {};
                Object.keys(r.fields).forEach(function (k) {
                  if (r.fields[k] !== '') {
                    fields[k] = r.fields[k];
                  }
                });
                return { title: r.name.trim(), fields: fields, extra: r.extra || {}, sequence_file: r.sequenceFile || undefined };
              }),
            }),
          });
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error || 'The entries could not be added.');
          }
          made += body.created || 0;
          (body.skipped || []).forEach(function (s) {
            problems.push(group.rows[Number(s.row.replace(/\D+/g, '').slice(0, 3)) - 1] ? s.reason : s.reason);
          });
        }
        const text = made + (made === 1 ? ' entry' : ' entries') + ' added.' + (skipped > 0 ? ' ' + skipped + (skipped === 1 ? ' was' : ' were') + ' in the Database already: not added again.' : '') + (problems.length > 0 ? ' Not added: ' + problems.join(' ') : '');
        // what was added is looked for again: its lines show that it is in the Database now, and the cards of the orders say so
        forgetPrimers();
        await markExisting(rows);
        draw();
        window.dispatchEvent(new CustomEvent('otd:added'));
        message.className = problems.length > 0 ? 'small mb-2 text-danger' : 'small mb-2 text-success';
        message.textContent = text;
        if (made > 0 && /registry\.php/.test(window.location.pathname)) {
          window.setTimeout(function () {
            window.location.reload();
          }, problems.length > 0 ? 3500 : 900);
        }
      } catch (error) {
        message.className = 'small mb-2 text-danger';
        message.textContent = error.message;
      } finally {
        adding = false;
      }
    };

    const previewDown = function () {
      try {
        return Date.now() - Number(window.localStorage.getItem('otd-preview-down') || 0) < 30 * 60 * 1000;
      } catch (error) {
        return false;
      }
    };
    const markPreviewDown = function () {
      try {
        window.localStorage.setItem('otd-preview-down', String(Date.now()));
      } catch (error) {
        // asked again next time
      }
    };
    // what the order holds besides its text: the Excel sheets of oligos, the resources of its lines, and the pages the links lead to
    const enrich = async function (order, found) {
      const result = found.slice();
      const orderRef = '#' + order.id + ' ' + order.title;
      const when = String(order.order_date || order.created_at || '').slice(0, 10);
      // the sheets (IDT, Microsynth...) attached to the order: one primer for each line
      const sheets = (order.uploads || []).filter(function (upload) {
        return /\.xlsx$/i.test(upload.real_name || '');
      });
      // all the sheets are asked at once
      const answers = await Promise.all(sheets.map(function (upload) {
        return fetch('primers.php?order_sheet=1&order=' + order.id + '&f=' + encodeURIComponent(upload.long_name), { credentials: 'same-origin' }).then(function (response) {
          return response.json().then(function (answer) {
            return response.ok ? answer : null;
          });
        }).catch(function () {
          return null;
        });
      }));
      for (const [position, upload] of sheets.entries()) {
        try {
          const answer = answers[position];
          if (!answer) {
            continue;
          }
          const vendor = /idt/i.test(upload.real_name) ? 'IDT' : (/microsynth/i.test(upload.real_name) ? 'Microsynth' : ((result[0] && result[0].vendor) || ''));
          (answer.oligos || []).forEach(function (oligo) {
            const row = { name: oligo.name || '', vendor: vendor, link: '', catalog: '', clone: '', host: '', sequence: String(oligo.sequence || '').toUpperCase(), purification: oligo.purification || '', moduleTitle: 'Primers', fields: null, ticked: String(oligo.name || '').trim() !== '', sheet: upload.real_name };
            readName(row);
            result.push(row);
          });
        } catch (error) {
          // the sheet cannot be read: the other lines stay
        }
      }
      // a line that is only the title of an order of oligos ("Oligos; IDT") is not an entry when the sheet gave the oligos
      const withSheets = result.some(function (r) {
        return r.sheet;
      });
      let rowsOut = result.filter(function (r) {
        return !(withSheets && !r.sheet && !r.link && !r.sequence && /^oligos?\b/i.test(r.name));
      });
      // the resources that are the lines of the order: their own columns give the vendor, the catalog number and the link
      const resources = await Promise.all((order.items || []).map(function (item) {
        const id = item.id || item.item_id || item.entity_id;
        return id ? fetch('api/v2/items/' + id, { credentials: 'same-origin' }).then(function (response) {
          return response.json();
        }).catch(function () {
          return null;
        }) : Promise.resolve(null);
      }));
      for (const resource of resources) {
        try {
          if (!resource) {
            continue;
          }
          const extra = (resource.metadata_decoded && resource.metadata_decoded.extra_fields) || {};
          const pick = function (pattern) {
            const key = Object.keys(extra).find(function (k) {
              return pattern.test(k);
            });
            return key ? String(extra[key].value || '') : '';
          };
          const row = { name: resource.title || '', vendor: pick(/^(supplier|vendor)/i), link: pick(/^(link|url|website)/i), catalog: pick(/^(catalog|cat\.?|reference)/i), clone: pick(/^clone/i), host: '', sequence: '', moduleTitle: '', fields: null, ticked: true };
          row.moduleTitle = guessModule(row);
          readName(row);
          rowsOut.push(row);
        } catch (error) {
          // this line cannot be read
        }
      }
      // the pages the links lead to: their titles often carry the vendor, the catalog number and the name
      await Promise.all(rowsOut.filter(function (r) {
        return /^https?:\/\//i.test(r.link || '');
      }).map(async function (r) {
        try {
          // the page itself, when the server can read it: all the columns, like a pasted page
          const read = await pageFromLink(r.link);
          if (read) {
            applyPage(r, read);
            r.pageRead = true;
            return;
          }
          if (previewDown()) {
            return;
          }
          // the server asks the page itself: without internet it waits for its own timeout (about 5 seconds), so it is given little time and,
          // when it gets nothing, it is not asked again for half an hour
          const stop = new AbortController();
          const timer = window.setTimeout(function () {
            stop.abort();
          }, 1500);
          let preview = {};
          try {
            preview = await (await fetch('api/v2/link_preview?url=' + encodeURIComponent(r.link), { credentials: 'same-origin', signal: stop.signal })).json();
          } catch (error) {
            preview = {};
          }
          window.clearTimeout(timer);
          const title = String(preview.title || '');
          if (title === '') {
            markPreviewDown();
            return;
          }
          r.pageTitle = title;
          if (!r.catalog) {
            const found2 = /(?:cat(?:alog)?(?:ue)?\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*|\b#\s*)([A-Za-z0-9][A-Za-z0-9-]{2,})/i.exec(title);
            r.catalog = found2 ? found2[1] : '';
          }
          if (!r.clone) {
            const clone = /\bclone\s*[:#]?\s*([A-Za-z0-9-]{2,})/i.exec(title);
            r.clone = clone ? clone[1] : '';
          }
          if (!r.name.trim()) {
            r.name = title.split(/\s[|·–-]\s/)[0].trim();
            r.ticked = r.name !== '';
          }
          r.vendor = r.vendor || vendorOfLink(r.link) || (preview.hostname ? String(preview.hostname).replace(/^www\./, '') : '');
        } catch (error) {
          // the page cannot be read: the link stays as it is
        }
      }));
      // the melting temperature of the primers, when the primer tools are there
      if (rowsOut.some(function (r) {
        return r.sequence;
      })) {
        await loadPrimerTools();
      }
      if (window.PrimerTools && typeof window.PrimerTools.tm === 'function') {
        rowsOut.forEach(function (r) {
          if (r.sequence && !r.tm) {
            r.tm = window.PrimerTools.tm(r.sequence);
          }
        });
      }
      rowsOut.forEach(function (r) {
        r.moduleTitle = r.moduleTitle || guessModule(r);
        r.extra = { 'From order': orderRef };
        if (when) {
          r.extra['Order date'] = when;
        }
        if (order.order_number) {
          r.extra['Order number'] = String(order.order_number);
        }
        if (r.sheet) {
          r.extra['Order sheet'] = r.sheet;
        }
        r.fields = null;
      });
      return rowsOut;
    };

    const load = async function (orderId) {
      info.textContent = 'Reading the order...';
      const order = await (await fetch('api/v2/orders/' + orderId, { credentials: 'same-origin' })).json();
      rows = await enrich(order, parseOrder(order));
      info.textContent = 'Looking for what is in the Database already...';
      await markExisting(rows);
      draw();
    };

    Promise.all([
      fetch('registry-modules.php', { credentials: 'same-origin' }).then(function (r) {
        return r.json();
      }),
      fetch('api/v2/orders?limit=200', { credentials: 'same-origin' }).then(function (r) {
        return r.json();
      }),
      fetch('registry-transfer.php?users=1', { credentials: 'same-origin' }).then(function (r) {
        return r.json();
      }).catch(function () {
        return {};
      }),
    ]).then(function (loaded) {
      myId = Number(loaded[2] && loaded[2].me) || 0;
      modules = loaded[0].modules || [];
      const orders = (Array.isArray(loaded[1]) ? loaded[1] : []).filter(function (o) {
        return !o.archived;
      });
      // the list of orders, narrowed by what is typed above it
      const fill = function () {
        const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
        const dateOf = function (o) {
          return String(o.order_date || o.created_at || '');
        };
        const shown = orders.filter(function (o) {
          if (mineOnly && myId > 0 && Number(o.userid) !== myId) {
            return false;
          }
          const text = ('#' + o.id + ' ' + o.title + ' ' + o.status + ' ' + (o.order_number || '')).toLowerCase();
          return words.every(function (w) {
            return text.indexOf(w) !== -1;
          });
        });
        shown.sort(function (a, b) {
          return newestFirst ? dateOf(b).localeCompare(dateOf(a)) : dateOf(a).localeCompare(dateOf(b));
        });
        const current = pick.value;
        pick.replaceChildren();
        const blank = element('option', '', shown.length === 0 ? 'No order matches' : 'Choose an order (' + shown.length + ')');
        blank.value = '';
        pick.append(blank);
        shown.forEach(function (o) {
          const option = element('option', '', '#' + o.id + ' ' + o.title + ' · ' + o.status + ' · ' + dateOf(o).slice(0, 10));
          option.value = String(o.id);
          pick.append(option);
        });
        if (shown.some(function (o) {
          return String(o.id) === current;
        })) {
          pick.value = current;
        }
      };
      search.addEventListener('input', fill);
      refill = fill;
      fill();
      info.textContent = orders.length === 0 ? 'There are no orders.' : 'Choose an order to read its lines.';
      pick.addEventListener('change', function () {
        if (pick.value === '') {
          rows = [];
          draw();
          return;
        }
        load(pick.value).catch(function (error) {
          message.className = 'small mb-2 text-danger';
          message.textContent = error.message;
        });
      });
      const wanted = settings.orderId || Number(new URLSearchParams(window.location.search).get('order')) || 0;
      if (wanted > 0 && orders.some(function (o) {
        return o.id === wanted;
      })) {
        // an order of someone else that was opened on purpose is shown even in "My orders"
        const target = orders.find(function (o) {
          return o.id === wanted;
        });
        if (target && mineOnly && myId > 0 && Number(target.userid) !== myId) {
          mineOnly = false;
          syncScope();
          refill();
        }
        pick.value = String(wanted);
        load(wanted).catch(function () {});
      } else {
        draw();
      }
    }).catch(function (error) {
      info.textContent = 'The orders could not be loaded: ' + error.message;
    });
  }

  window.OrderToDatabase = { open: open, parse: parseOrder, applyPage: applyPage, readPageText: readPageText, cleanPageName: cleanPageName, nameFromLink: nameFromLink, defaultsFor: defaultsFor };

  // on the orders page: a button under the title; an order opened there (?order=) is the one that is read
  if (/orders\.php$/.test(window.location.pathname)) {
    const root = document.getElementById('ordersRoot');
    if (root && !document.getElementById('orderToDatabaseButton')) {
      const button = element('button', 'btn btn-secondary btn-sm mb-2', 'Add an order to the Database');
      button.type = 'button';
      button.id = 'orderToDatabaseButton';
      button.title = 'Read the lines of an order and add them as entries of the Database';
      button.addEventListener('click', function () {
        open({});
      });
      root.parentNode.insertBefore(button, root);
    }

    // each order says what kind it is (read from its title, its description and its files) and has its own button to add it to the Database:
    // "Add antibody to database", "Add primers to database"... It opens the window of the order with that order chosen.
    const NOUNS = { Primers: 'primers', Antibodies: 'antibody', Plasmids: 'plasmid', Consumables: 'consumable', Reagents: 'reagent' };
    const kindOf = function (card) {
      const title = ((card.querySelector('.orders-item-title') || {}).textContent || '').trim();
      const description = card.querySelector('.orders-item-description');
      const files = Array.from(card.querySelectorAll('li.orders-upload a[href*="download.php"]')).map(function (link) {
        return new URL(link.href, window.location.href).searchParams.get('name') || '';
      });
      // oligos: said in the title, or a sheet of oligos is attached (the sheet of an order of primers made by the editor)
      if (/\b(oligos?|primers?)\b/i.test(title) || files.some(function (name) {
        return /\.xlsx$/i.test(name) && /oligo|primer/i.test(name);
      })) {
        return 'Primers';
      }
      const rows = parseOrder({ title: title, notes: description ? description.innerHTML : '' });
      return rows.length > 0 && rows[0].moduleTitle ? rows[0].moduleTitle : 'Reagents';
    };
    // is the order in the Database already? The lines of the order are looked for by name (and catalog number) in the entries; the oligos
    // of a sheet by their letters in the primers. Gives {total, inDb}, or null when nothing can be told.
    const normal = function (text) {
      return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    };
    const checked = new Map();
    // the primers of the database are asked once for all the cards, and the checks go one after the other (not all at once)
    const allPrimersOnce = primersOnce;
    let line = Promise.resolve();
    const inDatabase = function (card, kind, orderId) {
      if (checked.has(orderId)) {
        return checked.get(orderId);
      }
      const work = new Promise(function (resolve) {
        line = line.then(function () {
          return check(card, kind, orderId);
        }).then(resolve, function () {
          resolve(null);
        });
      });
      checked.set(orderId, work);
      return work;
    };
    // the oligos of a sheet never change: they are kept by the browser
    const sheetOligos = async function (orderId, longName) {
      const key = 'otd-sheet-' + longName;
      try {
        const saved = window.localStorage.getItem(key);
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (error) {
        // read again
      }
      const response = await fetch('primers.php?order_sheet=1&order=' + orderId + '&f=' + encodeURIComponent(longName), { credentials: 'same-origin' });
      const answer = response.ok ? await response.json().catch(function () {
        return {};
      }) : {};
      const sequences = (answer.oligos || []).map(function (oligo) {
        return oligo.sequence;
      });
      if (response.ok) {
        try {
          window.localStorage.setItem(key, JSON.stringify(sequences));
        } catch (error) {
          // not kept
        }
      }
      return sequences;
    };
    const check = function (card, kind, orderId) {
      return (async function () {
        const title = ((card.querySelector('.orders-item-title') || {}).textContent || '').trim();
        const description = card.querySelector('.orders-item-description');
        const rows = parseOrder({ title: title, notes: description ? description.innerHTML : '' });
        if (kind === 'Primers') {
          await loadPrimerTools();
          const tools = window.PrimerTools;
          if (!tools) {
            return null;
          }
          const sequences = rows.map(function (row) {
            return row.sequence;
          }).filter(Boolean);
          for (const link of Array.from(card.querySelectorAll('li.orders-upload a[href*="download.php"]'))) {
            const url = new URL(link.href, window.location.href);
            if (!/\.xlsx$/i.test(url.searchParams.get('name') || '')) {
              continue;
            }
            (await sheetOligos(orderId, url.searchParams.get('f') || '')).forEach(function (sequence) {
              sequences.push(sequence);
            });
          }
          if (sequences.length === 0) {
            return null;
          }
          const database = await allPrimersOnce();
          // the same oligo in the notes and in the sheet is one
          const distinct = Array.from(new Set(sequences.map(function (sequence) {
            return tools.clean(sequence);
          })));
          // the entries of the primers that are there (to link to them)
          const items = [];
          distinct.forEach(function (sequence) {
            const forward = tools.clean(sequence);
            const reverse = tools.reverseComplement(forward);
            const found = database.find(function (primer) {
              return primer.sequence === forward || primer.sequence === reverse;
            });
            if (found && !items.some(function (item) {
              return item.id === found.id;
            })) {
              items.push({ id: found.id, title: found.title });
            }
          });
          const inDb = distinct.filter(function (sequence) {
            const forward = tools.clean(sequence);
            const reverse = tools.reverseComplement(forward);
            return database.some(function (primer) {
              return primer.sequence === forward || primer.sequence === reverse;
            });
          }).length;
          return { total: distinct.length, inDb: inDb, items: items };
        }
        const named = rows.filter(function (row) {
          return row.name.trim() !== '';
        });
        if (named.length === 0) {
          return null;
        }
        let inDb = 0;
        const items = [];
        for (const row of named) {
          const term = row.name.trim();
          const response = await fetch('api/v2/inventory?limit=50&q=' + encodeURIComponent(searchTerm(term)), { credentials: 'same-origin' });
          const entries = response.ok ? await response.json().catch(function () {
            return [];
          }) : [];
          const wanted = normal(term);
          const catalog = String(row.catalog || '').toLowerCase();
          const same = (Array.isArray(entries) ? entries : []).find(function (entry) {
            const have = normal(entry.title);
            // the same name, or the same catalog number: a similar name (another product of the vendor) is not the same entry
            return have === wanted || (catalog.length >= 4 && String(entry.metadata || '').toLowerCase().indexOf(catalog) !== -1);
          });
          inDb += same ? 1 : 0;
          if (same && !items.some(function (item) {
            return item.id === same.id;
          })) {
            items.push({ id: same.id, title: same.title });
          }
        }
        return { total: named.length, inDb: inDb, items: items };
      }());
    };
    const whenSeen = function (card, ask) {
      return new Promise(function (resolve) {
        if (!('IntersectionObserver' in window)) {
          resolve(ask());
          return;
        }
        const watcher = new IntersectionObserver(function (entries) {
          if (entries.some(function (entry) {
            return entry.isIntersecting;
          })) {
            watcher.disconnect();
            resolve(ask());
          }
        }, { rootMargin: '300px' });
        watcher.observe(card);
      });
    };
    const enhanceCards = function () {
      document.querySelectorAll('li.orders-card').forEach(function (card) {
        if (card.querySelector('.otd-add')) {
          return;
        }
        const idText = (card.querySelector('.orders-item-id') || {}).textContent || '';
        const found = /#(\d+)/.exec(idText);
        const meta = card.querySelector('.orders-item-meta');
        if (!found || !meta) {
          return;
        }
        const orderId = Number(found[1]);
        const kind = kindOf(card);
        const add = element('button', 'btn btn-sm otd-add', '', 'align-items:center;background:transparent;border:1px solid #1a9bb0;border-radius:999px;color:#1a9bb0;display:inline-flex;font-size:0.78rem;gap:0.35rem;line-height:1.2;margin-left:0.6rem;padding:0.15rem 0.7rem;vertical-align:middle;white-space:nowrap');
        add.type = 'button';
        if (kind === 'Primers') {
          // the button of the card does the work of the one on the sheet: that one is hidden (order-primers.js), it is clicked from here
          add.classList.add('otd-add-primers');
        }
        add.append(element('i', 'fas fa-database fa-fw'), document.createTextNode('Add ' + (NOUNS[kind] || 'entry') + ' to database'));
        add.title = 'This order looks like ' + (NOUNS[kind] || 'an item') + ': read its lines and add them to the Database (you can change the module in the window)';
        add.addEventListener('click', function () {
          // the sheet of oligos attached to the order has its own window (the primers of the sheet)
          const sheet = kind === 'Primers' ? card.querySelector('.op-add') : null;
          if (sheet) {
            sheet.click();
            return;
          }
          open({ orderId: orderId });
        });
        meta.append(add);
        // when the lines of the order are in the Database already, the button says so; asked when the card is seen, not for all the cards at once
        whenSeen(card, function () {
          return inDatabase(card, kind, orderId);
        }).then(function (state) {
          if (!state || state.total === 0 || state.inDb === 0) {
            return;
          }
          // The state is shown in the header of the card, next to the "On LabCollector" pill and in its look (the classes are copied from the
          // elements that are there; the file of the orders page is not changed and the LabCollector pill is left as it is): a pill "In the
          // database" and a square button with the link to the entry. Several entries (the oligos of an order): the button opens a list.
          const entries = state.items || [];
          const labcollector = card.querySelector('.orders-labcollector-toggle');
          const pillSource = labcollector && labcollector.querySelector('.orders-labcollector-pill');
          const iconSource = labcollector && labcollector.querySelector('.orders-icon-button');
          const pillClass = pillSource ? pillSource.className : 'btn btn-sm btn-outline-secondary';
          const iconClass = iconSource ? iconSource.className : 'btn btn-sm btn-outline-secondary';
          const all = state.inDb >= state.total;
          const status = element('span', 'otd-status', '', 'align-items:center;display:inline-flex;gap:0.35rem;margin-left:0.4rem');
          const pill = element('span', pillClass.replace(/\borders-labcollector-pill\b/, '').trim() + ' orders-labcollector-pill');
          pill.setAttribute('role', 'status');
          pill.style.cursor = 'default';
          pill.style.color = '#1d8348';
          pill.style.borderColor = '#1d8348';
          pill.append(element('i', 'fas fa-database fa-fw'), document.createTextNode(' ' + (all ? 'In the database' : state.inDb + ' of ' + state.total + ' in the database')));
          pill.title = all ? 'All ' + state.total + (state.total === 1 ? ' line of this order is' : ' lines of this order are') + ' in the Database already' : state.inDb + ' of ' + state.total + ' lines are in the Database already';
          status.append(pill);
          if (entries.length === 1) {
            const open = element('a', iconClass);
            open.href = 'registry.php?mode=view&id=' + entries[0].id;
            open.target = '_blank';
            open.rel = 'noopener';
            open.title = 'Open ' + entries[0].title + ' in the Database';
            open.setAttribute('aria-label', open.title);
            open.append(element('i', 'fas fa-up-right-from-square fa-fw'));
            status.append(open);
          } else if (entries.length > 1) {
            const list = element('ul', 'otd-list', '', 'display:none;font-size:0.85rem;list-style:none;margin:0.3rem 0;padding-left:0.2rem');
            entries.forEach(function (item) {
              const line = element('li');
              const link = element('a', '', item.title);
              link.href = 'registry.php?mode=view&id=' + item.id;
              link.target = '_blank';
              link.rel = 'noopener';
              link.title = item.title + ' (open the entry in the Database)';
              link.style.cssText = 'display:inline-block;font-size:inherit;max-width:40ch;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom;white-space:nowrap';
              line.append(link);
              list.append(line);
            });
            const toggle = element('button', iconClass);
            toggle.type = 'button';
            toggle.title = 'Show the ' + entries.length + ' entries in the Database';
            toggle.setAttribute('aria-label', toggle.title);
            toggle.setAttribute('aria-expanded', 'false');
            toggle.append(element('i', 'fas fa-list fa-fw'));
            toggle.addEventListener('click', function () {
              const open = list.style.display === 'none';
              list.style.display = open ? 'block' : 'none';
              toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            status.append(toggle);
            const metaLine = card.querySelector('.orders-item-meta');
            if (metaLine) {
              metaLine.after(list);
            }
          }
          const header = card.querySelector('.orders-item-header');
          if (labcollector) {
            labcollector.after(status);
          } else if (header) {
            header.append(status);
          }
          if (all) {
            // everything of the order is there: the button to add it is not needed
            add.style.display = 'none';
          } else {
            add.title = state.inDb + ' of ' + state.total + ' lines are in the Database already. ' + add.title;
          }
        });
      });
    };
    // after an add the cards are asked again
    window.addEventListener('otd:added', function () {
      // the primers that were just added are asked again (the list of the primers is kept for the cards)
      forgetPrimers();
      checked.clear();
      document.querySelectorAll('.otd-add, .otd-status, .otd-links, .otd-list').forEach(function (node) {
        node.remove();
      });
      enhanceCards();
    });
    // ---- placing an order: the new entry of the Database is found from what the order says.
    // The form of a new order has "Add a new entry of the database instead": a title and a module. Here the title and the module are filled
    // in from the order (its title, its notes, its link), an item that is in the Database is linked to the order, a new one is offered with a box
    // "Add it to the Database too" (not ticked; the entry is made when the order is requested), with its columns filled in like the lines of an order.
    const orderForm = function () {
      const card = document.querySelector('.orders-new-card');
      if (!card) {
        return null;
      }
      const title = card.querySelector('input[placeholder="What do you need ordered?"]');
      const notes = card.querySelector('.orders-notes-editor');
      return { card: card, title: title ? title.value.trim() : '', notes: notes ? notes.innerHTML : '', notesText: notes ? notes.textContent : '' };
    };
    // The columns of the module of a new entry of the form, filled in from the order and, when the server can read it, from the page of the
    // link. They are in a window (like Details... of the window of an order) that opens when "Add a new entry of the database instead" is
    // clicked, and again with "Columns..." on the row; the person can change them, and what is there is what the entry gets when it is made.
    const panels = new WeakMap();
    // the name of an item that is only a link, read from the page of the link (when the server can read it): link -> name
    const pageNames = new Map();
    // an order with several links is several items: the row of a new entry that was added for one of them knows its link
    const rowForPending = function (rowEl, rows) {
      const link = rowEl.dataset.otdLink || '';
      return (link && rows.find(function (candidate) {
        return candidate.link === link;
      })) || rows[0];
    };
    let moduleListPromise = null;
    const moduleList = function () {
      if (!moduleListPromise) {
        moduleListPromise = fetch('registry-modules.php', { credentials: 'same-origin' }).then(function (response) {
          return response.json();
        }).then(function (loaded) {
          return loaded.modules || [];
        }).catch(function () {
          moduleListPromise = null;
          return [];
        });
      }
      return moduleListPromise;
    };
    // the values of the columns of a row are computed again when the title, the module, the order or the page change; what was changed by hand stays
    const refreshPanel = async function (rowEl) {
      const form = orderForm();
      const input = rowEl.querySelector('input[placeholder^="New entry title"]');
      const select = rowEl.querySelector('select.orders-category-select');
      if (!form || !input || !select) {
        return;
      }
      const modules = await moduleList();
      const module = modules.find(function (candidate) {
        return Number(candidate.id) === Number(select.value);
      });
      let panel = panels.get(rowEl);
      let button = rowEl.querySelector('.otd-columns-button');
      if (!module || input.value.trim() === '') {
        if (button) {
          button.style.display = 'none';
        }
        return;
      }
      if (!panel || panel.module.id !== module.id) {
        panel = { module: module, values: {}, dirty: {}, page: null, link: '', popup: null };
        panels.set(rowEl, panel);
      }
      const vendorPart = form.title.indexOf(';') !== -1 ? form.title.slice(form.title.indexOf(';')) : '';
      const parsed = parseOrder({ title: input.value.trim() + vendorPart, notes: form.notes });
      const row = rowForPending(rowEl, parsed);
      if (rowEl.dataset.otdLink) {
        // the name of the row is what the person sees in its title field
        row.name = input.value.trim();
      }
      row.moduleTitle = module.title;
      // the page behind the link: asked once for a link, and the values are computed again when it has come
      if (row.link && panel.link !== row.link) {
        panel.link = row.link;
        pageFromLink(row.link).then(function (read) {
          if (read) {
            panel.page = read;
            refreshPanel(rowEl);
          }
        });
      }
      if (panel.page) {
        applyPage(row, panel.page);
      }
      row.fields = null;
      const values = defaultsFor(module, row);
      Object.keys(values).forEach(function (key) {
        if (!panel.dirty[key]) {
          panel.values[key] = values[key];
        }
      });
      // an open window shows what has come
      if (panel.popup) {
        Object.keys(panel.popup.inputs).forEach(function (key) {
          if (!panel.popup.touched[key] && panel.values[key] !== undefined) {
            panel.popup.inputs[key].value = panel.values[key];
          }
        });
      }
      if (!button) {
        const source = form.card.querySelector('button.btn-ghost');
        button = element('button', source ? source.className : 'btn btn-sm btn-ghost', '', 'margin-bottom:0.25rem');
        button.type = 'button';
        button.classList.add('otd-columns-button');
        button.addEventListener('click', function () {
          openColumns(rowEl);
        });
        rowEl.append(button);
      }
      button.style.display = '';
      const filled = Object.keys(panel.values).filter(function (key) {
        return panel.values[key] !== '' && panel.values[key] !== undefined;
      }).length;
      button.textContent = 'Columns (' + filled + ')...';
      button.title = 'The columns of ' + module.title + ' that the entry gets' + (panel.page ? ' (read from the link)' : '');
    };
    const openColumns = function (rowEl) {
      const panel = panels.get(rowEl);
      if (!panel || panel.popup) {
        return;
      }
      const module = panel.module;
      const input = rowEl.querySelector('input[placeholder^="New entry title"]');
      const layer = element('div', '', '', 'position:fixed;inset:0;z-index:1060;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:3rem 1rem');
      const card = element('div', '', '', 'background:var(--bg,#fff);border-radius:8px;max-width:560px;width:100%;padding:1rem 1.25rem;box-shadow:0 8px 30px rgba(0,0,0,.3)');
      layer.append(card);
      card.append(element('h6', '', (input && input.value.trim()) || 'New entry'), element('p', 'small text-muted', 'The columns of ' + module.title + ' that the entry gets. They are filled in from the order' + (panel.page ? ' and the page of its link' : ' and its link') + '; change what is not right.'));
      const inputs = {};
      const touched = {};
      (module.fields || []).forEach(function (f) {
        const label = element('label', 'd-block mb-2');
        label.append(element('span', 'd-block small text-muted', f.name));
        let control;
        if (f.type === 'select') {
          control = element('select', 'form-control form-control-sm');
          const blank = element('option', '', '');
          blank.value = '';
          control.append(blank);
          (f.options || []).forEach(function (o) {
            const option = element('option', '', o);
            option.value = o;
            control.append(option);
          });
        } else {
          control = element('input', 'form-control form-control-sm');
          control.type = f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text');
        }
        control.value = panel.values[f.name] || '';
        control.addEventListener('input', function () {
          touched[f.name] = true;
        });
        control.addEventListener('change', function () {
          touched[f.name] = true;
        });
        inputs[f.name] = control;
        label.append(control);
        card.append(label);
      });
      const close = function () {
        panel.popup = null;
        layer.remove();
        document.removeEventListener('keydown', onKey);
      };
      const onKey = function (event) {
        if (event.key === 'Escape') {
          close();
        }
      };
      document.addEventListener('keydown', onKey);
      const done = element('button', 'btn btn-primary btn-sm', 'Done');
      done.type = 'button';
      done.addEventListener('click', function () {
        Object.keys(inputs).forEach(function (key) {
          if (inputs[key].value !== (panel.values[key] || '')) {
            panel.dirty[key] = true;
          }
          panel.values[key] = inputs[key].value;
        });
        close();
        refreshPanel(rowEl);
      });
      const cancel = element('button', 'btn btn-secondary btn-sm mr-2', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', close);
      const bar = element('div', 'text-right');
      bar.append(cancel, done);
      card.append(bar);
      layer.addEventListener('mousedown', function (event) {
        if (event.target === layer) {
          close();
        }
      });
      panel.popup = { inputs: inputs, touched: touched };
      document.body.append(layer);
    };
    const prefillNewEntries = function () {
      const form = orderForm();
      if (!form || form.title === '') {
        return;
      }
      window.setTimeout(syncEditors, 60);
      const rows = parseOrder({ title: form.title, notes: form.notes });
      // a row that was just added for an item of an order with several links is given its link before anything is written in it
      if (form.card.dataset.otdAssigning) {
        const fresh = Array.from(form.card.querySelectorAll('.orders-pending-resource')).find(function (rowEl) {
          return !rowEl.dataset.otdLink;
        });
        if (fresh) {
          fresh.dataset.otdLink = form.card.dataset.otdAssigning;
          delete form.card.dataset.otdAssigning;
        }
      }
      form.card.querySelectorAll('.orders-pending-resource').forEach(function (rowEl) {
        refreshPanel(rowEl);
      });
      form.card.querySelectorAll('.orders-pending-resource input[placeholder^="New entry title"]').forEach(function (input) {
        if (input.dataset.otdPrefilled || input.value.trim() !== '' || document.activeElement === input) {
          return;
        }
        input.dataset.otdPrefilled = '1';
        const row = rowForPending(input.closest('.orders-pending-resource'), rows);
        // the title and the module of Svelte are set the way a person sets them (the input and change events)
        input.value = (row.link && pageNames.get(row.link)) || row.name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const select = input.parentElement.querySelector('select.orders-category-select');
        const option = select && Array.from(select.options).find(function (candidate) {
          return candidate.textContent.trim() === row.moduleTitle;
        });
        if (option) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    };
    // the timer of the check of the order (the check is made a little after the last key)
    let autoTimer = 0;
    let autoClicking = false;
    // a click on "Add a new entry of the database instead" adds the row (the form does it) and opens the window of its columns
    document.addEventListener('click', function (event) {
      const clicked = event.target && event.target.closest ? event.target.closest('button') : null;
      if (autoClicking || !clicked || !/Add a new entry of the database instead/.test(clicked.textContent) || !clicked.closest('.orders-new-card')) {
        return;
      }
      window.setTimeout(async function () {
        prefillNewEntries();
        const rows = document.querySelectorAll('.orders-new-card .orders-pending-resource');
        const rowEl = rows[rows.length - 1];
        if (rowEl) {
          await refreshPanel(rowEl);
          openColumns(rowEl);
        }
      }, 300);
    });
    // an order that is only a link (the title is empty): the title is made from the link, from its page when the server can read it
    const titleFromLink = async function (form, link) {
      const read = await pageFromLink(link);
      const name = cleanPageName(read ? read.name : '') || linkName(link);
      if (name === '') {
        return;
      }
      const vendor = (read && read.brand) || vendorOfLink(link);
      const input = form.card.querySelector('input[placeholder="What do you need ordered?"]');
      // only when it is still empty: what the person wrote is not touched
      if (input && input.value.trim() === '') {
        input.value = name + (vendor ? '; ' + vendor : '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        window.setTimeout(function () {
          checkOrder();
          prefillNewEntries();
        }, 400);
      }
    };
    // ---- what the form says about the item while the order is placed. Nothing is added to the Database by itself:
    // - the item is in the Database already (found by its name or its catalog number): it is linked to the order and the form says so;
    // - it is not: the title, the module and the columns are made ready (from the order and from the page of its link), and the form asks
    //   "Add it to the Database too" with a box that is not ticked. Ticking it adds the row of the new entry (the entry is made when the order
    //   is requested), unticking it takes the row away again.
    const orderPause = function (ms) {
      return new Promise(function (resolve) {
        window.setTimeout(resolve, ms);
      });
    };
    const stateBox = function (form) {
      let box = form.card.querySelector('.otd-order-state');
      if (!box) {
        const input = form.card.querySelector('input[placeholder^="Link an entry of the database"]');
        const picker = input ? input.closest('.orders-resource-picker') : null;
        if (!picker) {
          return null;
        }
        box = element('div', 'otd-order-state small mb-2', '', 'align-items:center;display:flex;flex-wrap:wrap;gap:0.25rem 0.75rem');
        picker.before(box);
      }
      return box;
    };
    const hideState = function (form) {
      const box = form.card.querySelector('.otd-order-state');
      if (box) {
        box.style.display = 'none';
      }
    };
    // the item is linked to the order through the field "Link an entry of the database": its name is searched and the result with that name is pressed,
    // the way a person does it (once for each name: a link that was taken away by hand is not put back)
    const linkToOrder = async function (form, existing) {
      // already linked (an order can have several links: only a link of this entry counts)
      const linked = Array.from(form.card.querySelectorAll('.orders-resource-badge')).some(function (badge) {
        return normalName(badge.textContent).indexOf(normalName(existing.title)) !== -1;
      });
      if (linked) {
        return true;
      }
      const input = form.card.querySelector('input[placeholder^="Link an entry of the database"]');
      if (!input) {
        return false;
      }
      input.value = searchTerm(existing.title);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      for (let tries = 0; tries < 10; tries++) {
        await orderPause(300);
        const hit = Array.from(form.card.querySelectorAll('button.orders-resource-result')).find(function (candidate) {
          return normalName(candidate.textContent) === normalName(existing.title);
        });
        if (hit) {
          hit.click();
          // the link that was made here is remembered: it is taken away again when the order is changed to another item
          const before = form.card.querySelectorAll('.orders-resource-badge a').length;
          for (let wait = 0; wait < 10; wait++) {
            await orderPause(250);
            const badges = form.card.querySelectorAll('.orders-resource-badge a');
            if (badges.length > before) {
              rememberAutoLink(form, badges[badges.length - 1].getAttribute('href') || '');
              break;
            }
          }
          return true;
        }
      }
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return false;
    };
    // the link that was made by the form itself is taken away again (when the order is changed to another item or its title is cleared)
    const autoLinks = function (form) {
      try {
        return JSON.parse(form.card.dataset.otdAutoBadges || '[]');
      } catch (error) {
        return [];
      }
    };
    const rememberAutoLink = function (form, href) {
      const list = autoLinks(form);
      if (href && list.indexOf(href) === -1) {
        list.push(href);
        form.card.dataset.otdAutoBadges = JSON.stringify(list);
      }
    };
    const dropAutoLink = function (form) {
      const old = autoLinks(form);
      if (old.length === 0) {
        return;
      }
      form.card.querySelectorAll('.orders-resource-badge').forEach(function (badge) {
        const anchor = badge.querySelector('a');
        const remove = badge.querySelector('button[title="Remove"]');
        if (anchor && remove && old.indexOf(anchor.getAttribute('href')) !== -1) {
          remove.click();
        }
      });
      delete form.card.dataset.otdAutoBadges;
      delete form.card.dataset.otdLinked;
    };
    // "Add a new entry of the database instead" of the form of a new order is not shown: the box "Add it to the Database too" does its work (it presses the
    // button, which stays in the page, hidden), and the button "Add ... to database" of the card of a placed order opens the window where the lines of the
    // order are ticked one by one (all or some). The form that edits an order keeps its button.
    const hideAddNewButton = function () {
      document.querySelectorAll('.orders-new-card button').forEach(function (button) {
        if (/Add a new entry of the database instead/.test(button.textContent)) {
          button.style.setProperty('display', 'none', 'important');
        }
      });
      // the rows of the new entries stay in the page (the form keeps its state in them) but are not shown: the name, the module and the columns
      // of each are edited under the item they belong to (syncEditors)
      document.querySelectorAll('.orders-new-card .orders-pending-resource').forEach(function (rowEl) {
        rowEl.style.setProperty('display', 'none', 'important');
      });
    };
    // the editing of a new entry, under its line: the name, the module and the columns. It writes into the (hidden) row of the form.
    const buildEditor = function (rowEl) {
      const wrap = element('div', '', '', 'align-items:center;display:flex;flex-wrap:wrap;gap:0.4rem;margin:0.2rem 0 0.5rem 1.5rem;width:100%');
      const sourceInput = rowEl.querySelector('input[placeholder^="New entry title"]');
      const sourceSelect = rowEl.querySelector('select.orders-category-select');
      if (!sourceInput || !sourceSelect) {
        return wrap;
      }
      const name = element('input', 'form-control form-control-sm', '', 'flex:1 1 12rem;min-width:10rem;width:auto');
      name.type = 'text';
      name.value = sourceInput.value;
      name.setAttribute('aria-label', 'Name of the new entry');
      name.addEventListener('input', function () {
        sourceInput.value = name.value;
        sourceInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const module = element('select', 'form-control form-control-sm', '', 'flex:0 1 11rem;width:auto');
      module.setAttribute('aria-label', 'Module of the new entry');
      Array.from(sourceSelect.options).forEach(function (option) {
        const copy = element('option', '', option.textContent);
        copy.value = option.value;
        module.append(copy);
      });
      module.value = sourceSelect.value;
      module.addEventListener('change', function () {
        sourceSelect.value = module.value;
        sourceSelect.dispatchEvent(new Event('change', { bubbles: true }));
        window.setTimeout(prefillNewEntries, 80);
      });
      const source = rowEl.querySelector('.otd-columns-button');
      const columns = element('button', 'btn btn-ghost btn-sm', source ? source.textContent : 'Columns…');
      columns.type = 'button';
      columns.addEventListener('click', async function () {
        await refreshPanel(rowEl);
        openColumns(rowEl);
      });
      wrap.append(name, module, columns);
      return wrap;
    };
    // every place under an item ("slot") shows the editing of its row; what is being typed in is left alone
    const syncEditors = function () {
      const form = orderForm();
      if (!form) {
        return;
      }
      const rows = Array.from(form.card.querySelectorAll('.orders-pending-resource'));
      form.card.querySelectorAll('.otd-slot').forEach(function (slot) {
        const link = slot.dataset.link || '';
        const rowEl = link ? rows.find(function (candidate) {
          return candidate.dataset.otdLink === link;
        }) : rows[0];
        if (!rowEl) {
          slot.textContent = '';
          return;
        }
        if (slot.contains(document.activeElement)) {
          return;
        }
        slot.textContent = '';
        slot.append(buildEditor(rowEl));
      });
    };
    const drawState = function (form, state) {
      const box = stateBox(form);
      if (!box) {
        return;
      }
      box.style.display = 'flex';
      box.textContent = '';
      if (state.existing) {
        const mark = element('span', '', '', 'color:#1d8348;font-weight:600');
        mark.append(element('i', 'fas fa-database fa-fw'), document.createTextNode(' In the database: '));
        const link = element('a', '', state.existing.title);
        link.href = 'registry.php?mode=view&id=' + state.existing.id;
        link.target = '_blank';
        link.rel = 'noopener';
        box.append(mark, link, element('span', 'text-muted', state.linked ? 'linked to this order' : 'not linked yet'));
        if (!state.linked) {
          const again = element('button', 'btn btn-ghost btn-sm', 'Link it');
          again.type = 'button';
          again.addEventListener('click', async function () {
            again.disabled = true;
            state.linked = await linkToOrder(form, state.existing);
            drawState(form, state);
          });
          box.append(again);
        }
        return;
      }
      box.append(element('span', 'text-muted', 'Not in the database yet.'));
      const label = element('label', 'mb-0', '', 'align-items:center;cursor:pointer;display:inline-flex;gap:0.35rem');
      const tick = element('input');
      tick.type = 'checkbox';
      tick.checked = form.card.querySelector('.orders-pending-resource') !== null;
      tick.addEventListener('change', function () {
        if (tick.checked) {
          const button = Array.from(form.card.querySelectorAll('button')).find(function (candidate) {
            return /Add a new entry of the database instead/.test(candidate.textContent);
          });
          if (button) {
            // the row is added (the window of the columns does not open: the "Columns..." button of the row opens it)
            autoClicking = true;
            button.click();
            autoClicking = false;
            window.setTimeout(prefillNewEntries, 100);
          }
        } else {
          form.card.querySelectorAll('.orders-pending-resource button[title="Remove"]').forEach(function (remove) {
            remove.click();
          });
        }
        window.setTimeout(syncEditors, 400);
      });
      label.append(tick, document.createTextNode('Add it to the Database too'));
      box.append(label, element('span', 'text-muted', 'The columns are filled in from the order and its link.'));
      box.append(element('div', 'otd-slot', '', 'flex:1 1 100%'));
      window.setTimeout(syncEditors, 50);
    };
    // An order with several links: every item has a line. An item that is in the Database is linked to the order, a new one has a box "Add it to the Database"
    // (not ticked) and "Add all" ticks every box. The pages of the links give the names when the person wrote none.
    const addRowFor = function (form, item) {
      const button = Array.from(form.card.querySelectorAll('button')).find(function (candidate) {
        return /Add a new entry of the database instead/.test(candidate.textContent);
      });
      if (!button) {
        return;
      }
      // the row that is added now is the one without a link yet: prefillNewEntries gives it this item's link first
      form.card.dataset.otdAssigning = item.row.link;
      autoClicking = true;
      button.click();
      autoClicking = false;
      window.setTimeout(prefillNewEntries, 80);
    };
    const removeRowFor = function (form, item) {
      form.card.querySelectorAll('.orders-pending-resource').forEach(function (rowEl) {
        const remove = rowEl.querySelector('button[title="Remove"]');
        if (rowEl.dataset.otdLink === item.row.link && remove) {
          remove.click();
        }
      });
    };
    const hasRowFor = function (form, item) {
      return Array.from(form.card.querySelectorAll('.orders-pending-resource')).some(function (rowEl) {
        return rowEl.dataset.otdLink === item.row.link;
      });
    };
    const drawRows = function (form, items) {
      const box = stateBox(form);
      if (!box) {
        return;
      }
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.alignItems = 'flex-start';
      box.textContent = '';
      const ticks = [];
      items.forEach(function (item) {
        const block = element('div', '', '', 'width:100%');
        const line = element('div', '', '', 'align-items:baseline;display:flex;flex-wrap:wrap;gap:0.15rem 0.6rem');
        if (item.existing) {
          const mark = element('span', '', '', 'color:#1d8348;font-weight:600');
          mark.append(element('i', 'fas fa-database fa-fw'), document.createTextNode(' In the database: '));
          const link = element('a', '', item.existing.title);
          link.href = 'registry.php?mode=view&id=' + item.existing.id;
          link.target = '_blank';
          link.rel = 'noopener';
          line.append(mark, link, element('span', 'text-muted', item.linked ? 'linked to this order' : 'not linked'));
        } else {
          const label = element('label', 'mb-0', '', 'align-items:baseline;cursor:pointer;display:inline-flex;gap:0.35rem');
          const tick = element('input');
          tick.type = 'checkbox';
          tick.checked = hasRowFor(form, item);
          tick.addEventListener('change', function () {
            if (tick.checked) {
              addRowFor(form, item);
            } else {
              removeRowFor(form, item);
            }
            window.setTimeout(syncEditors, 400);
          });
          ticks.push(tick);
          label.append(tick, document.createTextNode('Add "' + item.name + '" to the Database'));
          line.append(label, element('span', 'text-muted', 'not in the database yet'));
          block.append(line);
          // the editing of this item comes under its line when it is ticked
          const slot = element('div', 'otd-slot');
          slot.dataset.link = item.row.link;
          block.append(slot);
        }
        if (item.existing) {
          block.append(line);
        }
        box.append(block);
      });
      if (ticks.length > 1) {
        const all = element('button', 'btn btn-ghost btn-sm', 'Add all ' + ticks.length + ' new items');
        all.type = 'button';
        all.addEventListener('click', function () {
          ticks.forEach(function (tick) {
            if (!tick.checked) {
              tick.click();
            }
          });
        });
        box.append(all);
      }
      if (ticks.length > 0) {
        box.append(element('span', 'text-muted', 'The columns are filled in from the order and the links.'));
      }
      window.setTimeout(syncEditors, 50);
    };
    const checkRows = async function (form, rows) {
      const key = rows.map(function (item) {
        return item.link;
      }).join(' ');
      const box = form.card.querySelector('.otd-order-state');
      if (form.card.dataset.otdRows === key) {
        if (!box) {
          // the check of these items is still running: it draws the lines when it is done
          return;
        }
        // the same items: the boxes follow the rows of the form
        const items = form.card._otdItems || [];
        box.querySelectorAll('input[type="checkbox"]').forEach(function (tick, index) {
          const pending = items.filter(function (item) {
            return !item.existing;
          })[index];
          if (pending) {
            tick.checked = hasRowFor(form, pending);
          }
        });
        return;
      }
      form.card.dataset.otdRows = key;
      delete form.card.dataset.otdState;
      dropAutoLink(form);
      const items = [];
      for (const item of rows) {
        const entry = { row: item, name: item.name, existing: null, linked: false };
        // an item that was named by its link is named by its page when the server can read it (not by the page that a shop gives to a robot)
        if (!pageNames.has(item.link)) {
          const read = await pageFromLink(item.link).catch(function () {
            return null;
          });
          const named = cleanPageName(read ? read.name : '');
          if (named !== '') {
            pageNames.set(item.link, named);
          }
        }
        if (pageNames.get(item.link) && item.name === linkName(item.link)) {
          entry.name = pageNames.get(item.link);
        }
        items.push(entry);
        const now = orderForm();
        if (!now || now.card.dataset.otdRows !== key) {
          return;
        }
      }
      for (const entry of items) {
        entry.existing = await findExisting({ name: entry.name, catalog: entry.row.catalog, sequence: '' }).catch(function () {
          return null;
        });
        const now = orderForm();
        if (!now || now.card.dataset.otdRows !== key) {
          return;
        }
        if (entry.existing) {
          entry.linked = await linkToOrder(now, entry.existing);
        }
      }
      const now = orderForm();
      if (!now || now.card.dataset.otdRows !== key) {
        return;
      }
      now.card._otdItems = items;
      drawRows(now, items);
    };
    const checkOrder = function () {
      const form = orderForm();
      if (!form) {
        return;
      }
      const linkFound = /https?:\/\/[^\s"'<>)]+/.exec(form.notes.replace(/&amp;/g, '&'));
      if (form.title === '') {
        // several links (and no title): the title is the first item and the number of the others
        const guess = parseOrder({ title: '', notes: form.notes });
        if (guess.length >= 2 && guess.every(function (item) {
          return item.link !== '' && item.name.trim() !== '';
        })) {
          const titling = guess.map(function (item) {
            return item.link;
          }).join(' ');
          if (form.card.dataset.otdTitling !== titling) {
            form.card.dataset.otdTitling = titling;
            const vendors = Array.from(new Set(guess.map(function (item) {
              return item.vendor;
            })));
            const input = form.card.querySelector('input[placeholder="What do you need ordered?"]');
            if (input && input.value.trim() === '') {
              input.value = guess[0].name + ' + ' + (guess.length - 1) + (guess.length === 2 ? ' more item' : ' more items') + (vendors.length === 1 && vendors[0] !== '' ? '; ' + vendors[0] : '');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          return;
        }
        // an order that is only a link: its title is made from the link first
        if (linkFound && form.card.dataset.otdTitling !== linkFound[0]) {
          form.card.dataset.otdTitling = linkFound[0];
          titleFromLink(form, linkFound[0]);
        }
        hideState(form);
        dropAutoLink(form);
        delete form.card.dataset.otdState;
        return;
      }
      const parsed = parseOrder({ title: form.title, notes: form.notes });
      // several links: several items, each with its own line
      if (parsed.length >= 2 && parsed.every(function (item) {
        return item.link !== '' && item.name.trim() !== '';
      })) {
        checkRows(form, parsed);
        return;
      }
      if (form.card.dataset.otdRows) {
        // back to one item: the lines of the items are not needed
        dropAutoLink(form);
        delete form.card.dataset.otdRows;
        delete form.card.dataset.otdState;
      }
      const row = parsed[0];
      if (!row || row.name.trim() === '') {
        hideState(form);
        return;
      }
      const key = normalName(row.name) + '|' + String(row.catalog || '');
      const box = form.card.querySelector('.otd-order-state');
      if (form.card.dataset.otdState === key && box) {
        // the same item: only the box of the row is kept in step with the form
        const tick = box.querySelector('input[type="checkbox"]');
        if (tick) {
          tick.checked = form.card.querySelector('.orders-pending-resource') !== null;
        }
        return;
      }
      form.card.dataset.otdState = key;
      // the link that was made for the item before is not the link of this one
      dropAutoLink(form);
      findExisting({ name: row.name, catalog: row.catalog, sequence: '' }).catch(function () {
        return null;
      }).then(async function (existing) {
        const now = orderForm();
        // the order was changed meanwhile: the answer is for another item
        if (!now || now.card.dataset.otdState !== key) {
          return;
        }
        if (existing) {
          // a row of a new entry that was added for another item is not needed for an item that is there
          const state = { existing: existing, linked: false };
          if (now.card.dataset.otdLinked !== key) {
            now.card.dataset.otdLinked = key;
            state.linked = await linkToOrder(now, existing);
          } else {
            state.linked = Array.from(now.card.querySelectorAll('.orders-resource-badge')).some(function (badge) {
              return normalName(badge.textContent).indexOf(normalName(existing.title)) !== -1;
            });
          }
          drawState(now, state);
          return;
        }
        drawState(now, { existing: null });
        prefillNewEntries();
      });
    };
    document.addEventListener('input', function (event) {
      if (event.target && event.target.closest && event.target.closest('.orders-new-card')) {
        window.clearTimeout(autoTimer);
        autoTimer = window.setTimeout(function () {
          checkOrder();
          prefillNewEntries();
        }, 900);
      }
    }, true);

    // when the entry of the form is made, its columns are filled in from the order (vendor, catalog number from the link, link, clone, host...)
    const fillMade = async function (id, made) {
      const loaded = await (await fetch('registry-modules.php', { credentials: 'same-origin' })).json();
      const module = (loaded.modules || []).find(function (candidate) {
        return Number(candidate.id) === Number(made.category);
      });
      if (!module) {
        return;
      }
      let values = made.values;
      if (!values) {
        const vendorPart = made.orderTitle.indexOf(';') !== -1 ? made.orderTitle.slice(made.orderTitle.indexOf(';')) : '';
        const parsedRows = parseOrder({ title: made.title + vendorPart, notes: made.notes });
        const row = parsedRows.find(function (candidate) {
          return normalName(candidate.name) === normalName(made.title);
        }) || parsedRows[0];
        row.moduleTitle = module.title;
        row.fields = null;
        values = defaultsFor(module, row);
      }
      const entry = await (await fetch('api/v2/inventory/' + id, { credentials: 'same-origin' })).json();
      const metadata = JSON.parse(entry.metadata || '{"extra_fields":{}}');
      metadata.extra_fields = metadata.extra_fields || {};
      let changed = false;
      Object.keys(values).forEach(function (key) {
        if (values[key] !== '' && metadata.extra_fields[key] && !metadata.extra_fields[key].value) {
          metadata.extra_fields[key].value = values[key];
          changed = true;
        }
      });
      if (changed) {
        await fetch('api/v2/inventory/' + id, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
          body: JSON.stringify({ metadata: JSON.stringify(metadata) }),
        });
      }
      // the entry is in the lab Database: it is locked when its columns are filled in (the owner or an admin unlocks it by hand)
      await fetch('registry-lock.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': token() },
        body: JSON.stringify({ id: id }),
      });
    };
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      const args = Array.from(arguments);
      let made = null;
      try {
        const url = String(typeof input === 'string' ? input : (input && input.url) || '').split('?')[0];
        const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        const form = orderForm();
        if (method === 'POST' && /api\/v2\/inventory\/?$/.test(url) && form && init && typeof init.body === 'string') {
          const body = JSON.parse(init.body);
          // the form makes the entry without saying where it goes, and it would be in My entries (private, no number): the Database is where it
          // goes, with the number of the lab
          if (body.register === undefined) {
            args[1] = Object.assign({}, init, { body: JSON.stringify(Object.assign({}, body, { register: 'lab' })) });
          }
          made = { title: String(body.title || ''), category: body.category, orderTitle: form.title, notes: form.notes, values: null };
          // the columns that the person saw (and changed) under the row of the entry
          form.card.querySelectorAll('.orders-pending-resource').forEach(function (rowEl) {
            const typed = rowEl.querySelector('input[placeholder^="New entry title"]');
            const chosen = rowEl.querySelector('select.orders-category-select');
            const panel = panels.get(rowEl);
            if (panel && typed && chosen && typed.value.trim() === made.title && Number(chosen.value) === Number(made.category)) {
              made.values = Object.assign({}, panel.values);
            }
          });
        }
      } catch (error) {
        made = null;
      }
      const promise = nativeFetch.apply(this, args);
      if (made && made.category) {
        promise.then(function (response) {
          const id = Number((response.headers.get('Location') || '').split('/').pop());
          if (response.ok && id > 0) {
            fillMade(id, made).catch(function () {
              // the entry stays as it was made
            });
          }
        }).catch(function () {
          // the entry was not made
        });
      }
      return promise;
    };
    let cardsPending = 0;
    new MutationObserver(function () {
      window.clearTimeout(cardsPending);
      cardsPending = window.setTimeout(function () {
        enhanceCards();
        hideAddNewButton();
        prefillNewEntries();
      }, 150);
    }).observe(document.body, { childList: true, subtree: true });
    enhanceCards();
    hideAddNewButton();
  }
})();
