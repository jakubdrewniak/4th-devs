const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const;

const L = `${c.blue}│${c.reset}`;
const INDENT = `${L}     `;

const pad = (s: string, len: number): string =>
  s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max - 1) + '…' : s;

const hr = (char = '─', len = 72): string => char.repeat(len);

/* ── Banner ─────────────────────────────────────────────────────────── */

export const banner = (model: string, toolCount: number) => {
  console.log();
  console.log(`${c.cyan}${c.bold}┌${hr('─')}┐${c.reset}`);
  console.log(`${c.cyan}│${c.reset}  ${c.bold}📅  Calendar Agent${c.reset}${' '.repeat(52)}${c.cyan}│${c.reset}`);
  console.log(`${c.cyan}│${c.reset}${' '.repeat(72)}${c.cyan}│${c.reset}`);
  console.log(`${c.cyan}│${c.reset}  ${c.gray}Model${c.reset}    ${pad(model, 61)}${c.cyan}│${c.reset}`);
  console.log(`${c.cyan}│${c.reset}  ${c.gray}Tools${c.reset}    ${pad(`${toolCount} available`, 61)}${c.cyan}│${c.reset}`);
  console.log(`${c.cyan}${c.bold}└${hr('─')}┘${c.reset}`);
  console.log();
};

/* ── Phase header ───────────────────────────────────────────────────── */

export const phaseHeader = (phase: number, name: string, detail: string) => {
  console.log();
  console.log(`${c.bold}${c.cyan}╔${'═'.repeat(72)}╗${c.reset}`);
  console.log(`${c.cyan}║${c.reset} ${c.bold}Phase ${phase}: ${name}${c.reset}${' '.repeat(Math.max(0, 63 - name.length))}${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}║${c.reset} ${c.gray}${pad(detail, 71)}${c.reset}${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}${c.bold}╚${'═'.repeat(72)}╝${c.reset}`);
};

/* ── Step header ────────────────────────────────────────────────────── */

export const stepHeader = (id: string, label: string) => {
  console.log();
  console.log(`${c.blue}${c.bold}┌─ ${id} ${hr('─', 65 - id.length)}${c.reset}`);
  console.log(`${L} ${c.white}${truncate(label, 70)}${c.reset}`);
  console.log(L);
};

/* ── Metadata block ─────────────────────────────────────────────────── */

export const metadata = (meta: string) => {
  for (const line of meta.split('\n')) {
    if (line.startsWith('<') && line.endsWith('>')) {
      console.log(`${L}   ${c.dim}${line}${c.reset}`);
    } else {
      console.log(`${L}   ${c.yellow}${line}${c.reset}`);
    }
  }
  console.log(L);
};

/* ── Turn ────────────────────────────────────────────────────────────── */

export const turnHeader = (turn: number) => {
  console.log(`${L} ${c.yellow}${c.bold}⟳ Turn ${turn}${c.reset}`);
};

/* ── Tool call ──────────────────────────────────────────────────────── */

const formatArgs = (args: Record<string, unknown>): string =>
  Object.entries(args)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return `${c.gray}${k}${c.reset}=${c.white}${truncate(String(val), 30)}${c.reset}`;
    })
    .join(' ');

export const toolCall = (name: string, args: Record<string, unknown>) => {
  console.log(`${L}   ${c.cyan}◆${c.reset} ${c.bold}${name}${c.reset}  ${formatArgs(args)}`);
};

export const toolError = (name: string, error: string) => {
  console.log(`${L}   ${c.red}✗ ${c.bold}${name}${c.reset}  ${c.red}${truncate(error, 50)}${c.reset}`);
};

/* ── Tool result (rich) ─────────────────────────────────────────────── */

interface ContactSummary { name: string; email: string; relationship: string; company?: string; role?: string; preferences?: string[] }
interface PlaceSummary { name: string; type: string; address: string; tags: string[]; id: string; description: string; openingHours?: Record<string, string> }
interface EventSummary { id: string; title: string; start: string; end: string; locationName?: string; isVirtual: boolean; guests: { name: string; email: string }[]; description?: string; meetingLink?: string }
interface RouteSummary { from: { name: string }; to: { name: string }; options: { walking: { durationMin: number }; driving: { durationMin: number }; transit?: { durationMin: number; line: string; stops: number } }; fastest_mode: string; fastest_duration_min: number }
interface NotifSummary { id: string; title: string; message: string; channel: string }
interface SearchResultSummary { title: string; snippet: string }

const printContactMatch = (contact: ContactSummary) => {
  const role = [contact.role, contact.company].filter(Boolean).join(' @ ');
  console.log(`${INDENT}  ${c.green}✓ matched person${c.reset}  ${c.bold}${contact.name}${c.reset}  ${c.gray}<${contact.email}>${c.reset}`);
  if (role) console.log(`${INDENT}    ${c.gray}${contact.relationship}${c.reset} · ${c.white}${role}${c.reset}`);
  if (contact.preferences?.length) {
    console.log(`${INDENT}    ${c.yellow}preferences:${c.reset} ${contact.preferences.slice(0, 4).join(', ')}`);
  }
};

