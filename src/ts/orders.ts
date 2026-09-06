/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import OrdersBoard from './components/OrdersBoard.svelte';

const host = document.getElementById('ordersRoot');
if (host) {
  mount(OrdersBoard, { target: host });
}
