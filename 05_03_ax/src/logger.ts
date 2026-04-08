import type { ClassificationResult } from './classify.js';
import type { Email } from './emails.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const SEP = `${DIM}───────────────────────────────────────${RESET}`;

const LABEL_COLORS: Record<string, string> = {
  urgent: '\x1b[31m',
  client: '\x1b[34m',
  internal: '\x1b[32m',
  newsletter: '\x1b[36m',
  billing: '\x1b[33m',
  github: '\x1b[35m',
  security: '\x1b[31m',
  spam: '\x1b[90m',
  automated: '\x1b[90m',
  'needs-reply': '\x1b[33m',
};

const colorLabel = (label: string) =>
  `${LABEL_COLORS[label] ?? ''}${label}${RESET}`;

const priorityIcon = (p: string) =>
  p === 'high' ? '🔴' : p === 'medium' ? '🟡' : '🟢';

const scoreIcon = (score: number) =>
  score >= 0.8 ? '✅' : score >= 0.5 ? '🟡' : '❌';

export const logStart = (count: number) =>
  console.log(`${BOLD}Classifying ${count} emails with Ax...${RESET}\n`);

export const logEmail = (email: Email, result: ClassificationResult) => {
  console.log(SEP);
  console.log(`${BOLD}${email.subject}${RESET}`);
  console.log(`  From:     ${email.from}`);
  console.log(`  Priority: ${priorityIcon(result.priority)} ${result.priority}`);
  console.log(`  Labels:   ${result.labels.map(colorLabel).join(', ')}`);
  console.log(`  Reply:    ${result.needsReply ? 'yes' : 'no'}`);
  console.log(`  Summary:  ${result.summary}`);
};

export const logDone = () => {
  console.log(`\n${SEP}`);
  console.log(`${BOLD}Done.${RESET}`);
};

export const logDemosSource = (optimized: boolean) =>
  console.log(`${DIM}Using ${optimized ? 'optimized demos from demos.json' : 'fallback examples'}${RESET}`);

export const logTrainingStart = (count: number) =>
  console.log(`${BOLD}Training on ${count} examples...${RESET}\n`);

export const logOptimizationResult = (result: {
  bestScore: number;
  stats: { totalCalls: number; successfulDemos: number; earlyStopped: boolean };
  demosCount: number;
}) => {
  console.log(`\n${BOLD}=== Optimization Result ===${RESET}`);
  console.log(`Best score:       ${result.bestScore.toFixed(3)}`);
  console.log(`Total calls:      ${result.stats.totalCalls}`);
  console.log(`Successful demos: ${result.stats.successfulDemos}`);
  console.log(`Early stopped:    ${result.stats.earlyStopped}`);
  if (result.demosCount > 0) {
    console.log(`\nDemos saved to demos.json (${result.demosCount} entries)`);
  }
};

export const logValidationHeader = () =>
  console.log(`\n${BOLD}=== Validation ===${RESET}`);

export const logValidationRow = (
  score: number,
  subject: string,
  expected: string[],
  got: string[],
) => {
  console.log(`${scoreIcon(score)} ${score.toFixed(2)} | ${subject.slice(0, 50)}`);
  console.log(`         expected: [${expected.join(', ')}]  got: [${got.join(', ')}]`);
};

export const logValidationAvg = (avg: number) =>
  console.log(`\nAverage validation score: ${avg.toFixed(3)}`);
