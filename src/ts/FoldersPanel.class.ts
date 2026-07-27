/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import SidePanel from './SidePanel.class';

export default class FoldersPanel extends SidePanel {
  constructor() {
    super('folders');
    this.panelId = 'foldersPanel';
  }
}
