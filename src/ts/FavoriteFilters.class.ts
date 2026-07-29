/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import SidePanel from './SidePanel.class';

type FavoriteFilterTarget = 'experiments' | 'resources';

export default class FavoriteFilters extends SidePanel {
  constructor() {
    super('favorites');
    this.panelId = 'favoritesPanel';
  }

  updateTarget(): void {
    const target = this.getTarget();
    document.querySelectorAll<HTMLElement>('[data-favorite-target-group]').forEach(group => {
      const isActive = group.dataset.favoriteTargetGroup === target;
      group.toggleAttribute('hidden', !isActive);
      group.querySelectorAll<HTMLInputElement>('input').forEach(input => {
        input.disabled = !isActive;
      });
    });
  }

  apply(): void {
    const target = this.getTarget();
    const targetPath = target === 'experiments' ? '/experiments.php' : '/database.php';
    // Always start from the complete accessible listing. Reusing the current
    // URL could unintentionally retain "My experiments", search, or pagination.
    const url = new URL(targetPath, window.location.origin);
    url.searchParams.set('scope', '3');

    const categories = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `[data-favorite-filter-category][data-category-type="${target}"]:checked`,
      ),
      input => input.value,
    );
    if (categories.length > 0) {
      url.searchParams.set('category', categories.join(','));
    }

    const statuses = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `[data-favorite-filter-status][data-status-type="${target}"]:checked`,
      ),
      input => input.value,
    );
    if (statuses.length > 0) {
      url.searchParams.set('status', statuses.join(','));
    }

    const owner = document.querySelector<HTMLInputElement>('[data-favorite-filter-owner]:checked');
    if (owner) {
      url.searchParams.set('owner', owner.value);
    }

    document.querySelectorAll<HTMLInputElement>('[data-favorite-filter-tag]:checked').forEach(input => {
      url.searchParams.append('tags[]', input.value);
    });
    window.location.assign(url);
  }

  clear(): void {
    document.querySelectorAll<HTMLInputElement>(
      '[data-favorite-filter-category], [data-favorite-filter-tag], [data-favorite-filter-status], [data-favorite-filter-owner]',
    ).forEach(input => {
      input.checked = false;
    });
    this.apply();
  }

  getTarget(): FavoriteFilterTarget {
    const select = document.getElementById('favoriteFilterTarget') as HTMLSelectElement | null;
    return select?.value === 'resources' ? 'resources' : 'experiments';
  }
}
