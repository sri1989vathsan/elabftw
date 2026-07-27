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
  panelId: string;
  model: Model | string;

  constructor(model: Model | string) {
    this.model = model;
  }

  hide(): void {
    // make container great again
    $('#container').css('width', '100%').css('margin-left', 'auto');
    // hide panel
    const panel = document.getElementById(this.panelId);
    if (!panel) return;
    panel.toggleAttribute('hidden', true);
    // store the current state
    localStorage.removeItem('opened-sidepanel');
    const opener = document.getElementById(`${this.panelId}Opener`);
    if (!opener) return;
    opener.classList.add('bounce-right');
    opener.classList.remove('bounce-left');
    opener.classList.remove('sidepanel-opened');
    opener.classList.add('sidepanel-closed');
    opener.setAttribute('aria-expanded', 'false');
    document.getElementById('sidepanel-buttons')?.classList.remove('has-open-panel');
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
      otherOpener?.classList.add('bounce-right', 'sidepanel-closed');
      otherOpener?.classList.remove('bounce-left', 'sidepanel-opened');
      otherOpener?.setAttribute('aria-expanded', 'false');
    });

    $('#container').css('width', '76%').css('margin-left', 'max(24%, 330px)');
    // show panel
    panel.removeAttribute('hidden');
    // store the current state
    localStorage.setItem('opened-sidepanel', this.model);
    opener.classList.remove('bounce-right');
    opener.classList.add('bounce-left');
    opener.classList.add('sidepanel-opened');
    opener.classList.remove('sidepanel-closed');
    opener.setAttribute('aria-expanded', 'true');
    document.getElementById('sidepanel-buttons')?.classList.add('has-open-panel');
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
