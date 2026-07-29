/**
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
import SidePanel from './SidePanel.class';

type FavoriteFilterTarget = 'experiments' | 'resources';

const ACCORDION_STORAGE_KEY = 'elabftw-favorite-filter-accordion-v1';

export default class FavoriteFilters extends SidePanel {
  constructor() {
    super('favorites');
    this.panelId = 'favoritesPanel';
    this.initializeAccordion();
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
    this.updateSectionCounts();
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

  private initializeAccordion(): void {
    const sections = this.getAccordionSections();
    let savedState: Record<string, boolean> = {};
    try {
      const candidate = JSON.parse(localStorage.getItem(ACCORDION_STORAGE_KEY) ?? '{}') as unknown;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        savedState = candidate as Record<string, boolean>;
      }
    } catch {
      // Invalid stored UI state should not prevent the filter panel from loading.
    }
    sections.forEach(section => {
      const sectionId = section.dataset.favoriteFilterSection;
      if (!sectionId) return;
      if (typeof savedState[sectionId] === 'boolean') {
        section.open = savedState[sectionId];
      }
      section.addEventListener('toggle', () => this.saveAccordionState());
      section.addEventListener('change', () => this.updateSectionCounts());
    });
    this.updateSectionCounts();
  }

  private getAccordionSections(): HTMLDetailsElement[] {
    return Array.from(
      document.querySelectorAll<HTMLDetailsElement>('[data-favorite-filter-section]'),
    );
  }

  private saveAccordionState(): void {
    const state: Record<string, boolean> = {};
    this.getAccordionSections().forEach(section => {
      const sectionId = section.dataset.favoriteFilterSection;
      if (sectionId) state[sectionId] = section.open;
    });
    try {
      localStorage.setItem(ACCORDION_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Accordion persistence is optional.
    }
  }

  private updateSectionCounts(): void {
    this.getAccordionSections().forEach(section => {
      const selectedCount = Array.from(
        section.querySelectorAll<HTMLInputElement>('input:checked'),
      ).filter(input => {
        const targetGroup = input.closest<HTMLElement>('[data-favorite-target-group]');
        return !targetGroup?.hidden;
      }).length;
      const badge = section.querySelector<HTMLElement>('.favorite-filter-section-count');
      if (!badge) return;
      badge.textContent = String(selectedCount);
      badge.hidden = selectedCount === 0;
      badge.setAttribute(
        'aria-label',
        `${selectedCount} selected ${selectedCount === 1 ? 'filter' : 'filters'}`,
      );
    });
  }
}
