import { extname, relative, resolve } from 'node:path';
import { WORKSPACE } from './config.js';
import { parseJsonLoose } from './gemini.js';
import type { ListenIssue, ListenResult } from './types/domain.js';

export const normalizeRelativePath = (pathArg: string): string =>
  pathArg.startsWith('workspace/') ? pathArg.slice('workspace/'.length) : pathArg;

export const safePath = (pathArg: string): string => {
  const cleaned = normalizeRelativePath(pathArg);
  if (!cleaned) throw new Error('Path is required');
  const abs = resolve(WORKSPACE, cleaned);
  const rel = relative(WORKSPACE, abs);
  if (rel.startsWith('..')) throw new Error('Path outside workspace');
  return abs;
};

export const mimeFor = (path: string): string => {
  const map: Record<string, string> = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.webm': 'audio/webm',
    '.flac': 'audio/flac',
  };
  return map[extname(path).toLowerCase()] ?? 'audio/wav';
};

export const toWav = (pcm: Buffer, rate = 24_000): Buffer => {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
};

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const fillerCounts = (tokens: string[]): Record<string, number> => {
  const fillers = ['um', 'uh', 'like', 'actually', 'basically'];
  const counts: Record<string, number> = {};
  for (const filler of fillers) {
    counts[filler] = tokens.filter((t) => t === filler).length;
  }
  return counts;
};

const toNumber = (value: unknown, fallback: number): number =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const normalizeSeverity = (value: unknown): ListenIssue['severity'] => {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
};

export const normalizeListenResult = (rawText: string): ListenResult => {
  type RawIssue = { trait_id?: unknown; evidence?: unknown; fix?: unknown; severity?: unknown };
  type RawSegment = { start_sec?: unknown; end_sec?: unknown; text?: unknown; confidence?: unknown };
  type Raw = {
    transcript?: unknown;
    confidence?: unknown;
    strengths?: unknown;
    issues?: unknown;
    segments?: unknown;
  };

  const parsed = parseJsonLoose<Raw>(rawText);
  const transcript = typeof parsed?.transcript === 'string' && parsed.transcript.trim()
    ? parsed.transcript.trim()
    : rawText.trim();

  const strengths = Array.isArray(parsed?.strengths)
    ? parsed!.strengths.filter((s): s is string => typeof s === 'string').slice(0, 6)
    : [];

  const issues = Array.isArray(parsed?.issues)
    ? (parsed!.issues as RawIssue[])
      .map((issue) => ({
        trait_id: typeof issue.trait_id === 'string' ? issue.trait_id : 'fluency.general',
        evidence: typeof issue.evidence === 'string' ? issue.evidence : '',
        fix: typeof issue.fix === 'string' ? issue.fix : '',
        severity: normalizeSeverity(issue.severity),
      }))
      .filter((issue) => issue.evidence && issue.fix)
      .slice(0, 8)
    : [];

  const segments = Array.isArray(parsed?.segments)
    ? (parsed!.segments as RawSegment[])
      .map((segment, idx) => ({
        start_sec: toNumber(segment.start_sec, idx * 2),
        end_sec: toNumber(segment.end_sec, idx * 2 + 2),
        text: typeof segment.text === 'string' ? segment.text : '',
        confidence: toNumber(segment.confidence, 0.75),
      }))
      .filter((segment) => segment.text.length > 0)
    : [];

  const tokens = tokenize(transcript);
  const unique = new Set(tokens);
  const durationSec = segments.length > 0
    ? Math.max(0.1, ...segments.map((s) => s.end_sec))
    : 0;
  const estimatedWpm = durationSec > 0 ? Number(((tokens.length / durationSec) * 60).toFixed(1)) : null;

  return {
    transcript,
    confidence: toNumber(parsed?.confidence, 0.7),
    strengths,
    issues,
    segments,
    metadata: {
      word_count: tokens.length,
      unique_word_count: unique.size,
      filler_counts: fillerCounts(tokens),
      duration_sec: Number(durationSec.toFixed(2)),
      estimated_wpm: estimatedWpm,
    },
  };
};

export const LISTEN_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transcript: { type: 'string' },
    confidence: { type: 'number' },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          trait_id: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['trait_id', 'evidence', 'fix', 'severity'],
      },
    },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          start_sec: { type: 'number' },
          end_sec: { type: 'number' },
          text: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['start_sec', 'end_sec', 'text', 'confidence'],
      },
    },
  },
  required: ['transcript', 'confidence', 'strengths', 'issues', 'segments'],
} as const;
