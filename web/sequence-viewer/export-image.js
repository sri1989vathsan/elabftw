/**
 * Fork-only. Pictures and PDF files of what the sequence pages show, made in the browser without a library:
 *  - ExportImage.svgToCanvas / canvasToPdf: the circular map (an SVG) as a PNG or a PDF (the picture inside the PDF is not lossy)
 *  - ExportImage.alignment(...): an alignment (rows of letters, the reference first) drawn by us, as a PNG or as a vector PDF with pages
 * The alignment is drawn from its letters, so it has the bases, the differences and the positions, not the traces of the reads.
 */
(function () {
  'use strict';

  const CHAR = 6;
  const ROW = 12;
  const BLOCK = 100;
  const NAME_COLUMNS = 24;
  const NAME_WIDTH = NAME_COLUMNS * CHAR;
  const MARGIN = 30;
  const PAGE = { width: 842, height: 595 };
  const COLORS = { text: '#111827', faint: '#9ca3af', match: '#6b7280', difference: '#dc2626', insertion: '#f59e0b', unknown: '#9ca3af', white: '#ffffff', tick: '#374151' };

  function download(blob, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 2000);
  }

  function toBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        return blob ? resolve(blob) : reject(new Error('The picture could not be made.'));
      }, 'image/png');
    });
  }

  // an SVG text (with its styles written in) drawn on a canvas, scale times its size
  function svgToCanvas(svgText, width, height, scale) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
      image.onload = function () {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('The map could not be drawn as a picture.'));
      };
      image.src = url;
    });
  }

  // ---- PDF: a small writer (pages with text and rectangles in the standard Courier font, and pictures)
  function color(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(function (part) {
      return (part / 255).toFixed(3);
    }).join(' ');
  }

  function pdfText(text) {
    return String(text).replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** @param {Array<{width: number, height: number, content: string, image?: {width: number, height: number, data: Uint8Array}}>} pages */
  function buildPdf(pages) {
    const encoder = new TextEncoder();
    const chunks = [];
    let offset = 0;
    const offsets = [];
    const push = function (part) {
      const bytes = typeof part === 'string' ? encoder.encode(part) : part;
      chunks.push(bytes);
      offset += bytes.length;
    };
    // objects: 1 catalog, 2 pages, 3 font; then for each page its picture (if any), its content and itself
    const objects = [];
    const add = function (dictionary, stream) {
      objects.push({ dictionary: dictionary, stream: stream || null });
      return objects.length;
    };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
    const kids = [];
    pages.forEach(function (page) {
      let imageId = 0;
      if (page.image) {
        imageId = add('<< /Type /XObject /Subtype /Image /Width ' + page.image.width + ' /Height ' + page.image.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ' + page.image.data.length + ' >>', page.image.data);
      }
      const content = encoder.encode(page.content);
      const contentId = add('<< /Length ' + content.length + ' >>', content);
      const pageId = add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + page.width + ' ' + page.height + '] /Resources << /Font << /F1 3 0 R >>' + (imageId ? ' /XObject << /Im0 ' + imageId + ' 0 R >>' : '') + ' >> /Contents ' + contentId + ' 0 R >>');
      kids.push(pageId + ' 0 R');
    });
    objects[1].dictionary = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>';
    push('%PDF-1.4\n');
    objects.forEach(function (object, index) {
      offsets.push(offset);
      push((index + 1) + ' 0 obj\n' + object.dictionary);
      if (object.stream) {
        push('\nstream\n');
        push(object.stream);
        push('\nendstream');
      }
      push('\nendobj\n');
    });
    const xref = offset;
    push('xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n');
    offsets.forEach(function (position) {
      push(String(position).padStart(10, '0') + ' 00000 n \n');
    });
    push('trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
    return new Blob(chunks, { type: 'application/pdf' });
  }

  // a canvas as a one page PDF: the page is the size of the picture in CSS pixels, the picture has the resolution of the canvas
  async function canvasToPdf(canvas, scale) {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    const width = Math.round(canvas.width / scale);
    const height = Math.round(canvas.height / scale);
    return buildPdf([{ width: width, height: height, content: 'q ' + width + ' 0 0 ' + height + ' 0 0 cm /Im0 Do Q', image: { width: canvas.width, height: canvas.height, data: await deflate(rgb) } }]);
  }

  // ---- the alignment: blocks of columns, each with a ruler, the reference and the reads
  /**
   * @param {string[]} names the reference first
   * @param {string[]} rows letters of the same length, '-' for a gap
   * @param {number} referenceLength the positions of the ruler go round when the reference is read over its origin
   * @returns {{blocks: Array<{height: number, prims: object[]}>, width: number}}
   */
  function layoutAlignment(names, rows, referenceLength) {
    const reference = rows[0];
    const reads = rows.slice(1);
    // the part of each read that has bases: before and after it nothing is drawn
    const spans = reads.map(function (row) {
      const first = row.search(/[^-]/);
      let last = row.length - 1;
      while (last >= 0 && row[last] === '-') {
        last--;
      }
      return { first: first, last: last };
    });
    const from = Math.min.apply(null, spans.map(function (span) {
      return span.first < 0 ? Infinity : span.first;
    }));
    const to = Math.max.apply(null, spans.map(function (span) {
      return span.last;
    }));
    if (!Number.isFinite(from) || to < from) {
      return { blocks: [], width: 0 };
    }
    // the position in the reference of each column
    const positions = [];
    let count = 0;
    for (let c = 0; c < reference.length; c++) {
      if (reference[c] !== '-') {
        count++;
      }
      positions.push(referenceLength > 0 ? ((count - 1) % referenceLength) + 1 : count);
    }
    const label = function (name) {
      const clean = String(name);
      return clean.length > NAME_COLUMNS - 1 ? clean.slice(0, NAME_COLUMNS - 2) + '..' : clean;
    };
    const blocks = [];
    for (let start = from; start <= to; start += BLOCK) {
      const end = Math.min(to, start + BLOCK - 1);
      // a stretch that no read covers (between two reads far apart) is left out
      if (!spans.some(function (span) {
        return span.first >= 0 && span.first <= end && span.last >= start;
      })) {
        continue;
      }
      const prims = [];
      let y = 0;
      // the ruler: the position of the reference every ten columns
      for (let c = start; c <= end; c++) {
        if ((c - from) % 10 === 0) {
          prims.push({ t: 'text', x: NAME_WIDTH + (c - start) * CHAR, y: y, s: String(positions[c]), fill: COLORS.tick });
        }
      }
      y += ROW;
      const row = function (name, letters, isReference, span) {
        prims.push({ t: 'text', x: 0, y: y, s: label(name), fill: COLORS.text });
        for (let c = start; c <= end; c++) {
          const letter = letters[c];
          const x = NAME_WIDTH + (c - start) * CHAR;
          if (isReference) {
            prims.push({ t: 'text', x: x, y: y, s: letter, fill: COLORS.text });
            continue;
          }
          if (c < span.first || c > span.last) {
            continue;
          }
          const mine = letter.toUpperCase();
          const theirs = reference[c].toUpperCase();
          if (letter === '-') {
            prims.push({ t: 'rect', x: x, y: y, w: CHAR, h: ROW, fill: COLORS.difference }, { t: 'text', x: x, y: y, s: '-', fill: COLORS.white });
          } else if (theirs === '-') {
            prims.push({ t: 'rect', x: x, y: y, w: CHAR, h: ROW, fill: COLORS.insertion }, { t: 'text', x: x, y: y, s: letter, fill: COLORS.white });
          } else if (mine === 'N') {
            prims.push({ t: 'rect', x: x, y: y, w: CHAR, h: ROW, fill: COLORS.unknown }, { t: 'text', x: x, y: y, s: letter, fill: COLORS.white });
          } else if (mine !== theirs) {
            prims.push({ t: 'rect', x: x, y: y, w: CHAR, h: ROW, fill: COLORS.difference }, { t: 'text', x: x, y: y, s: letter, fill: COLORS.white });
          } else {
            prims.push({ t: 'text', x: x, y: y, s: letter, fill: COLORS.match });
          }
        }
        y += ROW;
      };
      row(names[0], reference, true, null);
      reads.forEach(function (letters, index) {
        row(names[index + 1], letters, false, spans[index]);
      });
      blocks.push({ height: y + ROW, prims: prims });
    }
    return { blocks: blocks, width: NAME_WIDTH + BLOCK * CHAR };
  }

  const LEGEND = 'Red: difference or missing base. Orange: extra base. Grey letters: same as the reference. Numbers: position in the reference.';

  function alignmentCanvas(title, laid, scale) {
    const header = 36;
    const height = header + laid.blocks.reduce(function (sum, block) {
      return sum + block.height;
    }, 0) + MARGIN;
    const width = laid.width + MARGIN * 2;
    if ((height + MARGIN) * scale > 30000) {
      throw new Error('The alignment is too long for one picture: use the PDF.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round((height + MARGIN) * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = 'alphabetic';
    const draw = function (prims, left, top) {
      prims.forEach(function (prim) {
        if (prim.t === 'rect') {
          context.fillStyle = prim.fill;
          context.fillRect((left + prim.x) * scale, (top + prim.y) * scale, prim.w * scale, prim.h * scale);
        } else {
          context.fillStyle = prim.fill;
          context.font = (10 * scale) + 'px "Courier New", Courier, monospace';
          // letter by letter, so that the columns line up whatever the font is
          for (let i = 0; i < prim.s.length; i++) {
            context.fillText(prim.s[i], (left + prim.x + i * CHAR) * scale, (top + prim.y + 9) * scale);
          }
        }
      });
    };
    draw([{ t: 'text', x: 0, y: 0, s: title, fill: COLORS.text }, { t: 'text', x: 0, y: ROW + 2, s: LEGEND, fill: COLORS.faint }], MARGIN, MARGIN);
    let top = MARGIN + header;
    laid.blocks.forEach(function (block) {
      draw(block.prims, MARGIN, top);
      top += block.height;
    });
    return canvas;
  }

  function alignmentPdf(title, laid) {
    const header = 36;
    const area = PAGE.height - MARGIN * 2;
    const pages = [];
    let content = '';
    let used = 0;
    const open = function () {
      content = '';
      used = 0;
      // the title and the legend are on every page
      content += text(0, 0, title, COLORS.text, true) + text(0, ROW + 2, LEGEND, COLORS.faint, true);
      used = header;
    };
    const text = function (x, top, s, fill, absolute) {
      return 'BT /F1 10 Tf ' + color(fill) + ' rg ' + (MARGIN + x) + ' ' + (PAGE.height - MARGIN - top - 9) + ' Td (' + pdfText(s) + ') Tj ET\n';
    };
    const rect = function (x, top, w, h, fill) {
      return color(fill) + ' rg ' + (MARGIN + x) + ' ' + (PAGE.height - MARGIN - top - h) + ' ' + w + ' ' + h + ' re f\n';
    };
    const close = function () {
      pages.push({ width: PAGE.width, height: PAGE.height, content: content });
    };
    open();
    laid.blocks.forEach(function (block) {
      if (used + block.height > area) {
        close();
        open();
      }
      block.prims.forEach(function (prim) {
        content += prim.t === 'rect' ? rect(prim.x, used + prim.y, prim.w, prim.h, prim.fill) : text(prim.x, used + prim.y, prim.s, prim.fill);
      });
      used += block.height;
    });
    close();
    return buildPdf(pages);
  }

  /**
   * @param {'png'|'pdf'} format
   * @param {{title: string, names: string[], rows: string[], referenceLength: number}} data
   */
  async function alignment(format, data) {
    const laid = layoutAlignment(data.names, data.rows, data.referenceLength);
    if (laid.blocks.length === 0) {
      throw new Error('There is nothing aligned to draw.');
    }
    if (format === 'pdf') {
      return alignmentPdf(data.title, laid);
    }
    return toBlob(alignmentCanvas(data.title, laid, 2));
  }

  window.ExportImage = { download: download, toBlob: toBlob, svgToCanvas: svgToCanvas, canvasToPdf: canvasToPdf, alignment: alignment };
})();
