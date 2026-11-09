/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import SidePanel from './SidePanel.class';

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
      // Flag first: the component arrives asynchronously, and a second initialize() before then must not mount it twice.
      CalendarActivity.mounted = true;
      // Still mounted on every page (the reminders need it), but as its own chunk, out of the main bundle.
      void import(
        /* webpackChunkName: 'calendar-widget' */
        './components/CalendarTodolist.svelte'
      ).then(({ default: CalendarTodolistSv }) => {
        mount(CalendarTodolistSv, { target: host });
      }).catch(() => {
        // chunk failed to load (offline, deploy in between): allow the next initialize() to try again
        CalendarActivity.mounted = false;
      });
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
