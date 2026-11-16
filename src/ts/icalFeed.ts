/**
 * Reads an iCalendar file (the .ics file behind the web address of a calendar) into the events that fall in some days, without any browser or
 * network code (so it can be tested). It knows the usual events: all-day and timed, UTC, floating and named time zones (through Intl),
 * lengths from an end or a DURATION, and repeating events (RRULE with DAILY, WEEKLY with BYDAY, MONTHLY with a day or an Nth weekday, YEARLY;
 * INTERVAL, COUNT, UNTIL), their EXDATE days and the single changed occurrences (RECURRENCE-ID).
 */

export type FeedEvent = { key: string; title: string; start: Date; end: Date; allDay: boolean };

type Prop = { params: Record<string, string>; value: string };
type Block = Record<string, Prop[]>;

const DAY = 86400000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MAX_STEPS = 6000;

// "webcal://" is an https address
export function feedAddress(input: string): string {
  const url = input.trim().replace(/^webcal:\/\//i, 'https://');
  return /^https?:\/\//i.test(url) ? url : '';
}

function unfold(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  const colon = (() => {
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === '"') quoted = !quoted;
      else if (line[index] === ':' && !quoted) return index;
    }
    return -1;
  })();
  if (colon < 1) return null;
  const [name, ...rest] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), prop: { params, value: line.slice(colon + 1) } };
}

function eventBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const line of unfold(text)) {
    if (line.trim().toUpperCase() === 'BEGIN:VEVENT') {
      current = {};
    } else if (line.trim().toUpperCase() === 'END:VEVENT') {
      if (current) blocks.push(current);
      current = null;
    } else if (current) {
      const parsed = parseLine(line);
      if (parsed) (current[parsed.name] ??= []).push(parsed.prop);
    }
  }
  return blocks;
}

// the clock reading of an instant in a time zone, as if it were UTC
function zoneWall(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

// the instant when the clock of a time zone reads `wall` (given as if UTC); a zone that is not known is the time zone of the browser
function wallToInstant(wall: number, zone: string | null): number {
  const date = new Date(wall);
  if (zone === 'Z') return wall;
  if (zone === null) {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()).getTime();
  }
  try {
    let instant = wall - (zoneWall(wall, zone) - wall);
    instant = wall - (zoneWall(instant, zone) - instant);
    return instant;
  } catch {
    return wallToInstant(wall, null);
  }
}

type When = { wall: number; zone: string | null; allDay: boolean };

function parseWhen(prop: Prop): When | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!match) return null;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0));
  if (match[4] === undefined) return { wall, zone: null, allDay: true };
  return { wall, zone: match[7] ? 'Z' : (prop.params.TZID ?? null), allDay: false };
}

function parseDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[2] ?? 0) * 604800 + Number(match[3] ?? 0) * 86400 + Number(match[4] ?? 0) * 3600 + Number(match[5] ?? 0) * 60 + Number(match[6] ?? 0);
  return (match[1] === '-' ? -1 : 1) * seconds * 1000;
}

type Rule = { freq: string; interval: number; count: number | null; until: number | null; byDay: { n: number; day: number }[]; byMonthDay: number[] };

