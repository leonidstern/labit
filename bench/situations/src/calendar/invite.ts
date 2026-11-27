import { mailer } from '../mail/mailer';
import { audit } from '../audit/log';
import { render } from './invite-template';
import type { CalendarEvent, Guest } from './types';

/** Sends one invite per guest and returns the ids of the guests that got one. */
export async function sendInvites(event: CalendarEvent, guests: Guest[]): Promise<string[]> {
  const sent: string[] = [];
  for (const guest of guests) {
    if (guest.optedOut) continue;
    await mailer.send(guest.email, render(event, guest.locale));
    sent.push(guest.id);
  }
  await audit.log('invites.sent', sent.length);
  return sent;
}

/** Sends the invite again to guests who have not answered yet. */
export async function resendInvites(event: CalendarEvent, guests: Guest[]): Promise<string[]> {
  const sent: string[] = [];
  for (const guest of guests) {
    if (guest.answer !== 'none') continue;
    await mailer.send(guest.email, render(event, guest.locale));
    sent.push(guest.id);
  }
  await audit.log('invites.sent', sent.length);
  return sent;
}
