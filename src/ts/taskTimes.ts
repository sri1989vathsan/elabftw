/**
 * A to-do task has a begin (its deadline) and an end time. The end is kept as the length of the task in minutes (the server, the calendar
 * feed and the Google sync all use that), so these functions turn the end time of the day into the length and back. A task lasts at most
 * 24 hours: an end time that is not after the begin time is on the next day.
 */

export const MIN_MINUTES = 5;
export const MAX_MINUTES = 1440;

function minuteOfDay(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clock(minute: number): string {
  const day = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`;
}

// the end time of the day ('HH:MM') of a task that begins at `begin` and lasts `minutes`; '' while there is no begin time
export function endTimeOf(begin: string, minutes: number): string {
  const start = minuteOfDay(begin);
  return start === null ? '' : clock(start + minutes);
}

// the length of a task from its begin and end time of the day, or null when they are the same time (or not times)
export function lengthOf(begin: string, end: string): number | null {
  const start = minuteOfDay(begin);
  const stop = minuteOfDay(end);
  if (start === null || stop === null || start === stop) {
    return null;
  }
  const minutes = (stop - start + 1440) % 1440;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes));
}

// the end is after midnight: it is on the day after the begin
export function endsNextDay(begin: string, minutes: number): boolean {
  const start = minuteOfDay(begin);
  return start !== null && start + minutes >= 1440;
}

// the quarter hours of the day, and the end time of the task when it is not one of them
export function endChoices(quarterHours: string[], current: string): string[] {
  return current === '' || quarterHours.includes(current) ? quarterHours : [...quarterHours, current].sort();
}
