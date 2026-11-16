/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import CalendarPage from './components/CalendarPage.svelte';

const host = document.getElementById('calendarPageRoot');
if (host) {
  mount(CalendarPage, { target: host });
}
