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
import CalendarTodolistSv from './components/CalendarTodolist.svelte';

export default class Todolist extends SidePanel {

  unfinishedStepsScope: string;
  private static mounted = false;
  private static calendarMounted = false;


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
    const calendarHost = document.getElementById('calendarTodolist');
    if (calendarHost && !Todolist.calendarMounted && calendarHost.childElementCount === 0) {
      mount(CalendarTodolistSv, {
        target: calendarHost,
      });
      Todolist.calendarMounted = true;
    }
  }

  showView(view: 'tasks' | 'calendar'): void {
    const tasksView = document.getElementById('todolistTasksView');
    const calendarView = document.getElementById('todolistCalendarView');
    const tasksTab = document.getElementById('todoTasksTab');
    const calendarTab = document.getElementById('todoCalendarTab');
    const showCalendar = view === 'calendar';
    tasksView?.toggleAttribute('hidden', showCalendar);
    calendarView?.toggleAttribute('hidden', !showCalendar);
    tasksTab?.classList.toggle('btn-primary', !showCalendar);
    tasksTab?.classList.toggle('btn-outline-primary', showCalendar);
    calendarTab?.classList.toggle('btn-primary', showCalendar);
    calendarTab?.classList.toggle('btn-outline-primary', !showCalendar);
    tasksTab?.setAttribute('aria-selected', String(!showCalendar));
    calendarTab?.setAttribute('aria-selected', String(showCalendar));
    localStorage.setItem('todolistView', view);
    if (!showCalendar) this.loadUnfinishedStep();
  }

  // TOGGLE TODOLIST VISIBILITY
  toggle(): void {
    super.toggle();
    this.initialize();
    const panel = document.getElementById(this.panelId);
    const isOpen = !!panel && !panel.hasAttribute('hidden');
    if (isOpen) {
      const view = localStorage.getItem('todolistView') === 'calendar' ? 'calendar' : 'tasks';
      this.showView(view);
    }
  }
}
