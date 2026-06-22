/** Minimal iCal generator for "Add to calendar" download. */

interface IcsArgs {
  uid: string;
  title: string;
  description?: string;
  url?: string;
  starts_at: Date;
  ends_at: Date;
  location?: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toIcsDate(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildIcs(args: IcsArgs): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pixie Girl Hub//Sales Campaign//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${args.uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(args.starts_at)}`,
    `DTEND:${toIcsDate(args.ends_at)}`,
    `SUMMARY:${escapeIcs(args.title)}`,
    args.description ? `DESCRIPTION:${escapeIcs(args.description)}` : "",
    args.location ? `LOCATION:${escapeIcs(args.location)}` : "",
    args.url ? `URL:${args.url}` : "",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcs(args.title)} starts in 1 hour`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

export function googleCalendarUrl(args: IcsArgs): string {
  const dates =
    toIcsDate(args.starts_at).replace(/[-:]/g, "") +
    "/" +
    toIcsDate(args.ends_at).replace(/[-:]/g, "");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: args.title,
    dates,
    details: args.description || "",
    location: args.location || "",
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
