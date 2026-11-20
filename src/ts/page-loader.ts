/**
 * @author Nicolas CARPi / Deltablot
 * @copyright 2026 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

/**
 * This page will conditionally load ts code depending on the page or presence of an element
 */
const mode = new URLSearchParams(window.location.search).get('mode');
import { core } from './core';
import { loadTinymce } from './tinymce-global';

if (document.getElementById('ketcher-root')) {
  void import(
    /* webpackChunkName: 'chem-editor' */
    './chem-editor'
  );
}

if (document.getElementById('syc-root')) {
  void import(
    /* webpackChunkName: 'opencloning' */
    './opencloning'
  );
}

if (window.location.pathname === '/ucp.php') {
  void import(
    /* webpackChunkName: 'ucp' */
    './ucp'
  );
}

if (window.location.pathname === '/scheduler.php') {
  void import(
    /* webpackChunkName: 'scheduler' */
    './scheduler'
  );
}

if (document.getElementById('users-table')) {
  void import(
    /* webpackChunkName: 'editusers' */
    './editusers'
  );
}

if (window.location.pathname === '/sysconfig.php') {
  void import(
    /* webpackChunkName: 'sysconfig' */
    './sysconfig'
  );
}

if (document.getElementById('compounds-table')) {
  void import(
    /* webpackChunkName: 'compounds-table' */
    './compounds-table'
  );
}

if (window.location.pathname === '/profile.php') {
  void import(
    /* webpackChunkName: 'profile' */
    './profile'
  );
}

if (document.getElementById('stepsDiv')) {
  void import(
    /* webpackChunkName: 'steps-links' */
    './steps-links'
  );
}

// the spreadsheet engine (view.ts mounts the sheets of the text with it) and TinyMCE are chunks of their own: fetch them at the same time
// as the page's chunk, not after it, and only where there is a sheet or an editor
if (mode === 'view' && document.querySelector('#body_view table.elabftw-spreadsheet')) {
  void import(
    /* webpackChunkName: 'inline-spreadsheet' */
    './inline-spreadsheet'
  );
}

if (mode === 'edit' || document.querySelector('textarea.mceditable')) {
  void loadTinymce();
}

if (mode === 'view') {
  void import(
    /* webpackChunkName: 'view' */
    './view'
  );
}

if (mode === 'edit') {
  void import(
    /* webpackChunkName: 'edit' */
    './edit'
  );
}

if (window.location.pathname === '/team.php') {
  void import(
    /* webpackChunkName: 'team' */
    './team'
  );
}

if (document.getElementById('uploadsDiv')) {
  void import(
    /* webpackChunkName: 'uploads' */
    './uploads'
  );
}

if (window.location.pathname === '/revisions.php') {
  void import(
    /* webpackChunkName: 'revisions' */
    './revisions'
  );
}

if (document.getElementById('topToolbar')) {
  void import(
    /* webpackChunkName: 'toolbar' */
    './toolbar'
  );
}

if (document.getElementById('todolistPanel') && !core.isAnon) {
  void import(
    /* webpackChunkName: 'todolist' */
    './todolist'
  );
}

if (document.getElementById('feedbackRoot')) {
  void import(
    /* webpackChunkName: 'feedback' */
    './feedback'
  );
}

// the calendar settings window opens on the page the user is on: the gear of the to-do panel, the Settings button of the calendar page
function openCalendarSettings(): void {
  void import(
    /* webpackChunkName: 'calendar-settings' */
    './calendar-settings'
  ).then(module => module.openCalendarSettings());
}

document.addEventListener('click', event => {
  if ((event.target as HTMLElement | null)?.closest('[data-calendar-settings]')) {
    event.preventDefault();
    openCalendarSettings();
  }
});

if (['#settings', '#calendars'].includes(window.location.hash) && document.getElementById('googleSyncRow') !== null) {
  openCalendarSettings();
}

if (document.getElementById('calendarPageRoot')) {
  void import(
    /* webpackChunkName: 'calendar-page' */
    './calendar-page'
  );
}

if (document.getElementById('projectManagementRoot')) {
  void import(
    /* webpackChunkName: 'projectmanagement' */
    './projectmanagement'
  );
}

if (document.getElementById('ordersRoot')) {
  void import(
    /* webpackChunkName: 'orders' */
    './orders'
  );
}

if (document.getElementById('orderStatusRoot')) {
  void import(
    /* webpackChunkName: 'order-status' */
    './order-status'
  );
}

if (document.getElementById('orderTemplatesRoot')) {
  void import(
    /* webpackChunkName: 'order-templates' */
    './order-templates'
  );
}
