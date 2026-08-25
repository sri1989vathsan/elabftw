/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import $ from 'jquery';
import { Model } from './interfaces';

export default class SidePanel {
  private static readonly WIDTH_KEY = 'sidepanel-width';
  private static readonly WIDTH_PROPERTY = '--side-panel-width';
  private static readonly MIN_WIDTH = 280;
  private static readonly MAX_WIDTH = 720;
  private static currentWidth = 0;
  private static widthInitialized = false;
  private static layoutRefreshFrame: number | null = null;

  panelId: string;
  model: Model | string;

  constructor(model: Model | string) {
    this.model = model;
    SidePanel.initializeWidth();
  }

  private static getWidthBounds(): { min: number; max: number } {
    // Always leave enough room to see and interact with the main document.
    const max = Math.max(160, Math.min(SidePanel.MAX_WIDTH, window.innerWidth - 240));
    return {
      min: Math.min(SidePanel.MIN_WIDTH, max),
      max,
    };
  }

  private static clampWidth(width: number): number {
    const bounds = SidePanel.getWidthBounds();
    return Math.round(Math.min(Math.max(width, bounds.min), bounds.max));
  }

  private static refreshMainLayout(): void {
    if (SidePanel.layoutRefreshFrame !== null) {
      cancelAnimationFrame(SidePanel.layoutRefreshFrame);
    }
    SidePanel.layoutRefreshFrame = requestAnimationFrame(() => {
      SidePanel.layoutRefreshFrame = null;
      // TinyMCE calculates which toolbar groups fit at initialization. A
      // synthetic resize makes it recalculate after the sidebar changes the
      // available document width in either direction.
      window.dispatchEvent(new Event('resize'));
    });
  }

  private static setWidth(width: number, persist = false, refreshLayout = true): void {
    SidePanel.currentWidth = SidePanel.clampWidth(width);
    document.documentElement.style.setProperty(
      SidePanel.WIDTH_PROPERTY,
      `${SidePanel.currentWidth}px`,
    );

    const bounds = SidePanel.getWidthBounds();
    document.querySelectorAll<HTMLElement>('.side-panel-resizer').forEach(resizer => {
      resizer.setAttribute('aria-valuemin', bounds.min.toString());
      resizer.setAttribute('aria-valuemax', bounds.max.toString());
      resizer.setAttribute('aria-valuenow', SidePanel.currentWidth.toString());
    });

    if (persist) {
      localStorage.setItem(SidePanel.WIDTH_KEY, SidePanel.currentWidth.toString());
    }
    if (refreshLayout) {
      SidePanel.refreshMainLayout();
    }
  }

  private static initializeWidth(): void {
    if (SidePanel.widthInitialized) return;
    SidePanel.widthInitialized = true;

    const storedWidth = Number.parseFloat(localStorage.getItem(SidePanel.WIDTH_KEY) ?? '');
    const defaultWidth = Math.max(window.innerWidth * 0.24, 330);
    SidePanel.setWidth(Number.isFinite(storedWidth) ? storedWidth : defaultWidth);
    window.addEventListener('resize', () => {
      // Avoid scheduling another resize while handling the synthetic resize
      // emitted by refreshMainLayout().
      SidePanel.setWidth(SidePanel.currentWidth, false, false);
    });
  }

  private static setContainerOpen(isOpen: boolean): void {
    if (isOpen) {
      $('#container')
        .css('width', `calc(100% - var(${SidePanel.WIDTH_PROPERTY}))`)
        .css('margin-left', `var(${SidePanel.WIDTH_PROPERTY})`);
      SidePanel.refreshMainLayout();
      return;
    }
    $('#container').css('width', '100%').css('margin-left', 'auto');
    SidePanel.refreshMainLayout();
  }

  private addResizer(panel: HTMLElement): void {
    if (panel.querySelector('.side-panel-resizer')) return;

    const resizer = document.createElement('div');
    resizer.className = 'side-panel-resizer';
    resizer.tabIndex = 0;
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-label', 'Resize sidebar');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.title = 'Drag to resize sidebar. Use Left and Right arrow keys for precise adjustment.';

    resizer.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      document.body.classList.add('side-panel-resizing');
      resizer.setPointerCapture(event.pointerId);

      const resize = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== event.pointerId) return;
        SidePanel.setWidth(moveEvent.clientX);
      };
      const finish = (endEvent: PointerEvent): void => {
        if (endEvent.pointerId !== event.pointerId) return;
        resizer.removeEventListener('pointermove', resize);
        resizer.removeEventListener('pointerup', finish);
        resizer.removeEventListener('pointercancel', finish);
        document.body.classList.remove('side-panel-resizing');
        SidePanel.setWidth(SidePanel.currentWidth, true);
      };

      resizer.addEventListener('pointermove', resize);
      resizer.addEventListener('pointerup', finish);
      resizer.addEventListener('pointercancel', finish);
    });

    resizer.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      SidePanel.setWidth(SidePanel.currentWidth + (direction * 16), true);
    });

    panel.append(resizer);
    SidePanel.setWidth(SidePanel.currentWidth);
  }

  hide(): void {
    // make container great again
    SidePanel.setContainerOpen(false);
    // hide panel
    const panel = document.getElementById(this.panelId);
    if (!panel) return;
    panel.toggleAttribute('hidden', true);
    // store the current state
    localStorage.removeItem('opened-sidepanel');
    const opener = document.getElementById(`${this.panelId}Opener`);
    if (!opener) return;
    opener.classList.remove('sidepanel-opened');
    opener.classList.add('sidepanel-closed');
    opener.setAttribute('aria-expanded', 'false');
  }

  show(): void {
    const panel = document.getElementById(this.panelId);
    const opener = document.getElementById(`${this.panelId}Opener`);
    if (!panel || !opener) return;

    // All sidebar tabs share one panel viewport. Close any previously open tab.
    document.querySelectorAll<HTMLElement>('.side-panel').forEach(otherPanel => {
      if (otherPanel.id === this.panelId) return;
      otherPanel.toggleAttribute('hidden', true);
      const otherOpener = document.getElementById(`${otherPanel.id}Opener`);
      otherOpener?.classList.add('sidepanel-closed');
      otherOpener?.classList.remove('sidepanel-opened');
      otherOpener?.setAttribute('aria-expanded', 'false');
    });

    this.addResizer(panel);
    SidePanel.setContainerOpen(true);
    // show panel
    panel.removeAttribute('hidden');
    // store the current state
    localStorage.setItem('opened-sidepanel', this.model);
    opener.classList.add('sidepanel-opened');
    opener.classList.remove('sidepanel-closed');
    opener.setAttribute('aria-expanded', 'true');
  }

  // TOGGLE PANEL VISIBILITY
  toggle(): void {
    const panel = document.getElementById(this.panelId);
    if (!panel) return;
    if (panel.hasAttribute('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }
}
