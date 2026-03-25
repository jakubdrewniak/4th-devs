import type { ResponseInputItem } from 'openai/resources/responses/responses';
import type { FeedbackTracker } from '../feedback/index.js';
import { log } from '../log.js';
import type { InterventionState } from './types.js';

export const createInterventionState = (): InterventionState => ({
  screenshotTipSent: false,
  discoveryTipSent: false,
});

const buildScreenshotTip = (failureCount: number, site: string | null): string =>
  `You've had ${failureCount} consecutive tool failures. ` +
  `The page structure may have changed. Call take_screenshot to visually inspect the current page before trying another selector strategy.` +
  (site ? ` You are on ${site}.` : '');

const buildDiscoveryTip = (site: string | null): string =>
  `You just recovered from earlier failures. Save what worked to ` +
  (site ? `instructions/${site}-discoveries.md` : 'a discoveries file') +
  ' using fs_write so future runs can reuse the working approach.';

export const collectTurnInterventions = (
  feedback: FeedbackTracker,
  recoveredFromFailures: boolean,
  state: InterventionState,
): { items: ResponseInputItem[]; nextState: InterventionState } => {
  const items: ResponseInputItem[] = [];
  const nextState = { ...state };
  const failureCount = feedback.consecutiveFailures();
  const site = feedback.lastInstructionSite();

  if (failureCount >= 2 && !nextState.screenshotTipSent) {
    nextState.screenshotTipSent = true;
    log.hint(`Injecting screenshot suggestion (${failureCount} consecutive failures)`);
    items.push({
      role: 'user',
      content: buildScreenshotTip(failureCount, site),
    });
  }

  if (recoveredFromFailures && !nextState.discoveryTipSent) {
    nextState.discoveryTipSent = true;
    log.hint(`Injecting discovery suggestion after recovery on ${site ?? 'unknown site'}`);
    items.push({
      role: 'user',
      content: buildDiscoveryTip(site),
    });
  }

  return { items, nextState };
};

export const appendFinalDiscoveryTip = (
  responseText: string,
  feedback: FeedbackTracker,
  state: InterventionState,
): string => {
  if (state.discoveryTipSent) return responseText;
  if (feedback.stats().failures === 0) return responseText;

  const site = feedback.lastInstructionSite();
  return (
    responseText +
    (site
      ? ` Consider saving what you learned to instructions/${site}-discoveries.md so future runs avoid the same issues.`
      : ' Consider saving what you learned to a discovery file so future runs avoid the same issues.')
  );
};
