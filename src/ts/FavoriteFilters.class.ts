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
    document.querySelectorAll<HTMLElement>('[data-favorite-category-group]').forEach(group => {
      const isActive = group.dataset.favoriteCategoryGroup === target;
      group.toggleAttribute('hidden', !isActive);
      group.querySelectorAll<HTMLInputElement>('[data-favorite-filter-category]').forEach(input => {
        input.disabled = !isActive;
      });
    });
  }

  apply(): void {
    const target = this.getTarget();
    const targetPath = target === 'experiments' ? '/experiments.php' : '/database.php';
    const currentPath = window.location.pathname;
    const isCurrentListing = currentPath.endsWith(targetPath);
    const url = isCurrentListing
      ? new URL(window.location.href)
      : new URL(targetPath, window.location.origin);

    const categories = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `[data-favorite-filter-category][data-category-type="${target}"]:checked`,
      ),
      input => input.value,
    );
    if (categories.length > 0) {
      url.searchParams.set('category', categories.join(','));
    } else {
      url.searchParams.delete('category');
      url.searchParams.delete('cat');
    }

    url.searchParams.delete('tags[]');
    document.querySelectorAll<HTMLInputElement>('[data-favorite-filter-tag]:checked').forEach(input => {
      url.searchParams.append('tags[]', input.value);
    });
    url.searchParams.delete('offset');
    window.location.assign(url);
  }

  clear(): void {
    document.querySelectorAll<HTMLInputElement>(
      '[data-favorite-filter-category], [data-favorite-filter-tag]',
    ).forEach(input => {
      input.checked = false;
    });
    this.apply();
  }

  private getTarget(): FavoriteFilterTarget {
    const select = document.getElementById('favoriteFilterTarget') as HTMLSelectElement | null;
    return select?.value === 'resources' ? 'resources' : 'experiments';
  }
}
