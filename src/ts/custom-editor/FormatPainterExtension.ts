/** Fork-owned format painter and clear-formatting shortcuts. */
import { Editor } from 'tinymce/tinymce';

interface PaintedTextFormat {
  styles: Record<string, string>;
}

function capturePaintedTextFormat(editor: Editor): PaintedTextFormat | null {
  const node = editor.selection.getNode() as HTMLElement;
  const body = editor.getBody();
  if (!node || node === body || !body.contains(node)) return null;
  const editorWindow = editor.getWin();
  const computed = editorWindow.getComputedStyle(node);
  const baseline = editorWindow.getComputedStyle(body);
  const styles: Record<string, string> = {};
  [
    'color',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'letter-spacing',
    'line-height',
    'text-decoration',
    'text-transform',
    'vertical-align',
  ].forEach(property => {
    const value = computed.getPropertyValue(property);
    if (value && value !== baseline.getPropertyValue(property)) styles[property] = value;
  });

  let current: HTMLElement | null = node;
  while (current && current !== body) {
    const backgroundColor = editorWindow.getComputedStyle(current).backgroundColor;
    if (backgroundColor
      && backgroundColor !== 'transparent'
      && backgroundColor !== 'rgba(0, 0, 0, 0)'
    ) {
      styles['background-color'] = backgroundColor;
      break;
    }
    current = current.parentElement;
  }
  return Object.keys(styles).length > 0 ? { styles } : null;
}

export function registerFormatPainterExtension(editor: Editor): void {
  let paintedTextFormat: PaintedTextFormat | null = null;
  let painterSequence = 0;
  let painterButtonApi: { setActive: (active: boolean) => void } | null = null;
  const resetFormatPainter = (): void => {
    paintedTextFormat = null;
    painterButtonApi?.setActive(false);
  };

  editor.ui.registry.addIcon(
    'elabftwFormatPainter',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5 8 7.3 3 9.7 8 12 3 14.3 8 16.7 3 19 8 19 9.5 14.5 12 14.5 18.5A2 2 0 0 1 12.5 20.5H11.5A2 2 0 0 1 9.5 18.5L9.5 12 5 9.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.3 9.3H17.7M7.6 10.6H16.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/><ellipse cx="12" cy="16.3" rx="1.3" ry="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  );
  editor.ui.registry.addIcon(
    'elabftwClearFormatting',
    '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5 8 7.3 3 9.7 8 12 3 14.3 8 16.7 3 19 8 19 9.5 14.5 12 14.5 18.5A2 2 0 0 1 12.5 20.5H11.5A2 2 0 0 1 9.5 18.5L9.5 12 5 9.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6.3 9.3H17.7M7.6 10.6H16.4" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/><ellipse cx="12" cy="16.3" rx="1.3" ry="1.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 21 21 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  );
  editor.ui.registry.addToggleButton('format-painter', {
    icon: 'elabftwFormatPainter',
    tooltip: 'Format painter: copy formatting, then select target text and click again',
    onAction: api => {
      if (!paintedTextFormat) {
        paintedTextFormat = capturePaintedTextFormat(editor);
        if (!paintedTextFormat) {
          editor.notificationManager.open({
            text: 'Place the cursor in formatted text first.',
            type: 'info',
            timeout: 2500,
          });
          return;
        }
        api.setActive(true);
        editor.notificationManager.open({
          text: 'Formatting copied. Select target text and click the brush again.',
          type: 'info',
          timeout: 3000,
        });
        return;
      }
      if (editor.selection.isCollapsed()) {
        editor.notificationManager.open({
          text: 'Select the target text before applying the copied formatting.',
          type: 'info',
          timeout: 2500,
        });
        return;
      }
      editor.undoManager.transact(() => {
        const formatName = `elabftw-format-painter-${painterSequence++}`;
        editor.formatter.register(formatName, {
          inline: 'span',
          styles: paintedTextFormat.styles,
        });
        editor.formatter.apply(formatName);
      });
      resetFormatPainter();
      editor.nodeChanged();
    },
    onSetup: api => {
      painterButtonApi = api;
      return () => {
        if (painterButtonApi === api) painterButtonApi = null;
      };
    },
  });
  editor.ui.registry.addButton('remove-formatting', {
    icon: 'elabftwClearFormatting',
    tooltip: 'Clear formatting from the selected text',
    onAction: () => {
      resetFormatPainter();
      editor.undoManager.transact(() => editor.execCommand('RemoveFormat'));
      editor.nodeChanged();
    },
  });
  editor.on('keydown', event => {
    if (event.key === 'Escape' && paintedTextFormat) resetFormatPainter();
  });
}
