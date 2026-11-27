export interface Rule {
  every: 'day' | 'week';
  interval: number;
  count?: number;
  until?: Date;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  zone: string;
  allDay: boolean;
  rule?: Rule;
}

export interface Guest {
  id: string;
  email: string;
  locale: string;
  optedOut: boolean;
  answer: 'yes' | 'no' | 'maybe' | 'none';
}

export interface User {
  id: string;
  reminderMinutes: number | null;
  quietFrom?: number;
  quietTo?: number;
}
