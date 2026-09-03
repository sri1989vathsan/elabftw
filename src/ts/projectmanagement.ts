/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 * @package elabftw
 */
import { mount } from 'svelte';
import ProjectManagementBoard from './components/ProjectManagementBoard.svelte';

const host = document.getElementById('projectManagementRoot');
if (host) {
  mount(ProjectManagementBoard, { target: host });
}
