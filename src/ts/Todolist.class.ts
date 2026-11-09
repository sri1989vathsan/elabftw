/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import { Model } from './interfaces';
import SidePanel from './SidePanel.class';
import { mount } from 'svelte';

export default class Todolist extends SidePanel {

  unfinishedStepsScope: string;
  private static mounted = false;


  constructor() {
    super(Model.Todolist);
    this.panelId = 'todolistPanel';
    this.unfinishedStepsScope = 'user';
  }

  toggleUnfinishedStepsScope(): void {
    localStorage.setItem(this.model + 'StepsShowTeam', (localStorage.getItem(this.model + 'StepsShowTeam') === '1' ? '0' : '1'));
    this.unfinishedStepsScope = (this.unfinishedStepsScope === 'user' ? 'team' : 'user');
    this.loadUnfinishedStep();
  }

  loadUnfinishedStep(): void {
    window.dispatchEvent(new CustomEvent('todolist-scope-changed'));
  }

  initialize(): void {
    const host = document.getElementById('todolist');
    if (host && !Todolist.mounted && host.childElementCount === 0) {
      // Flag first: the component arrives asynchronously, and a second toggle() before then must not mount it twice.
      Todolist.mounted = true;
      // The widget code is its own chunk, so it stays out of the main bundle every page waits for.
      void import(
        /* webpackChunkName: 'todolist-widget' */
        './components/Todolist.svelte'
      ).then(({ default: TodolistSv }) => {
        mount(TodolistSv, { target: host });
      }).catch(() => {
        // chunk failed to load (offline, deploy in between): allow the next toggle() to try again
        Todolist.mounted = false;
      });
    }
  }

  // TOGGLE TODOLIST VISIBILITY
  toggle(): void {
    super.toggle();
    this.initialize();
  }
}
