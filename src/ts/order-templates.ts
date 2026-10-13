/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import OrderTemplates from './components/OrderTemplates.svelte';

const host = document.getElementById('orderTemplatesRoot');
if (host) {
  mount(OrderTemplates, { target: host });
}
