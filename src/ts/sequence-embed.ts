/**
 * @author Marcel Bolten
 * @copyright 2026 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 *
 * Inline DNA/protein sequence viewer embedded directly in an entity's body
 * text (via the "Insert sequence" TinyMCE button), as opposed to the
 * existing viewer-ove which only renders for uploaded plasmid files (see
 * ove.ts). While editing, a block only shows a lightweight static
 * placeholder -- mounting the full Open Vector Editor React app inside
 * TinyMCE's own contenteditable iframe is unnecessary and risks fighting the
 * editor's own DOM management. The real viewer is mounted here, once, on the
 * static rendered body shown outside the editor (view mode), the same place
 * displayPlasmidViewer() already mounts one for uploads.
 */
declare global {
  interface Window {
    /* eslint-disable-next-line */
    createVectorEditor: any;
  }
}

/* eslint-disable-next-line */
export function encodeSequenceEmbed(parsedSequence: any): string {
  const json = encodeURIComponent(JSON.stringify(parsedSequence)).replace(
    /%([0-9A-F]{2})/g,
    (_, hex: string) => String.fromCharCode(parseInt(hex, 16)),
  );
  return btoa(json);
}

/* eslint-disable-next-line */
function decodeSequenceEmbed(encoded: string): any {
  const json = atob(encoded).split('').map(
    c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'),
  ).join('');
  return JSON.parse(decodeURIComponent(json));
}

export function hydrateSequenceEmbeds(): void {
  const blocks = document.querySelectorAll<HTMLElement>(
    '.elabftw-sequence-embed[data-sequence-json]:not([data-hydrated])',
  );
  if (blocks.length < 1) {
    return;
  }
  import('@teselagen/ove').then(() => {
    blocks.forEach(block => {
      block.dataset.hydrated = '1';
      /* eslint-disable-next-line */
      let parsedSequence: any;
      try {
        parsedSequence = decodeSequenceEmbed(block.dataset.sequenceJson);
      } catch (error) {
        console.error('Could not parse embedded sequence data', error);
        return;
      }

      const mount = document.createElement('div');
      mount.id = `sequence-embed-${Math.random().toString(36).slice(2)}`;
      mount.style.minHeight = '420px';
      block.innerHTML = '';
      block.appendChild(mount);

      const editor = window.createVectorEditor(mount, {
        editorName: mount.id,
        withPreviewMode: true,
        isFullscreen: false,
        showMenuBar: false,
        withRotateCircularView: false,
        showReadOnly: true,
        disableSetReadOnly: true,
        showGCContentByDefault: true,
        ToolBarProps: {
          toolList: ['downloadTool', 'cutsiteTool', 'featureTool', 'findTool'],
        },
        StatusBarProps: {
          showCircularity: true,
          showReadOnly: true,
          showAvailability: false,
        },
      });

      editor.updateEditor({
        readOnly: true,
        sequenceData: parsedSequence,
        sequenceDataHistory: {},
        annotationVisibility: { features: true },
        panelsShown: parsedSequence.circular
          ? [
            [{ id: 'circular', name: 'Plasmid Map', active: true }, { id: 'rail', name: 'Linear Map', active: false }],
            [{ id: 'sequence', name: 'Linear Sequence Map', active: true }, { id: 'properties', name: 'Properties', active: false }],
          ]
          : [
            [{ id: 'rail', name: 'Linear Map', active: true }],
            [{ id: 'sequence', name: 'Linear Sequence Map', active: true }, { id: 'properties', name: 'Properties', active: false }],
          ],
      });
    });
  });
}
