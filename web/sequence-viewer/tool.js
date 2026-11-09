/**
 * The search of the sequence editor tool: finds the plasmids of the database that have a sequence file and opens the file
 * in the editor of its entry.
 */
(function () {
  'use strict';
  const input = document.getElementById('plasmid-search');
  const results = document.getElementById('plasmid-results');
  let timer = 0;

  function link(entry, file) {
    const params = new URLSearchParams({
      entry: String(entry.id),
      upload: String(file.id),
      f: file.long_name,
      name: file.real_name,
      storage: String(file.storage),
    });
    return 'index.php?' + params.toString();
  }

  function show(entries) {
    results.textContent = '';
    const withSequence = entries.filter(function (entry) {
      return (entry.sequence_files || []).length > 0;
    });
    if (withSequence.length === 0) {
      const none = document.createElement('div');
      none.className = 'plasmid-none';
      none.textContent = 'No plasmid with a sequence file found.';
      results.append(none);
    }
    withSequence.forEach(function (entry) {
      entry.sequence_files.forEach(function (file) {
        const a = document.createElement('a');
        a.className = 'plasmid-result';
        a.href = link(entry, file);
        const title = document.createElement('strong');
        title.textContent = (entry.custom_id ? '#' + entry.custom_id + ' ' : '') + entry.title;
        a.append(title, document.createTextNode(' ' + file.real_name));
        results.append(a);
      });
    });
    results.hidden = false;
  }

  input.addEventListener('input', function () {
    window.clearTimeout(timer);
    const term = input.value.trim();
    if (term === '') {
      results.hidden = true;
      return;
    }
    timer = window.setTimeout(async function () {
      try {
        const response = await fetch('../api/v2/inventory?limit=20&q=' + encodeURIComponent(term), { credentials: 'same-origin' });
        show(response.ok ? await response.json() : []);
      } catch (error) {
        show([]);
      }
    }, 250);
  });
  document.addEventListener('click', function (event) {
    if (!results.contains(event.target) && event.target !== input) {
      results.hidden = true;
    }
  });
})();
