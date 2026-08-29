/** Fork-owned insertion of an inline DNA/protein sequence viewer block. */
import { Editor } from 'tinymce/tinymce';
import { anyToJson } from '@teselagen/bio-parsers';
import { encodeSequenceEmbed } from '../sequence-embed';
import { escapeHTML } from '../misc';

export function registerSequenceExtension(editor: Editor): void {
  editor.ui.registry.addIcon(
    'elabftw-sequence',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M7 3c0 4 10 4 10 8s-10 4-10 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M17 3c0 4-10 4-10 8s10 4 10 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8.3 6h7.4M8.3 18h7.4M6.6 11h10.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  );

  editor.ui.registry.addButton('insertsequence', {
    icon: 'elabftw-sequence',
    tooltip: 'Insert a DNA/protein sequence viewer',
    onAction: () => openSequenceDialog(editor),
  });
}

function openSequenceDialog(editor: Editor): void {
  editor.windowManager.open({
    title: 'Insert sequence',
    body: {
      type: 'panel',
      items: [
        { type: 'input', name: 'name', label: 'Name' },
        { type: 'textarea', name: 'sequence', label: 'Sequence (FASTA, GenBank, or raw letters)' },
      ],
    },
    initialData: { name: '', sequence: '' },
    buttons: [
      { type: 'cancel', text: 'Cancel' },
      { type: 'submit', text: 'Insert', buttonType: 'primary' },
    ],
    onSubmit: api => {
      const data = api.getData() as { name: string, sequence: string };
      const raw = data.sequence.trim();
      api.close();
      if (!raw) {
        return;
      }
      const name = data.name.trim() || 'sequence';
      anyToJson(raw, { fileName: name, guessIfProtein: false }).then(parsedData => {
        if (parsedData.length === 0 || parsedData[0].success === false) {
          editor.notificationManager.open({ text: 'Could not parse this sequence.', type: 'error' });
          return;
        }
        const parsedSequence = parsedData[0].parsedSequence;
        parsedSequence.name = parsedSequence.name || name;
        const length = parsedSequence.sequence ? parsedSequence.sequence.length : 0;
        const encoded = encodeSequenceEmbed(parsedSequence);
        const html = '<div class="elabftw-sequence-embed" contenteditable="false" data-sequence-json="'
          + encoded + '"><span class="elabftw-sequence-embed-placeholder">&#x1F9EC; <strong>'
          + escapeHTML(parsedSequence.name) + '</strong> — ' + length + ' bp'
          + (parsedSequence.circular ? ' (circular)' : '')
          + ' — sequence viewer, open this entry to interact</span></div><p></p>';
        editor.execCommand('mceInsertContent', false, html);
      }).catch(() => {
        editor.notificationManager.open({ text: 'Could not parse this sequence.', type: 'error' });
      });
    },
  });
}
