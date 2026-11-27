import type { CalendarEvent } from './types';

/** Minutes between UTC and the zone at that moment, daylight saving included. */
export function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at);
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** The event's start and end as the viewer's clock shows them. */
export function inZone(event: CalendarEvent, zone: string): { start: Date; end: Date } {
  const startShift = offsetMinutes(zone, event.start) - offsetMinutes(event.zone, event.start);
  const endShift = offsetMinutes(zone, event.end) - offsetMinutes(event.zone, event.end);
  return {
    start: new Date(event.start.getTime() + startShift * 60_000),
    end: new Date(event.end.getTime() + endShift * 60_000),
  };
}

/** True when the event crosses midnight for the viewer but not for its owner. */
export function movesDay(event: CalendarEvent, zone: string): boolean {
  if (event.allDay) return false;
  const local = inZone(event, zone);
  if (local.start.getDate() === local.end.getDate()) return false;
  return event.start.getDate() === event.end.getDate();
}

/** True when the card should show the zone next to the time. */
export function needsZoneLabel(event: CalendarEvent, zone: string): boolean {
  if (event.allDay) return false;
  return offsetMinutes(zone, event.start) !== offsetMinutes(event.zone, event.start);
}
