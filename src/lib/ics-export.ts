/**
 * ICS Calendar Export
 * Generates .ics files for deadlines, meetings, and festivals
 * Compatible with Google Calendar, Apple Calendar, Outlook
 */

interface ICSEvent {
  title: string;
  description?: string;
  startDate: Date;
  endDate?: Date;
  location?: string;
  url?: string;
}

function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeICS(text: string): string {
  return text.replace(/[\\;,\n]/g, (match) => {
    if (match === '\n') return '\\n';
    return `\\${match}`;
  });
}

function generateUID(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}@iffy.app`;
}

export function generateICSEvent(event: ICSEvent): string {
  const end = event.endDate || new Date(event.startDate.getTime() + 60 * 60 * 1000); // default 1hr

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IFFY//Lane Navigator//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${generateUID()}`,
    `DTSTART:${formatICSDate(event.startDate)}`,
    `DTEND:${formatICSDate(end)}`,
    `SUMMARY:${escapeICS(event.title)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeICS(event.location)}`);
  }
  if (event.url) {
    lines.push(`URL:${event.url}`);
  }

  // Add alarm 1 day before
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:Reminder: ${escapeICS(event.title)}`,
    'END:VALARM',
  );

  // Add alarm 1 hour before
  lines.push(
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:Reminder: ${escapeICS(event.title)}`,
    'END:VALARM',
  );

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}

export function generateMultiEventICS(events: ICSEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IFFY//Lane Navigator//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    const end = event.endDate || new Date(event.startDate.getTime() + 60 * 60 * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${generateUID()}`,
      `DTSTART:${formatICSDate(event.startDate)}`,
      `DTEND:${formatICSDate(end)}`,
      `SUMMARY:${escapeICS(event.title)}`,
    );
    if (event.description) lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeICS(event.location)}`);
    lines.push(
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      `DESCRIPTION:Reminder: ${escapeICS(event.title)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadICS(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Convenience helpers ----

export function exportDeadlineToICS(deadline: { label: string; due_date: string; notes?: string; deadline_type?: string }) {
  const ics = generateICSEvent({
    title: `⏰ ${deadline.label}`,
    description: [deadline.deadline_type, deadline.notes].filter(Boolean).join(' — '),
    startDate: new Date(deadline.due_date),
  });
  downloadICS(ics, `deadline-${deadline.label.replace(/\s+/g, '-').toLowerCase()}`);
}

export function exportMeetingToICS(meeting: { buyer_name: string; meeting_type: string; meeting_date: string; location?: string; notes?: string }) {
  const ics = generateICSEvent({
    title: `🤝 ${meeting.buyer_name} — ${meeting.meeting_type}`,
    description: meeting.notes || '',
    startDate: new Date(meeting.meeting_date),
    location: meeting.location,
  });
  downloadICS(ics, `meeting-${meeting.buyer_name.replace(/\s+/g, '-').toLowerCase()}`);
}

export function exportAllDeadlinesToICS(deadlines: { label: string; due_date: string; notes?: string; project_title?: string }[]) {
  const events = deadlines.map(d => ({
    title: `⏰ ${d.label}${d.project_title ? ` (${d.project_title})` : ''}`,
    description: d.notes || '',
    startDate: new Date(d.due_date),
  }));
  const ics = generateMultiEventICS(events);
  downloadICS(ics, 'iffy-deadlines');
}

// ---- Email helpers ----

export function composeBuyerEmail(buyer: { buyer_name: string; email: string; company?: string }, project?: { title: string; format: string; genres: string[]; budget_range: string }) {
  const subject = project
    ? `Re: ${project.title} — ${project.format === 'tv-series' ? 'TV Series' : 'Film'}`
    : `Introduction from IFFY`;

  const body = project
    ? `Dear ${buyer.buyer_name},\n\nI wanted to follow up regarding ${project.title}, a ${project.format === 'tv-series' ? 'TV series' : 'feature film'} in the ${project.genres.join('/')} space.\n\nI'd welcome the opportunity to discuss further.\n\nBest regards`
    : `Dear ${buyer.buyer_name},\n\nI hope this finds you well.\n\nBest regards`;

  const mailto = `mailto:${buyer.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(mailto, '_blank');
}
