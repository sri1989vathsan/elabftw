/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import SidePanel from './SidePanel.class';
import CalendarTodolistSv from './components/CalendarTodolist.svelte';

const CALENDAR_ACTIVITY_MODEL = 'calendar-activity';
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

export default class CalendarActivity extends SidePanel {
  private static mounted = false;

  constructor() {
    super(CALENDAR_ACTIVITY_MODEL);
    this.panelId = 'calendarActivityPanel';
    this.scrollToRequestedHeading();
  }

  initialize(): void {
    const host = document.getElementById('calendarActivity');
    if (host && !CalendarActivity.mounted && host.childElementCount === 0) {
      mount(CalendarTodolistSv, { target: host });
      CalendarActivity.mounted = true;
    }
  }

  toggle(): void {
    super.toggle();
    this.initialize();
  }

  private scrollToRequestedHeading(): void {
    const value = new URLSearchParams(window.location.search).get('activity_heading');
    if (value === null) return;
    const index = Number.parseInt(value, 10);
    if (!Number.isInteger(index) || index < 0) return;

    window.requestAnimationFrame(() => {
      const body = document.getElementById('body_view');
      const heading = body?.querySelectorAll<HTMLElement>(HEADING_SELECTOR)[index];
      if (!heading) return;
      if (!heading.id) heading.id = `activity-heading-${index + 1}`;
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
      heading.classList.add('toc-highlight');
      window.setTimeout(() => heading.classList.remove('toc-highlight'), 1800);
    });
  }
}