const printPlaceMatch = (place: PlaceSummary) => {
  console.log(`${INDENT}  ${c.green}✓ matched place${c.reset}   ${c.bold}${place.name}${c.reset}  ${c.gray}(${place.type})${c.reset}`);
  console.log(`${INDENT}    ${c.white}${place.address}${c.reset}`);
  console.log(`${INDENT}    ${c.gray}${truncate(place.description, 65)}${c.reset}`);
};

const printEventCreated = (event: EventSummary) => {
  const when = `${event.start.slice(0, 16).replace('T', ' ')} → ${event.end.slice(11, 16)}`;
  console.log(`${INDENT}  ${c.green}${c.bold}✓ EVENT CREATED${c.reset}  ${c.bold}${event.title}${c.reset}  ${c.gray}[${event.id}]${c.reset}`);
  console.log(`${INDENT}    ${c.yellow}when${c.reset}      ${when}`);
  const loc = event.isVirtual ? `${c.magenta}virtual${c.reset}` : event.locationName ? `${c.cyan}${event.locationName}${c.reset}` : `${c.gray}—${c.reset}`;
  console.log(`${INDENT}    ${c.yellow}where${c.reset}     ${loc}`);
  if (event.guests.length > 0) {
    console.log(`${INDENT}    ${c.yellow}guests${c.reset}    ${event.guests.map((g) => `${c.white}${g.name}${c.reset} ${c.gray}<${g.email}>${c.reset}`).join(', ')}`);
  }
  if (event.description) {
    console.log(`${INDENT}    ${c.yellow}desc${c.reset}      ${c.gray}${truncate(event.description, 60)}${c.reset}`);
  }
  if (event.meetingLink) {
    console.log(`${INDENT}    ${c.yellow}link${c.reset}      ${c.cyan}${event.meetingLink}${c.reset}`);
  }
};

const printEventFound = (event: EventSummary, confidence?: number) => {
  const when = `${event.start.slice(0, 16).replace('T', ' ')} → ${event.end.slice(11, 16)}`;
  const conf = confidence !== undefined ? ` ${c.gray}(confidence: ${confidence})${c.reset}` : '';
  console.log(`${INDENT}  ${c.green}✓ found event${c.reset}     ${c.bold}${event.title}${c.reset}  ${c.gray}[${event.id}]${c.reset}${conf}`);
  console.log(`${INDENT}    ${c.yellow}when${c.reset}  ${when}  ${c.yellow}where${c.reset}  ${event.isVirtual ? `${c.magenta}virtual${c.reset}` : event.locationName ?? '—'}`);
};

const printRoute = (route: RouteSummary) => {
  console.log(`${INDENT}  ${c.green}✓ route${c.reset}  ${c.bold}${route.from.name}${c.reset} ${c.gray}→${c.reset} ${c.bold}${route.to.name}${c.reset}`);
  const w = route.options.walking;
  const d = route.options.driving;
  const t = route.options.transit;
  console.log(`${INDENT}    ${c.white}🚶 ${w.durationMin} min${c.reset}  ${c.white}🚗 ${d.durationMin} min${c.reset}${t ? `  ${c.white}🚋 ${t.durationMin} min${c.reset} ${c.gray}(${t.line}, ${t.stops} stops)${c.reset}` : ''}`);
  console.log(`${INDENT}    ${c.yellow}fastest: ${route.fastest_mode} (${route.fastest_duration_min} min)${c.reset}`);
};

const printNotificationSent = (notif: NotifSummary) => {
  console.log(`${INDENT}  ${c.green}${c.bold}✓ NOTIFICATION SENT${c.reset}  ${c.magenta}[${notif.channel}]${c.reset}  ${c.bold}${notif.title}${c.reset}`);
  console.log(`${INDENT}    ${c.white}${truncate(notif.message, 68)}${c.reset}`);
};

const printSearchResults = (results: SearchResultSummary[]) => {
  console.log(`${INDENT}  ${c.green}✓${c.reset} ${c.bold}${results.length}${c.reset} web results`);
  for (const r of results.slice(0, 3)) {
    console.log(`${INDENT}    ${c.cyan}▸${c.reset} ${c.white}${truncate(r.title, 50)}${c.reset}`);
    console.log(`${INDENT}      ${c.gray}${truncate(r.snippet, 65)}${c.reset}`);
  }
};

