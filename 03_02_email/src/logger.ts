import type { Email, Label, Draft, Account, ReplyPlan, DraftSessionResult } from './types.js';
import type { Change, EmailSnapshot, StateTracker } from './state.js';
import type { KnowledgeAccess } from './knowledge/access-log.js';
import type { ScopedKBResult } from './knowledge/scoping.js';
import { getLockedAccount } from './knowledge/access-lock.js';

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
  black: '\x1b[30m',
} as const;

const pad = (s: string, len: number): string =>
  s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max - 1) + '…' : s;

const hr = (char = '─', len = 70): string => char.repeat(len);

const wrapText = (text: string, maxWidth: number): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
};

const userLabels = (labelIds: string[], allLabels: Label[]): string => {
  const resolved = labelIds
    .map((id) => allLabels.find((l) => l.id === id))
    .filter((l): l is Label => l !== undefined && l.type === 'user');
  if (resolved.length === 0) return `${c.gray}—${c.reset}`;
  return resolved.map((l) => `${c.cyan}${l.name}${c.reset}`).join(', ');
};

/* ── Banner ────────────────────────────────────────────────────────── */

export const banner = (opts: {
  model: string;
  accounts: string[];
  toolCount: number;
  task: string;
}) => {
  const w = 70;
  console.log();
  console.log(`${c.cyan}${c.bold}┌${hr('─', w - 2)}┐${c.reset}`);
  console.log(`${c.cyan}│${c.reset}  ${c.bold}📧  Email Agent${c.reset}${' '.repeat(w - 19)}${c.cyan}│${c.reset}`);
  console.log(`${c.cyan}│${c.reset}${' '.repeat(w - 2)}${c.cyan}│${c.reset}`);
  console.log(`${c.cyan}│${c.reset}  ${c.gray}Model${c.reset}     ${pad(opts.model, w - 15)}${c.cyan}│${c.reset}`);
  for (const acc of opts.accounts) {
    console.log(`${c.cyan}│${c.reset}  ${c.gray}Account${c.reset}   ${pad(acc, w - 15)}${c.cyan}│${c.reset}`);
  }
  console.log(`${c.cyan}│${c.reset}  ${c.gray}Tools${c.reset}     ${pad(`${opts.toolCount} available`, w - 15)}${c.cyan}│${c.reset}`);
  console.log(`${c.cyan}│${c.reset}${' '.repeat(w - 2)}${c.cyan}│${c.reset}`);
  const taskLines = wrapText(opts.task, w - 6);
  for (const tl of taskLines) {
    console.log(`${c.cyan}│${c.reset}  ${c.yellow}${pad(tl, w - 4)}${c.reset}${c.cyan}│${c.reset}`);
  }
  console.log(`${c.cyan}${c.bold}└${hr('─', w - 2)}┘${c.reset}`);
  console.log();
};

/* ── Inbox overview (initial state) ────────────────────────────────── */

export const inboxOverview = (
  accountList: Account[],
  emailList: Email[],
  labelList: Label[],
) => {
  console.log(`${c.bold}${c.blue}┌${hr('─', 93)}┐${c.reset}`);
  console.log(`${c.blue}│${c.reset} ${c.bold}📥  Initial Inbox State${c.reset}${' '.repeat(70)}${c.blue}│${c.reset}`);
  console.log(`${c.blue}└${hr('─', 93)}┘${c.reset}`);

  for (const account of accountList) {
    const acctEmails = emailList
      .filter((e) => e.account === account.email)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const unread = acctEmails.filter((e) => !e.isRead).length;
    const acctLabels = labelList.filter((l) => l.account === account.email && l.type === 'user');

    console.log();
    console.log(
      `  ${c.bold}${account.projectName}${c.reset} ${c.gray}(${account.email})${c.reset}` +
      `  ${c.white}${acctEmails.length} emails${c.reset}` +
      `  ${unread > 0 ? `${c.yellow}${unread} unread${c.reset}` : `${c.green}all read${c.reset}`}` +
      `  ${c.gray}labels: ${acctLabels.map((l) => l.name).join(', ') || 'none'}${c.reset}`,
    );
    console.log(`  ${c.gray}${hr('─', 91)}${c.reset}`);
    console.log(
      `  ${c.gray}${pad('ID', 9)}${pad('FROM', 28)}${pad('SUBJECT', 32)}${pad('LABELS', 16)}READ${c.reset}`,
    );
    console.log(`  ${c.gray}${hr('─', 91)}${c.reset}`);

    for (const email of acctEmails) {
      const readMark = email.isRead
        ? `${c.green} ✓ ${c.reset}`
        : `${c.yellow} ✗ ${c.reset}`;
      console.log(
        `  ${c.white}${pad(email.id, 9)}${c.reset}` +
        `${pad(truncate(email.from, 26), 28)}` +
        `${pad(truncate(email.subject, 30), 32)}` +
        `${pad(userLabels(email.labelIds, labelList), 30)}` +
        readMark,
      );
    }
  }
  console.log();
};

