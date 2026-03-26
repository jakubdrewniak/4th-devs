export type HintStatus = 'success' | 'empty' | 'partial' | 'error';

export type HintReasonCode =
  | 'OK'
  | 'NO_RESULTS'
  | 'AUTH_REQUIRED'
  | 'NOT_FOUND'
  | 'INVALID_ARGUMENT'
  | 'RATE_LIMITED'
  | 'POLICY_BLOCKED'
  | 'TRANSIENT_FAILURE';

export interface HintNextAction {
  tool: string;
  why: string;
  args: Record<string, unknown>;
  confidence: number;
}

export interface HintRecovery {
  retryable: boolean;
  backoffMs: number;
  maxAttempts: number;
}

export interface HintDiagnostics {
  scope: 'tool' | 'global';
  httpStatus?: number;
  rawMessage?: string;
}

export interface ToolHint {
  status: HintStatus;
  reasonCode: HintReasonCode;
  summary: string;
  nextActions: HintNextAction[];
  recovery: HintRecovery;
  diagnostics?: HintDiagnostics;
}

export interface ToolEnvelope<T> {
  data: T;
  hint: ToolHint;
}

const DEFAULT_RECOVERY: HintRecovery = {
  retryable: false,
  backoffMs: 0,
  maxAttempts: 0,
};

const clampConfidence = (value: number): number =>
  Math.max(0, Math.min(1, value));

export const proposeAction = (
  tool: string,
  why: string,
  args: Record<string, unknown>,
  confidence: number,
): HintNextAction => ({
  tool,
  why,
  args,
  confidence: clampConfidence(confidence),
});

export const createHint = (params: {
  status: HintStatus;
  reasonCode: HintReasonCode;
  summary: string;
  nextActions?: HintNextAction[];
  recovery?: HintRecovery;
  diagnostics?: HintDiagnostics;
}): ToolHint => ({
  status: params.status,
  reasonCode: params.reasonCode,
  summary: params.summary,
  nextActions: params.nextActions ?? [],
  recovery: params.recovery ?? DEFAULT_RECOVERY,
  ...(params.diagnostics ? { diagnostics: params.diagnostics } : {}),
});

export const withHint = <T>(data: T, hint: ToolHint): ToolEnvelope<T> => ({
  data,
  hint,
});

const AUTH_PATTERNS = [
  'invalid_grant',
  'invalid_client',
  'token has been expired',
  'unauthorized',
  'insufficient authentication scopes',
  'permission denied',
];

const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'quota exceeded',
  'too many requests',
  'user-rate limit',
];

const TRANSIENT_PATTERNS = [
  'timed out',
  'timeout',
  'socket hang up',
  'econnreset',
  'enotfound',
  'eai_again',
  'internal error',
  'backend error',
  'temporarily unavailable',
];

const parseHttpStatus = (message: string): number | undefined => {
  const match = message.match(/\b([45]\d{2})\b/);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const includesAny = (source: string, fragments: string[]): boolean =>
  fragments.some((fragment) => source.includes(fragment));

const classifyErrorReason = (message: string): HintReasonCode => {
  const lower = message.toLowerCase();
  const status = parseHttpStatus(lower);

  if (
    status === 401 ||
    status === 403 ||
    includesAny(lower, AUTH_PATTERNS)
  ) {
    return 'AUTH_REQUIRED';
  }

  if (status === 429 || includesAny(lower, RATE_LIMIT_PATTERNS)) {
    return 'RATE_LIMITED';
  }

  if (status === 404 || lower.includes('not found')) {
    return 'NOT_FOUND';
  }

  if (
    lower.includes('invalid') ||
    lower.includes('required') ||
    lower.includes('must be') ||
    lower.includes('unsupported') ||
    lower.includes('mutually exclusive') ||
    lower.includes('unknown tool')
  ) {
    return 'INVALID_ARGUMENT';
  }

  if (
    (typeof status === 'number' && status >= 500) ||
    includesAny(lower, TRANSIENT_PATTERNS)
  ) {
    return 'TRANSIENT_FAILURE';
  }

  return 'TRANSIENT_FAILURE';
};

const errorSummary = (reasonCode: HintReasonCode, message: string): string => {
  switch (reasonCode) {
    case 'AUTH_REQUIRED':
      return 'Gmail authentication failed or expired. Ask the user to run "bun run auth", then retry.';
    case 'RATE_LIMITED':
      return 'Gmail rate limit reached. Retry after a short backoff.';
    case 'NOT_FOUND':
      return message;
    case 'INVALID_ARGUMENT':
      return message;
    case 'TRANSIENT_FAILURE':
      return 'Temporary provider or network error. Retry may succeed.';
    default:
      return message;
  }
};

const errorRecovery = (reasonCode: HintReasonCode): HintRecovery => {
  switch (reasonCode) {
    case 'RATE_LIMITED':
      return { retryable: true, backoffMs: 3000, maxAttempts: 3 };
    case 'TRANSIENT_FAILURE':
      return { retryable: true, backoffMs: 1500, maxAttempts: 2 };
    default:
      return DEFAULT_RECOVERY;
  }
};

export const buildErrorHint = (
  message: string,
  scope: 'tool' | 'global' = 'global',
): ToolHint => {
  const reasonCode = classifyErrorReason(message);
  return createHint({
    status: 'error',
    reasonCode,
    summary: errorSummary(reasonCode, message),
    recovery: errorRecovery(reasonCode),
    diagnostics: {
      scope,
      httpStatus: parseHttpStatus(message),
      rawMessage: message,
    },
  });
};
