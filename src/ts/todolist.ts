/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import Todolist from './Todolist.class';
import { Model } from './interfaces';
import { on } from './handlers';
import { reloadElements } from './misc';

let unfinishedStepsScope = 'user';
let scopeSwitch = document.getElementById(Model.Todolist + 'StepsShowTeam') as HTMLInputElement;
const storageScopeSwitch = localStorage.getItem(Model.Todolist + 'StepsShowTeam');

if (scopeSwitch.checked && storageScopeSwitch === '0') {
  scopeSwitch.checked = false;
} else if (scopeSwitch.checked) {
  localStorage.setItem(Model.Todolist + 'StepsShowTeam', '1');
  unfinishedStepsScope = 'team';
} else if (storageScopeSwitch === '1') {
  scopeSwitch.checked = true;
  unfinishedStepsScope = 'team';
}

const todolist = new Todolist();
todolist.unfinishedStepsScope = unfinishedStepsScope;
todolist.initialize();

window.addEventListener('todolist-changed', () => {
  // Completed tasks and steps remove their deadline notification server-side.
  void reloadElements(['navbarNotifDiv']);
});

scopeSwitch = document.getElementById(todolist.model + 'StepsShowTeam') as HTMLInputElement;
scopeSwitch.addEventListener('change', () => {
  if (!document.getElementById(todolist.panelId).hasAttribute('hidden')) {
    todolist.toggleUnfinishedStepsScope();
  }
});
