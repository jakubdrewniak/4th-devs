import { existsSync, readFileSync } from 'node:fs';
import { ax } from '@ax-llm/ax';
import type { AxAIService } from '@ax-llm/ax';
import { LABELS, type Email, type Label } from './emails.js';
import { FALLBACK_EXAMPLES } from './examples.js';
import { logDemosSource } from './logger.js';

export interface ClassificationResult {
  labels: Label[];
  priority: 'high' | 'medium' | 'low';
  needsReply: boolean;
  summary: string;
}

const labelsEnum = LABELS.join(', ');

const SIGNATURE = `emailFrom:string, emailSubject:string, emailBody:string ->
   labels:string[] "pick ALL matching labels from: ${labelsEnum}",
   priority:class "high, medium, low",
   needsReply:boolean,
   summary:string "one-sentence summary of the email"`;

const DESCRIPTION = `Classify developer inbox emails. Assign ALL matching labels from the allowed set.
"urgent" = requires immediate action or time-sensitive.
"needs-reply" = sender explicitly expects a human response.
"spam" = unsolicited recruiter outreach, cold sales, or unwanted marketing.
"automated" = machine-generated notifications (CI, alerts, billing).
"github" = GitHub notifications (PRs, issues, security).
"client" = from an actual business client or partner.
"internal" = from a teammate or coworker.
"newsletter" = periodic digest or subscription.
"billing" = invoices, payments, subscription renewals.
"security" = security alerts or vulnerability reports.`;

const DEMOS_PATH = new URL('../demos.json', import.meta.url).pathname;

export const createClassifier = () =>
  ax(SIGNATURE, { description: DESCRIPTION });

const loadDemos = (): unknown[] | null => {
  if (!existsSync(DEMOS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(DEMOS_PATH, 'utf-8'));
  } catch {
    return null;
  }
};

const getReadyClassifier = () => {
  const classifier = createClassifier();
  const demos = loadDemos();

  if (demos) {
    logDemosSource(true);
    classifier.setDemos(demos as any);
  } else {
    logDemosSource(false);
    classifier.setExamples(FALLBACK_EXAMPLES);
  }

  return classifier;
};

const classifier = getReadyClassifier();

export const classifyEmail = async (
  llm: AxAIService,
  email: Email,
): Promise<ClassificationResult> => {
  const result = await classifier.forward(llm, {
    emailFrom: email.from,
    emailSubject: email.subject,
    emailBody: email.body,
  });

  return {
    labels: (Array.isArray(result.labels) ? result.labels : [result.labels]) as Label[],
    priority: result.priority as ClassificationResult['priority'],
    needsReply: result.needsReply,
    summary: result.summary,
  };
};
