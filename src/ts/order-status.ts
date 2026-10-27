/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import OrderStatus from './components/OrderStatus.svelte';

const host = document.getElementById('orderStatusRoot');
if (host) {
  mount(OrderStatus, { target: host });
}
