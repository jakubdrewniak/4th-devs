import { API_URL, TIMEOUT_MS } from './config.js';
import type {
  AudioContent,
  FunctionCallContent,
  FunctionResultContent,
  Interaction,
  InteractionRequest,
  OutputContent,
  TextContent,
  ThoughtContent,
} from './types/gemini.js';

const apiKey = (): string => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return key;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasTypeField = (value: unknown): value is { type: string } =>
  isObject(value) && typeof value.type === 'string';

const toOutputArray = (value: unknown): OutputContent[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.filter(hasTypeField) as OutputContent[];
};

const parseInteractionResponse = (raw: unknown): Interaction => {
  if (!isObject(raw)) throw new Error('Gemini response is not an object');

  const id = typeof raw.id === 'string' ? raw.id : '';
  const status = typeof raw.status === 'string' ? raw.status : '';
  if (!id || !status) throw new Error('Gemini response missing id or status');

  return {
    id,
    status,
    outputs: toOutputArray(raw.outputs),
    usage: isObject(raw.usage) ? raw.usage : undefined,
  };
};

const truncate = (text: string, max = 1200): string =>
  text.length > max ? `${text.slice(0, max)}...` : text;

export const callInteraction = async (payload: InteractionRequest): Promise<Interaction> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${truncate(body)}`);

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      throw new Error(`Gemini returned invalid JSON: ${truncate(body)}`, { cause: error });
    }

    return parseInteractionResponse(parsed);
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      throw new Error(`Gemini timeout (${TIMEOUT_MS}ms)`, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const isTextContent = (value: OutputContent): value is TextContent =>
  value.type === 'text';

const isThoughtContent = (value: OutputContent): value is ThoughtContent =>
  value.type === 'thought';

const isFunctionCallContent = (value: OutputContent): value is FunctionCallContent =>
  value.type === 'function_call'
  && typeof (value as { id?: unknown }).id === 'string'
  && typeof (value as { name?: unknown }).name === 'string'
  && isObject((value as { arguments?: unknown }).arguments);

const isAudioContent = (value: OutputContent): value is AudioContent =>
  value.type === 'audio';

export const extractText = (outputs: OutputContent[] | undefined): string =>
  (outputs ?? [])
    .flatMap((o): string[] => {
      if (isTextContent(o)) return [o.text ?? ''];
      if (isThoughtContent(o)) {
        return (o.summary ?? []).map((summary) => summary.text ?? '');
      }
      return [];
    })
    .join('\n')
    .trim();

export const extractFunctionCalls = (outputs: OutputContent[] | undefined): FunctionCallContent[] =>
  (outputs ?? []).filter(isFunctionCallContent);

export const extractAudio = (outputs: OutputContent[] | undefined): { mime: string; data: string } | null => {
  for (const o of outputs ?? []) {
    if (!isAudioContent(o)) continue;
    if (o.data) return { mime: o.mime_type ?? 'audio/pcm', data: o.data };
  }
  return null;
};

export const buildFunctionResult = (
  callId: string,
  name: string,
  result: string,
  isError = false,
): FunctionResultContent => ({
  type: 'function_result',
  call_id: callId,
  name,
  result,
  ...(isError ? { is_error: true } : {}),
});

export const parseJsonLoose = <T>(text: string): T | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;
  const candidates: string[] = [fenced];

  const firstBrace = fenced.indexOf('{');
  const lastBrace = fenced.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(fenced.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = fenced.indexOf('[');
  const lastBracket = fenced.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(fenced.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Keep trying next candidate.
    }
  }
  return null;
};

export type {
  AudioContent,
  FunctionCallContent,
  FunctionResultContent,
  Interaction,
  InteractionRequest,
  OutputContent,
  TextContent,
  ThoughtContent,
} from './types/gemini.js';
