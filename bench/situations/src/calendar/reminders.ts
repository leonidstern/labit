import type { CalendarEvent, User } from './types';
import { push } from '../notify/push';

const MINUTE = 60_000;

/** When the reminder for this event goes out, or null when the user turned reminders off. */
export function reminderTime(event: CalendarEvent, user: User): Date | null {
  if (user.reminderMinutes === null) return null;
  return new Date(event.start.getTime() - user.reminderMinutes * MINUTE);
}

/** True while the user does not want to be disturbed: 22:00 to 07:00 unless they changed it. */
export function inQuietHours(user: User, at: Date): boolean {
  const hour = at.getHours();
  const from = user.quietFrom ?? 22;
  const to = user.quietTo ?? 7;
  if (from === to) return false;
  if (from < to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

/** One line about tomorrow's events, sent in the evening instead of one push per event. */
export function digest(events: CalendarEvent[], user: User): string {
  const lines: string[] = [];
  for (const event of events) {
    const at = reminderTime(event, user);
    if (!at) continue;
    lines.push(`${event.title} at ${event.start.toLocaleTimeString()}`);
  }
  if (lines.length === 0) return '';
  return `Tomorrow: ${lines.join(', ')}`;
}

/** Sends the reminders that are due now. Returns how many went out. */
export async function sendDue(events: CalendarEvent[], user: User, now: Date): Promise<number> {
  let sent = 0;
  for (const event of events) {
    const at = reminderTime(event, user);
    if (!at) continue;
    if (at > now) continue;
    if (inQuietHours(user, now)) continue;
    await push(user.id, `${event.title} starts soon`);
    sent += 1;
  }
  return sent;
}
