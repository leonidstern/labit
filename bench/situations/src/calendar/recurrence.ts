import type { CalendarEvent, Rule } from './types';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

/** How far ahead repeats are worked out, in days. */
export const HORIZON_DAYS = 400;

/** The next time a repeating event starts after `after`, or null when it has ended. */
export function nextStart(event: CalendarEvent, after: Date): Date | null {
  const rule = event.rule;
  if (!rule) return null;
  const step = stepOf(rule);
  const first = event.start.getTime();
  if (after.getTime() < first) return event.start;
  const passed = Math.floor((after.getTime() - first) / step) + 1;
  const next = new Date(first + passed * step);
  if (rule.count && passed >= rule.count) return null;
  if (rule.until && next > rule.until) return null;
  return next;
}

function stepOf(rule: Rule): number {
  switch (rule.every) {
    case 'day':
      return DAY * rule.interval;
    case 'week':
      return WEEK * rule.interval;
    default:
      throw new Error(`unknown rule: ${rule.every}`);
  }
}

/** Every start of a repeating event between `from` and `to`, oldest first. */
export function expand(event: CalendarEvent, from: Date, to: Date): Date[] {
  const rule = event.rule;
  if (!rule) return [event.start];
  const step = stepOf(rule);
  const starts: Date[] = [];
  const limit = Math.min(to.getTime(), event.start.getTime() + HORIZON_DAYS * DAY);
  let at = event.start.getTime();
  let n = 0;
  while (at <= limit) {
    if (rule.count && n >= rule.count) break;
    if (rule.until && at > rule.until.getTime()) break;
    if (at >= from.getTime()) starts.push(new Date(at));
    at += step;
    n += 1;
  }
  return starts;
}

/** A short label for the rule, for the event card: "Every week", "Every 2 days". */
export function label(rule: Rule): string {
  const unit = rule.every === 'day' ? 'day' : 'week';
  if (rule.interval === 1) return `Every ${unit}`;
  return `Every ${rule.interval} ${unit}s`;
}
