/**
 * Keeps the last alignment of the sequencing reads with the entry: a small file (alignments.json) in its files, written after the
 * reads are aligned (by the Align tool or by the alignment page) and read when the Align tool is opened. Only the summary of
 * each read is kept (strand, identity, place, differences), not the aligned sequences. Exposed as window.AlignmentStore.
 */
(function () {
  'use strict';
  const NAME = 'alignments.json';

  async function listing(entryId) {
    const response = await fetch('../api/v2/inventory/' + entryId + '/uploads', { credentials: 'same-origin' });
    if (!response.ok) {
      return [];
    }
    return (await response.json()).filter(function (upload) {
      return upload.real_name === NAME;
    }).sort(function (a, b) {
      return Number(b.id) - Number(a.id);
    });
  }

  // the part of a result worth keeping
  function slim(alignment) {
    if (!alignment) {
      return null;
    }
    const copy = Object.assign({}, alignment);
    delete copy.read;
    delete copy.alignedRead;
    delete copy.alignedReference;
    return copy;
  }

  /**
   * @param {number} entryId
   * @param {string} csrf
   * @param {{referenceLength: number, results: Array<{name: string, source: string, alignment: object|null}>}} payload
   * @returns {Promise<boolean>} whether it was saved (it is not when the user cannot write the entry)
   */
  async function save(entryId, csrf, payload) {
    try {
      const existing = await listing(entryId);
      const body = { savedAt: new Date().toISOString(), referenceLength: payload.referenceLength, results: payload.results.map(function (item) {
        return { name: item.name, source: item.source, alignment: slim(item.alignment) };
      }) };
      const form = new FormData();
      form.append('file', new File([JSON.stringify(body)], NAME, { type: 'application/json' }));
      let url = '../api/v2/inventory/' + entryId + '/uploads';
      if (existing.length > 0) {
        // the earlier one stays in the history of the entry as an archived file
        url += '/' + existing[0].id;
        form.append('action', 'replace');
      }
      const response = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf }, body: form });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /** @returns {Promise<{savedAt: string, referenceLength: number, results: Array}|null>} */
  async function load(entryId) {
    try {
      const existing = await listing(entryId);
      if (existing.length === 0) {
        return null;
      }
      const upload = existing[0];
      const params = new URLSearchParams({ f: upload.long_name, name: upload.real_name, storage: String(upload.storage) });
      const response = await fetch('../app/download.php?' + params.toString(), { credentials: 'same-origin' });
      if (!response.ok) {
        return null;
      }
      const saved = JSON.parse(await response.text());
      return saved && Array.isArray(saved.results) ? saved : null;
    } catch (error) {
      return null;
    }
  }

  window.AlignmentStore = { save: save, load: load };
})();