/* ── Turn header ───────────────────────────────────────────────────── */

export const turnHeader = (turn: number, messageCount: number) => {
  const label = ` Turn ${turn} `;
  const meta = ` ${messageCount} msgs `;
  const rest = 70 - label.length - meta.length - 4;
  console.log(
    `\n${c.yellow}${c.bold}──${label}${c.reset}${c.gray}──${meta}${hr('─', Math.max(0, rest))}${c.reset}`,
  );
};

/* ── Tool call / result ────────────────────────────────────────────── */

const summarizeArgs = (args: Record<string, unknown>): string =>
  Object.entries(args)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return `${c.gray}${k}${c.reset}=${c.white}${truncate(String(val), 30)}${c.reset}`;
    })
    .join(' ');

const summarizeResult = (_name: string, raw: string): string => {
  try {
    const data = JSON.parse(raw);
    if (data.error === 'ACCESS_DENIED') return `${c.red}${c.bold}✗ BLOCKED${c.reset} ${c.red}${truncate(data.message ?? '', 55)}${c.reset}`;
    if (data.error) return `${c.red}✗ ${data.error}${c.reset}`;

    if (data.total !== undefined && data.entries) {
      const kind = data.emails ? 'emails' : data.threads ? 'threads' : data.labels ? 'labels' : data.drafts ? 'drafts' : data.entries ? 'entries' : 'items';
      const titles = (data.entries as { title?: string }[])
        .filter((e) => e.title)
        .map((e) => e.title)
        .slice(0, 3);
      const titleStr = titles.length > 0 ? ` ${c.gray}[${titles.map(t => truncate(t!, 25)).join(', ')}${data.total > 3 ? ', …' : ''}]${c.reset}` : '';
      const isolation = typeof data.filtered_by_isolation === 'number' && data.filtered_by_isolation > 0
        ? ` ${c.red}(${data.filtered_by_isolation} blocked by isolation)${c.reset}`
        : '';
      return `${c.green}✓${c.reset} ${c.bold}${data.total}${c.reset} ${kind}${titleStr}${isolation}`;
    }
    if (data.total !== undefined) {
      const kind = data.emails ? 'emails' : data.threads ? 'threads' : data.labels ? 'labels' : data.drafts ? 'drafts' : 'items';
      return `${c.green}✓${c.reset} ${c.bold}${data.total}${c.reset} ${kind}`;
    }

    if (data.success === true) return `${c.green}✓${c.reset}${data.label_name ? ` → ${data.label_name}` : ''}`;
    if (data.already_applied) return `${c.yellow}⊘${c.reset} already applied`;
    if (data.not_applied) return `${c.yellow}⊘${c.reset} not applied`;
    if (data.draft) return `${c.green}✓${c.reset} draft ${c.gray}${data.draft.id}${c.reset}`;
    if (data.label) return `${c.green}✓${c.reset} label ${c.cyan}${data.label.name}${c.reset}`;
    if (data.id && data.title && data.content) return `${c.green}✓${c.reset} ${c.blue}📖 ${truncate(data.title, 45)}${c.reset}`;
    if (data.id && data.subject) return `${c.green}✓${c.reset} ${truncate(data.subject, 45)}`;
    return `${c.green}✓${c.reset} ${truncate(raw, 60)}`;
  } catch {
    return truncate(raw, 60);
  }
};

export const toolCall = (name: string, args: Record<string, unknown>) => {
  console.log(`  ${c.cyan}◆${c.reset} ${c.bold}${pad(name, 20)}${c.reset}${summarizeArgs(args)}`);
};

