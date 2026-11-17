/**
 * A short label for when something is due, for the one-line task rows of the sidebar: "Today 17:00", "Tomorrow 09:00",
 * "Tue 15:00" (within the coming week), otherwise the day and month ("16 Oct", with the year when it is another year).
 * Past dates get the same labels, so an overdue task reads "Yesterday 11:00" or "16 Oct"; the row itself shows it in red.
 * The full date stays available as the tooltip of the label.
 * @author eLabFTW contributors
 * @license AGPL-3.0
 */
const DAY = 86400000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function shortDue(value: string, locale = 'en', now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY);
  if (days >= -1 && days <= 1) {
    const word = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day');
    return `${capitalise(word)} ${time}`;
  }
  if (days > 1 && days < 7) {
    return `${new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)} ${time}`;
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