export const toolResult = (_name: string, output: string) => {
  try {
    const data = JSON.parse(output);

    if (data.error) {
      console.log(`${INDENT}  ${c.red}✗ ${truncate(String(data.error), 60)}${c.reset}`);
      return;
    }

    if (data.created === true && data.event) {
      printEventCreated(data.event);
      return;
    }

    if (data.event && data.candidates !== undefined) {
      printEventFound(data.event, data.confidence);
      return;
    }

    if (data.sent === true && data.notification) {
      printNotificationSent(data.notification);
      return;
    }

    if (data.from && data.to && data.options) {
      printRoute(data);
      return;
    }

    if (data.contacts && Array.isArray(data.contacts)) {
      for (const contact of data.contacts) printContactMatch(contact);
      return;
    }

    if (data.places && Array.isArray(data.places)) {
      for (const place of data.places.slice(0, 2)) printPlaceMatch(place);
      if (data.places.length > 2) {
        console.log(`${INDENT}  ${c.gray}… and ${data.places.length - 2} more${c.reset}`);
      }
      return;
    }

    if (data.results && Array.isArray(data.results)) {
      printSearchResults(data.results);
      return;
    }

    if (data.events && Array.isArray(data.events)) {
      console.log(`${INDENT}  ${c.green}✓${c.reset} ${c.bold}${data.total}${c.reset} calendar events`);
      for (const evt of (data.events as EventSummary[]).slice(0, 3)) {
        const when = evt.start.slice(0, 16).replace('T', ' ');
        console.log(`${INDENT}    ${c.gray}${evt.id}${c.reset} ${c.white}${truncate(evt.title, 30)}${c.reset} ${c.yellow}${when}${c.reset}`);
      }
      return;
    }

    if (data.notifications && Array.isArray(data.notifications)) {
      console.log(`${INDENT}  ${c.green}✓${c.reset} ${c.bold}${data.total}${c.reset} notifications`);
      return;
    }

    console.log(`${INDENT}  ${c.green}✓${c.reset} ${truncate(output, 60)}`);
  } catch {
    console.log(`${INDENT}  ${truncate(output, 60)}`);
  }
};

/* ── Step result ────────────────────────────────────────────────────── */

export const stepResult = (response: string, turns: number, toolCalls: number) => {
  console.log(L);
  console.log(`${L} ${c.green}${c.bold}✔${c.reset} ${c.white}${truncate(response, 68)}${c.reset}`);
  console.log(`${L} ${c.gray}${turns} turns, ${toolCalls} tool calls${c.reset}`);
  console.log(`${c.blue}└${hr('─')}${c.reset}`);
};

/* ── Final summary tables ───────────────────────────────────────────── */

export const eventTable = (events: { id: string; title: string; start: string; end: string; isVirtual: boolean; locationName?: string }[]) => {
  console.log();
  console.log(`${c.bold}${c.green}┌${hr('─')}┐${c.reset}`);
  console.log(`${c.green}│${c.reset} ${c.bold}📅  Calendar — ${events.length} events${c.reset}${' '.repeat(Math.max(0, 53 - String(events.length).length))}${c.green}│${c.reset}`);
  console.log(`${c.green}└${hr('─')}┘${c.reset}`);
  console.log();
  console.log(`  ${c.gray}${pad('ID', 16)}${pad('TITLE', 36)}${pad('WHEN', 28)}LOCATION${c.reset}`);
  console.log(`  ${c.gray}${hr('─', 96)}${c.reset}`);

  for (const evt of events) {
    const when = evt.start.replace(/T/, ' ').slice(0, 16);
    const loc = evt.isVirtual
      ? `${c.magenta}virtual${c.reset}`
      : evt.locationName
        ? `${c.cyan}${truncate(evt.locationName, 22)}${c.reset}`
        : `${c.gray}—${c.reset}`;

    console.log(
      `  ${c.white}${pad(evt.id, 16)}${c.reset}` +
      `${pad(truncate(evt.title, 34), 36)}` +
      `${c.yellow}${pad(when, 28)}${c.reset}` +
      loc,
    );
  }
};

export const notificationTable = (notifications: { id: string; createdAt: string; channel: string; title: string; message: string }[]) => {
  console.log();
  console.log(`${c.bold}${c.magenta}┌${hr('─')}┐${c.reset}`);
  console.log(`${c.magenta}│${c.reset} ${c.bold}🔔  Notifications — ${notifications.length} sent${c.reset}${' '.repeat(Math.max(0, 49 - String(notifications.length).length))}${c.magenta}│${c.reset}`);
  console.log(`${c.magenta}└${hr('─')}┘${c.reset}`);
  console.log();

  for (const n of notifications) {
    const when = n.createdAt.replace(/T/, ' ').slice(0, 16);
    console.log(`  ${c.yellow}${when}${c.reset}  ${c.bold}${n.title}${c.reset}`);
    console.log(`  ${' '.repeat(17)}${c.white}${truncate(n.message, 72)}${c.reset}`);
    console.log();
  }
};

export const done = () => {
  console.log(`${c.green}${c.bold}${hr('═')}${c.reset}`);
  console.log(`${c.green}${c.bold}  Done.${c.reset}`);
  console.log(`${c.green}${c.bold}${hr('═')}${c.reset}`);
  console.log();
};
