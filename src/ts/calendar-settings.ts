/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import CalendarSettings from './components/CalendarSettings.svelte';

let mounted = false;

// opens the calendar settings window on the page the user is on (the first call puts it on the page)
export function openCalendarSettings(): void {
  if (!mounted) {
    mounted = true;
    const target = document.createElement('div');
    document.body.appendChild(target);
    mount(CalendarSettings, { target, props: { startOpen: true } });
    return;
  }
  window.dispatchEvent(new CustomEvent('elabftw:calendar-settings-open'));
}
