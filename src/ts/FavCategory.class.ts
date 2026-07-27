/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import { Model } from './interfaces';
import SidePanel from './SidePanel.class';

export default class FavCategory extends SidePanel {
  constructor() {
    super(Model.FavCategory);
    this.panelId = 'favcategoriesPanel';
  }
}
