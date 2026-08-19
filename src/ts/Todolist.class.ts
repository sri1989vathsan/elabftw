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
import TodolistSv from './components/Todolist.svelte';

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
      mount(TodolistSv, {
        target: host,
      });
      Todolist.mounted = true;
    }
  }

  // TOGGLE TODOLIST VISIBILITY
  toggle(): void {
    super.toggle();
    this.initialize();
  }
}
