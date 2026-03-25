import { join, dirname } from 'node:path';

export const PROJECT_DIR = dirname(dirname(Bun.main));
export const WORKSPACE = join(PROJECT_DIR, 'workspace');
export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3-flash-preview';
export const TTS_MODEL = process.env.TTS_MODEL ?? 'gemini-2.5-flash-preview-tts';
export const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const MAX_TURNS = 15;
export const TIMEOUT_MS = 60_000;
