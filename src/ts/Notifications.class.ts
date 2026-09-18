/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @author Moustapha Camara - Deltablot
 * @copyright 2025 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

import i18next from './i18n';
import type { ResponseMsg } from './interfaces';

enum NotificationType {
  Error = 'error',
  Success = 'success',
  Warning = 'warning'
}

const FLASH_PREFIX = 'flash_';

type I18nOptions = Record<string, string | number | boolean>;

/**
 * Returns an i18n translated string, both single and interpolated.
 * Overlays come in different types. See methods: success(), error(), etc.
 * Examples:
 * - 'add-quantity' => 'Add quantity'
 * - 'increment-something', 5 => 'Add 5 units'
 * - 'Random sentence' => 'Random sentence' (if not found in i18n catalog)
 */
export class Notification {
  // default value: 'Saved'
  public success(msg: string = 'saved', options?: I18nOptions): void {
    const translated = i18next.t(msg, options);
    this.notify(translated, NotificationType.Success);
  }

  // log the error in console and show a translated readable notification.
  public error(msg: string|Error, options?: I18nOptions): void {
    const translated = i18next.t(String(msg), options);
    console.error(translated);
    this.notify(translated, NotificationType.Error);
  }

  public warning(msg: string, options?: I18nOptions): void {
    const translated = i18next.t(msg, options);
    console.warn(translated);
    this.notify(translated, NotificationType.Warning);
  }

  // to handle json responses
  public response(json: ResponseMsg): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    (json.res === true
      ? this.success(json.msg)
      : this.error(json.msg));
  }

  /**
   * Consume and display flash notifications stored in sessionStorage.
   * Notifications are shown once and then removed. Intended to be called on page load.
   * example usage:
   * sessionStorage.setItem('flash_ownershipTransfer', i18next.t('ownership-transfer'));
   * Location reloads and consumes the message.
   */
  public flashSuccess(): void {
    Object.keys(sessionStorage).filter(key => key.startsWith(FLASH_PREFIX))
      .forEach(key => {
        const message = sessionStorage.getItem(key);
        if (!message) {
          sessionStorage.removeItem(key);
          return;
        }
        this.notify(message, NotificationType.Success);
        sessionStorage.removeItem(key);
      });
  }

  private notify(message: string, type: NotificationType): void {
    // add a container to hold all overlays, allow stacking
    let container = document.getElementById('overlay-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'overlay-container';
      document.body.appendChild(container);
    }

    // Success is transient and auto-dismissing -- rarely piles up, and
    // stays its own toast. Errors/warnings persist until dismissed, and
    // several in a row (e.g. a bulk operation with multiple failures)
    // used to stack up as separate cards -- grouped into one panel
    // instead, matching how task-deadline reminders combine into one
    // reminder-banner card rather than one toast per reminder.
    if (type !== NotificationType.Success) {
      this.notifyGrouped(container, message);
      return;
    }

    // create overlay
    const overlay = document.createElement('div');
    overlay.classList.add('overlay', `overlay-${type}`);
    // success gets removed on animation end
    overlay.addEventListener('animationend', () => {
      overlay.remove();
    });
    // create overlay content
    const p = document.createElement('p');
    // "status" role: see WCAG2.1 4.1.3
    p.role = 'status';
    p.innerText = message;
    overlay.appendChild(p);
    container.appendChild(overlay);
  }

  private notifyGrouped(container: HTMLElement, message: string): void {
    let panel = document.getElementById('notification-issues-panel');
    let list: HTMLUListElement;
    let title: HTMLElement;
    if (panel) {
      list = panel.querySelector('.issues-panel-list') as HTMLUListElement;
      title = panel.querySelector('.issues-panel-title') as HTMLElement;
    } else {
      panel = document.createElement('div');
      panel.id = 'notification-issues-panel';
      panel.className = 'issues-panel';
      panel.setAttribute('role', 'alert');

      const header = document.createElement('div');
      header.className = 'issues-panel-header';
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');

      const icon = document.createElement('i');
      icon.className = 'fas fa-triangle-exclamation';
      icon.setAttribute('aria-hidden', 'true');

      title = document.createElement('strong');
      title.className = 'issues-panel-title';

      const chevron = document.createElement('i');
      chevron.className = 'fas fa-chevron-down issues-panel-chevron';
      chevron.setAttribute('aria-hidden', 'true');

      const dismissAll = document.createElement('button');
      dismissAll.type = 'button';
      dismissAll.className = 'clickable';
      dismissAll.setAttribute('aria-label', 'Dismiss all');
      const dismissAllIcon = document.createElement('i');
      dismissAllIcon.className = 'fas fa-xmark';
      dismissAllIcon.setAttribute('aria-hidden', 'true');
      dismissAll.appendChild(dismissAllIcon);
      dismissAll.addEventListener('click', event => {
        event.stopPropagation();
        panel?.remove();
      });

      const toggleCollapsed = (): void => {
        list.hidden = !list.hidden;
        chevron.className = list.hidden ? 'fas fa-chevron-right issues-panel-chevron' : 'fas fa-chevron-down issues-panel-chevron';
      };
      header.addEventListener('click', toggleCollapsed);
      header.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleCollapsed();
        }
      });

      list = document.createElement('ul');
      list.className = 'issues-panel-list';

      header.append(icon, title, chevron, dismissAll);
      panel.append(header, list);
      container.appendChild(panel);
    }

    const item = document.createElement('li');
    item.className = 'issues-panel-item';
    const text = document.createElement('p');
    // "status" role: see WCAG2.1 4.1.3
    text.role = 'status';
    text.innerText = message;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'clickable';
    dismiss.setAttribute('aria-label', 'Dismiss');
    const dismissIcon = document.createElement('i');
    dismissIcon.className = 'fas fa-xmark';
    dismissIcon.setAttribute('aria-hidden', 'true');
    dismiss.appendChild(dismissIcon);
    const updateTitle = (): void => {
      const count = list.children.length;
      title.textContent = `${count} ${count === 1 ? 'issue' : 'issues'}`;
    };
    dismiss.addEventListener('click', () => {
      item.remove();
      if (list.children.length === 0) {
        panel?.remove();
        return;
      }
      updateTitle();
    });
    item.append(text, dismiss);
    list.appendChild(item);
    updateTitle();
  }
}