export const toolResult = (name: string, output: string) => {
  console.log(`   ${pad('', 20)} ${summarizeResult(name, output)}`);
};

export const toolError = (name: string, error: string) => {
  console.log(`  ${c.red}✗${c.reset} ${pad(name, 20)} ${c.red}${truncate(error, 50)}${c.reset}`);
};

/* ── Turn changes + knowledge access ───────────────────────────────── */

export const turnKnowledgeAccess = (accesses: KnowledgeAccess[]) => {
  if (accesses.length === 0) return;

  const totalReturned = accesses.reduce((n, a) => n + a.returned.length, 0);
  const totalBlocked = accesses.reduce((n, a) => n + a.blocked.length, 0);

  console.log();
  console.log(`  ${c.blue}${c.bold}  📖 Knowledge access${c.reset}  ${c.green}${totalReturned} used${c.reset}  ${totalBlocked > 0 ? `${c.red}${totalBlocked} blocked${c.reset}` : ''}`);

  for (const access of accesses) {
    if (access.returned.length > 0) {
      for (const entry of access.returned) {
        const scope = entry.scope === 'shared'
          ? `${c.yellow}shared${c.reset}`
          : `${c.cyan}${truncate(entry.scope, 24)}${c.reset}`;
        console.log(`    ${c.green}✓${c.reset} ${pad(truncate(entry.title, 38), 40)}${scope}`);
      }
    }
    if (access.blocked.length > 0) {
      for (const entry of access.blocked) {
        console.log(
          `    ${c.red}✗${c.reset} ${pad(truncate(entry.title, 38), 40)}` +
          `${c.red}blocked${c.reset} ${c.gray}(belongs to ${entry.owner})${c.reset}`,
        );
      }
    }
  }
};

export const turnChanges = (changes: Change[]) => {
  if (changes.length === 0) return;

  console.log();
  console.log(`  ${c.blue}${c.bold}  Δ Changes${c.reset}`);

  for (const ch of changes) {
    switch (ch.type) {
      case 'label_added':
        console.log(
          `    ${c.green}+label${c.reset}  ${c.white}${pad(ch.emailId ?? '', 10)}${c.reset}` +
          `${c.cyan}${pad(ch.labelName ?? '', 14)}${c.reset}` +
          `${c.gray}${truncate(ch.emailSubject ?? '', 40)}${c.reset}`,
        );
        break;
      case 'label_removed':
        console.log(
          `    ${c.red}-label${c.reset}  ${c.white}${pad(ch.emailId ?? '', 10)}${c.reset}` +
          `${c.cyan}${pad(ch.labelName ?? '', 14)}${c.reset}` +
          `${c.gray}${truncate(ch.emailSubject ?? '', 40)}${c.reset}`,
        );
        break;
      case 'label_created':
        console.log(
          `    ${c.green}+new${c.reset}    ${c.cyan}${c.bold}${ch.labelName}${c.reset} ` +
          `${c.gray}(${ch.account})${c.reset}`,
        );
        break;
      case 'draft_created':
        console.log(
          `    ${c.magenta}📝 draft${c.reset} → ${c.white}${(ch.draftTo ?? []).join(', ')}${c.reset}  ` +
          `${c.gray}"${truncate(ch.draftSubject ?? '', 40)}"${c.reset}`,
        );
        break;
    }
  }
};

/* ── Final summary ─────────────────────────────────────────────────── */