function parseRule(value: string): Rule | null {
  const parts: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) parts[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(parts.FREQ)) return null;
  const until = parts.UNTIL ? parseWhen({ params: {}, value: parts.UNTIL }) : null;
  return {
    freq: parts.FREQ,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    count: parts.COUNT ? Number(parts.COUNT) : null,
    // the end of the last day when only a day is given
    until: until ? (until.allDay ? until.wall + DAY - 1 : until.wall) : null,
    byDay: (parts.BYDAY ?? '').split(',').filter(Boolean).flatMap(item => {
      const found = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(item.trim().toUpperCase());
      return found ? [{ n: Number(found[1] ?? 0), day: WEEKDAYS.indexOf(found[2]) }] : [];
    }),
    byMonthDay: (parts.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// the days of one month for a weekday with an ordinal (2TU: the second Tuesday, -1FR: the last Friday, 0: all of them)
function weekdaysOfMonth(year: number, month: number, day: number, n: number): number[] {
  const all: number[] = [];
  for (let date = 1; date <= daysInMonth(year, month); date += 1) {
    if (new Date(Date.UTC(year, month, date)).getUTCDay() === day) all.push(date);
  }
  if (n === 0) return all;
  const picked = n > 0 ? all[n - 1] : all[all.length + n];
  return picked === undefined ? [] : [picked];
}

// the days (as the clock reading, at the time of the start) on which a repeating event happens, from the first one on
function* occurrences(start: number, rule: Rule): Generator<number> {
  const first = new Date(start);
  const timeOfDay = start - Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
  const dayStart = start - timeOfDay;
  if (rule.freq === 'DAILY') {
    for (let step = 0; step < MAX_STEPS; step += 1) yield start + step * rule.interval * DAY;
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length > 0 ? rule.byDay.map(item => item.day) : [first.getUTCDay()];
    const monday = dayStart - ((first.getUTCDay() + 6) % 7) * DAY;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const week = monday + step * rule.interval * 7 * DAY;
      for (const day of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        const date = week + ((day + 6) % 7) * DAY;
        if (date >= dayStart) yield date + timeOfDay;
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const month = first.getUTCMonth() + step * rule.interval;
      const year = first.getUTCFullYear() + Math.floor(month / 12);
      const mon = ((month % 12) + 12) % 12;
      let dates: number[];
      if (rule.byDay.length > 0) {
        dates = rule.byDay.flatMap(item => weekdaysOfMonth(year, mon, item.day, item.n));
      } else if (rule.byMonthDay.length > 0) {
        dates = rule.byMonthDay.map(day => (day < 0 ? daysInMonth(year, mon) + day + 1 : day)).filter(day => day >= 1 && day <= daysInMonth(year, mon));
      } else {
        dates = first.getUTCDate() <= daysInMonth(year, mon) ? [first.getUTCDate()] : [];
      }
      for (const date of [...new Set(dates)].sort((a, b) => a - b)) {
        const value = Date.UTC(year, mon, date) + timeOfDay;
        if (value >= start) yield value;
      }
    }
  } else {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const year = first.getUTCFullYear() + step * rule.interval;
      if (first.getUTCDate() <= daysInMonth(year, first.getUTCMonth())) yield Date.UTC(year, first.getUTCMonth(), first.getUTCDate()) + timeOfDay;
    }
  }
}

// the name the calendar gives itself, and whether the text is a calendar at all
export function feedInfo(text: string): { valid: boolean; name: string } {
  const valid = /^BEGIN:VCALENDAR/im.test(text.trimStart());
  const found = /^X-WR-CALNAME[^:\r\n]*:(.*)$/im.exec(text);
  return { valid, name: found ? unescapeText(found[1]).trim() : '' };
}

export function parseFeed(text: string, range: { from: Date; to: Date }): FeedEvent[] {
  const from = range.from.getTime();
  const to = range.to.getTime();
  const out: FeedEvent[] = [];
  const blocks = eventBlocks(text);
  // the single occurrences that were changed: their place in the repeating event is not used any more
  const replaced = new Set<string>();
  for (const block of blocks) {
    const id = block['RECURRENCE-ID']?.[0];
    const uid = block.UID?.[0]?.value;
    const when = id ? parseWhen(id) : null;
    if (uid && when) replaced.add(`${uid}|${wallToInstant(when.wall, when.zone)}`);
  }

  for (const block of blocks) {
    const startProp = block.DTSTART?.[0];
    const when = startProp ? parseWhen(startProp) : null;
    if (!when || block.STATUS?.[0]?.value.toUpperCase() === 'CANCELLED') continue;
    const uid = block.UID?.[0]?.value ?? `${when.wall}`;
    const title = unescapeText(block.SUMMARY?.[0]?.value ?? '').trim() || '(no title)';
    const endProp = block.DTEND?.[0];
    const end = endProp ? parseWhen(endProp) : null;
    const duration = block.DURATION?.[0] ? parseDuration(block.DURATION[0].value) : null;
    // the length: in clock days for an all-day event, else in real time (nothing without an end: shown as half an hour)
    const dayLength = end ? end.wall - when.wall : duration ?? DAY;
    const firstBegin = wallToInstant(when.wall, when.allDay ? null : when.zone);
    const realLength = end ? wallToInstant(end.wall, end.allDay ? null : (end.zone ?? when.zone)) - firstBegin : duration ?? 0;
    const rule = block.RRULE?.[0] ? parseRule(block.RRULE[0].value) : null;
    const excluded = new Set(
      (block.EXDATE ?? []).flatMap(prop => prop.value.split(',').map(value => parseWhen({ params: prop.params, value })))
        .filter((item): item is When => item !== null)
        .map(item => (item.allDay ? item.wall : wallToInstant(item.wall, item.zone ?? when.zone))),
    );
    const make = (wall: number, key: string): void => {
      const begin = when.allDay ? wallToInstant(wall, null) : wallToInstant(wall, when.zone);
      let finish = when.allDay ? wallToInstant(wall + dayLength, null) : begin + realLength;
      if (!(finish > begin)) finish = begin + (when.allDay ? DAY : 30 * 60000);
      if (begin < to && finish > from) out.push({ key, title, start: new Date(begin), end: new Date(finish), allDay: when.allDay });
    };

    if (!rule) {
      make(when.wall, `${uid}|${when.wall}`);
      continue;
    }
    let count = 0;
    for (const wall of occurrences(when.wall, rule)) {
      count += 1;
      if (rule.count !== null && count > rule.count) break;
      if (rule.until !== null && wall > rule.until) break;
      const instant = when.allDay ? wall : wallToInstant(wall, when.zone);
      if (instant >= to + 2 * DAY) break;
      if (excluded.has(when.allDay ? wall : instant) || replaced.has(`${uid}|${when.allDay ? wallToInstant(wall, null) : instant}`)) continue;
      make(wall, `${uid}|${wall}`);
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
