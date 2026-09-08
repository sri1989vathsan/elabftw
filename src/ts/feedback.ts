/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import FeedbackBoard from './components/FeedbackBoard.svelte';

const host = document.getElementById('feedbackRoot');
if (host) {
  mount(FeedbackBoard, { target: host });
}