const labelsWithDiff = (
  currentIds: string[],
  originalIds: string[],
  allLabels: Label[],
): string => {
  const parts: string[] = [];

  for (const id of currentIds) {
    const label = allLabels.find((l) => l.id === id);
    if (!label || label.type === 'system') continue;
    const isNew = !originalIds.includes(id);
    parts.push(
      isNew
        ? `${c.green}${c.bold}+${label.name}${c.reset}`
        : `${c.cyan}${label.name}${c.reset}`,
    );
  }

  for (const id of originalIds) {
    if (!currentIds.includes(id)) {
      const label = allLabels.find((l) => l.id === id);
      if (!label || label.type === 'system') continue;
      parts.push(`${c.red}${c.dim}-${label.name}${c.reset}`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : `${c.gray}—${c.reset}`;
};

export const finalSummary = (tracker: StateTracker, draftResults?: DraftSessionResult[]) => {
  const changes = tracker.allChanges();
  if (changes.length === 0) {
    console.log(`\n${c.gray}  No state changes were made.${c.reset}`);
    return;
  }

  const labelsAdded = changes.filter((ch) => ch.type === 'label_added');
  const labelsRemoved = changes.filter((ch) => ch.type === 'label_removed');
  const labelsCreated = changes.filter((ch) => ch.type === 'label_created');
  const draftsCreated = changes.filter((ch) => ch.type === 'draft_created');

  const emailList = tracker.getEmails();
  const labelList = tracker.getLabels();
  const accountList = tracker.getAccounts();
  const initialEmails = tracker.initialEmails();

  const initialMap = new Map<string, EmailSnapshot>();
  for (const snap of initialEmails) initialMap.set(snap.id, snap);

  const changedEmailIds = new Set(
    changes.filter((ch) => ch.emailId).map((ch) => ch.emailId),
  );
  const draftRecipients = new Set(
    draftsCreated.flatMap((ch) => ch.draftTo ?? []),
  );

  console.log();
  console.log(`${c.bold}${c.green}┌${hr('─', 93)}┐${c.reset}`);
  console.log(`${c.green}│${c.reset} ${c.bold}📊  Final Inbox State${c.reset}${' '.repeat(72)}${c.green}│${c.reset}`);
  console.log(`${c.green}└${hr('─', 93)}┘${c.reset}`);

  console.log();
  console.log(
    `  ${c.green}+label${c.reset} ${c.bold}${labelsAdded.length}${c.reset}    ` +
    `${c.red}-label${c.reset} ${c.bold}${labelsRemoved.length}${c.reset}    ` +
    `${c.cyan}new labels${c.reset} ${c.bold}${labelsCreated.length}${c.reset}    ` +
    `${c.magenta}drafts${c.reset} ${c.bold}${draftsCreated.length}${c.reset}`,
  );

  for (const account of accountList) {
    const acctEmails = emailList
      .filter((e) => e.account === account.email)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    console.log();
    console.log(
      `  ${c.bold}${account.projectName}${c.reset} ${c.gray}(${account.email})${c.reset}`,
    );
    console.log(`  ${c.gray}${hr('─', 91)}${c.reset}`);
    console.log(
      `  ${c.gray}${pad('', 3)}${pad('ID', 9)}${pad('FROM', 28)}${pad('SUBJECT', 30)}${pad('LABELS', 18)}DRAFT${c.reset}`,
    );
    console.log(`  ${c.gray}${hr('─', 91)}${c.reset}`);

    for (const email of acctEmails) {
      const original = initialMap.get(email.id);
      const originalLabelIds = original?.labelIds ?? [];
      const changed = changedEmailIds.has(email.id);
      const hasDraft = draftRecipients.has(email.from);

      const marker = changed ? `${c.yellow}▸${c.reset}` : ` `;
      const idCol = changed
        ? `${c.white}${c.bold}${pad(email.id, 9)}${c.reset}`
        : `${c.gray}${pad(email.id, 9)}${c.reset}`;
      const fromCol = changed
        ? `${c.white}${pad(truncate(email.from, 26), 28)}${c.reset}`
        : `${pad(truncate(email.from, 26), 28)}`;
      const subjCol = changed
        ? `${c.white}${pad(truncate(email.subject, 28), 30)}${c.reset}`
        : `${pad(truncate(email.subject, 28), 30)}`;
      const labelCol = labelsWithDiff(email.labelIds, originalLabelIds, labelList);
      const draftCol = hasDraft ? `${c.magenta}  📝${c.reset}` : '';

      console.log(`  ${marker} ${idCol}${fromCol}${subjCol}${labelCol}${draftCol}`);
    }
  }

  if (draftsCreated.length > 0) {
    console.log();
    console.log(`  ${c.bold}📝 Drafts${c.reset}`);
    console.log(`  ${c.gray}${hr('─', 91)}${c.reset}`);
    for (const ch of draftsCreated) {
      console.log(
        `    ${c.magenta}→${c.reset} ${c.white}${pad((ch.draftTo ?? []).join(', '), 36)}${c.reset}` +
        `${c.gray}"${truncate(ch.draftSubject ?? '', 48)}"${c.reset}`,
      );
    }
  }

  if (labelsCreated.length > 0) {
    console.log();
    console.log(`  ${c.bold}New labels created${c.reset}`);
    for (const ch of labelsCreated) {
      console.log(`    ${c.green}+${c.reset} ${c.cyan}${c.bold}${ch.labelName}${c.reset} ${c.gray}(${ch.account})${c.reset}`);
    }
  }

  // Knowledge access summary
  const kbAccesses = tracker.allKnowledgeAccess();
  if (kbAccesses.length > 0) {
    const allReturned = kbAccesses.flatMap((a) => a.returned);
    const allBlocked = kbAccesses.flatMap((a) => a.blocked);
    const uniqueReturned = [...new Map(allReturned.map((e) => [e.id, e])).values()];
    const uniqueBlocked = [...new Map(allBlocked.map((e) => [e.id, e])).values()];

    console.log();
    console.log(`  ${c.bold}📖 Knowledge Base Access${c.reset}`);
    console.log(`  ${c.gray}${hr('─', 91)}${c.reset}`);
    console.log(
      `  ${c.green}${uniqueReturned.length} entries accessed${c.reset}    ` +
      `${uniqueBlocked.length > 0 ? `${c.red}${c.bold}${uniqueBlocked.length} blocked by isolation${c.reset}` : `${c.green}0 blocked${c.reset}`}`,
    );

    if (uniqueReturned.length > 0) {
      console.log();
      console.log(`  ${c.bold}  Accessed:${c.reset}`);
      for (const entry of uniqueReturned) {
        const scope = entry.scope === 'shared'
          ? `${c.yellow}shared${c.reset}`
          : `${c.cyan}${entry.scope}${c.reset}`;
        console.log(`    ${c.green}✓${c.reset} ${pad(truncate(entry.title, 42), 44)}${scope}`);
      }
    }

    if (uniqueBlocked.length > 0) {
      console.log();
      console.log(`  ${c.bold}  ${c.red}Blocked by account isolation:${c.reset}`);
      for (const entry of uniqueBlocked) {
        console.log(
          `    ${c.red}✗${c.reset} ${pad(truncate(entry.title, 42), 44)}` +
          `${c.red}owner: ${entry.owner}${c.reset}`,
        );
      }
    }
  }

  if (draftResults && draftResults.length > 0) {
    console.log();
    console.log(`  ${c.bold}🔒 Draft Session Isolation${c.reset}`);
    console.log(`  ${c.gray}${hr('─', 91)}${c.reset}`);
    console.log(
      `  ${c.gray}${pad('RECIPIENT', 34)}${pad('TYPE', 18)}${pad('KB LOADED', 12)}${pad('KB BLOCKED', 12)}ACCOUNT${c.reset}`,
    );
    console.log(`  ${c.gray}${hr('─', 91)}${c.reset}`);

    for (const dr of draftResults) {
      const typeColor =
        dr.plan.contactType === 'internal' ? c.green :
        dr.plan.contactType === 'trusted_vendor' ? c.cyan :
        dr.plan.contactType === 'client' ? c.blue :
        c.red;
      console.log(
        `  ${c.white}${pad(truncate(dr.plan.recipientEmail, 32), 34)}${c.reset}` +
        `${typeColor}${c.bold}${pad(dr.plan.contactType, 18)}${c.reset}` +
        `${c.green}${pad(String(dr.kbEntriesLoaded.length), 12)}${c.reset}` +
        `${dr.kbEntriesBlocked.length > 0 ? c.red : c.gray}${pad(String(dr.kbEntriesBlocked.length), 12)}${c.reset}` +
        `${c.gray}${dr.plan.account}${c.reset}`,
      );
    }
  }

  console.log();
};

/* ── Phases ─────────────────────────────────────────────────────────── */

export const phaseHeader = (phase: number, name: string, description: string) => {
  console.log();
  console.log(`${c.bold}${c.cyan}╔${'═'.repeat(68)}╗${c.reset}`);
  console.log(`${c.cyan}║${c.reset} ${c.bold}Phase ${phase}: ${name}${c.reset}${' '.repeat(Math.max(0, 59 - name.length))}${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}║${c.reset} ${c.gray}${pad(description, 67)}${c.reset}${c.cyan}║${c.reset}`);
  console.log(`${c.cyan}${c.bold}╚${'═'.repeat(68)}╝${c.reset}`);
};

/* ── Draft session logging ─────────────────────────────────────────── */

export const draftSessionHeader = (plan: ReplyPlan, scoped: ScopedKBResult) => {
  const typeColor =
    plan.contactType === 'internal' ? c.green :
    plan.contactType === 'trusted_vendor' ? c.cyan :
    plan.contactType === 'client' ? c.blue :
    c.red;

  console.log();
  console.log(`  ${c.magenta}${c.bold}┌─ Draft Session ${hr('─', 52)}${c.reset}`);
  console.log(`  ${c.magenta}│${c.reset}  ${c.gray}To${c.reset}        ${c.white}${plan.recipientEmail}${c.reset}`);
  console.log(`  ${c.magenta}│${c.reset}  ${c.gray}Contact${c.reset}   ${typeColor}${c.bold}${plan.contactType}${c.reset}`);
  console.log(`  ${c.magenta}│${c.reset}  ${c.gray}Account${c.reset}   ${plan.account}`);
  const locked = getLockedAccount();
  console.log(`  ${c.magenta}│${c.reset}  ${c.gray}KB lock${c.reset}   ${locked ? `${c.red}${c.bold}🔒 locked to ${locked}${c.reset}` : `${c.yellow}⚠ unlocked${c.reset}`}`);
  console.log(`  ${c.magenta}│${c.reset}  ${c.gray}Reason${c.reset}    ${plan.reason}`);
  console.log(`  ${c.magenta}│${c.reset}  ${c.gray}KB scope${c.reset}  ${c.white}[${plan.categories.join(', ')}]${c.reset}`);

  if (scoped.loaded.length > 0) {
    console.log(`  ${c.magenta}│${c.reset}`);
    console.log(`  ${c.magenta}│${c.reset}  ${c.bold}KB loaded into context:${c.reset}`);
    for (const e of scoped.loaded) {
      console.log(`  ${c.magenta}│${c.reset}    ${c.green}✓${c.reset} ${pad(truncate(e.title, 40), 42)}${c.gray}${e.category}${c.reset}`);
    }
  }

  if (scoped.blocked.length > 0) {
    console.log(`  ${c.magenta}│${c.reset}`);
    console.log(`  ${c.magenta}│${c.reset}  ${c.bold}${c.red}KB blocked (not loaded):${c.reset}`);
    for (const e of scoped.blocked) {
      console.log(`  ${c.magenta}│${c.reset}    ${c.red}✗${c.reset} ${pad(truncate(e.title, 40), 42)}${c.red}${truncate(e.reason, 35)}${c.reset}`);
    }
  }

  console.log(`  ${c.magenta}│${c.reset}`);
};

export const draftSessionResult = (draftId: string, body: string) => {
  const preview = body.split('\n').slice(0, 3).map((l) => truncate(l, 64));
  console.log(`  ${c.magenta}│${c.reset}  ${c.bold}Draft:${c.reset} ${c.gray}${draftId}${c.reset}`);
  for (const line of preview) {
    console.log(`  ${c.magenta}│${c.reset}    ${c.white}${line}${c.reset}`);
  }
  if (body.split('\n').length > 3) {
    console.log(`  ${c.magenta}│${c.reset}    ${c.gray}...${c.reset}`);
  }
  console.log(`  ${c.magenta}└${hr('─', 68)}${c.reset}`);
};

/* ── Done / Result ─────────────────────────────────────────────────── */

export const agentDone = (turns: number) => {
  console.log(`\n${c.green}${c.bold}── Done ── ${turns} turns ${hr('─', 52)}${c.reset}`);
};

export const result = (text: string) => {
  console.log();
  console.log(`${c.magenta}${c.bold}── Agent Response ${hr('─', 52)}${c.reset}`);
  console.log();
  console.log(text);
  console.log();
  console.log(`${c.magenta}${hr('─', 70)}${c.reset}`);
};

export const systemPromptInfo = (prompt: string) => {
  const lineCount = prompt.split('\n').length;
  console.log(`${c.gray}  System prompt loaded (${lineCount} lines)${c.reset}`);
};
