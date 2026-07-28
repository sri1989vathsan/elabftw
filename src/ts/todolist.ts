/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import Todolistc from './Todolist.class';
import { Model } from './interfaces';
import { core } from './core';
import { on } from './handlers';
import { reloadElements } from './misc';

if (document.getElementById('todolistPanel') && !core.isAnon) {

  let unfinishedStepsScope = 'user';
  // unfinished steps scopeSwitch i.e. user (0) or team (1)
  let scopeSwitch = document.getElementById(Model.Todolist + 'StepsShowTeam') as HTMLInputElement;
  const storageScopeSwitch = localStorage.getItem(Model.Todolist + 'StepsShowTeam');
  // adjust scope from localStorage
  if (scopeSwitch.checked && storageScopeSwitch === '0') {
    scopeSwitch.checked = false;

  // set storage value if default setting is team
  } else if (scopeSwitch.checked) {
    localStorage.setItem(Model.Todolist + 'StepsShowTeam', '1');
    unfinishedStepsScope = 'team';

  // check box if it was checked before
  } else if (storageScopeSwitch === '1') {
    scopeSwitch.checked = true;
    unfinishedStepsScope = 'team';
  }

  const TodolistC = new Todolistc();
  TodolistC.unfinishedStepsScope = unfinishedStepsScope;
  TodolistC.initialize();

  window.addEventListener('todolist-changed', () => {
    // A completed task/step removes its deadline notification server-side.
    // Refresh the rendered header bell so it does not stay highlighted.
    void reloadElements(['navbarNotifDiv']);
  });

  on('todo-panel-view', (el: HTMLElement) => {
    TodolistC.showView(el.dataset.view === 'calendar' ? 'calendar' : 'tasks');
  });

  scopeSwitch = document.getElementById(TodolistC.model + 'StepsShowTeam') as HTMLInputElement;
  scopeSwitch.addEventListener('change', () => {
    if (!document.getElementById(TodolistC.panelId).hasAttribute('hidden')){
      TodolistC.toggleUnfinishedStepsScope();
    }
  });

  const requestedView = new URLSearchParams(window.location.search).get('todo');
  if (requestedView === 'calendar') {
    TodolistC.showView('calendar');
    if (document.getElementById(TodolistC.panelId).hasAttribute('hidden')) {
      TodolistC.toggle();
    }
  }
}
