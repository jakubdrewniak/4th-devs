import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { MODEL, TTS_MODEL } from './config.js';
import { callInteraction, extractAudio, extractText, parseJsonLoose } from './gemini.js';
import {
  LISTEN_RESPONSE_SCHEMA,
  mimeFor,
  normalizeListenResult,
  normalizeRelativePath,
  safePath,
  toWav,
} from './helpers.js';
import type { LearnerProfile, ListenResult as DomainListenResult } from './types/domain.js';

export interface Tool {
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

const FEEDBACK_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text_feedback: { type: 'string' },
    speech_script: { type: 'string' },
    issues_used: { type: 'array', items: { type: 'string' } },
  },
  required: ['text_feedback', 'speech_script', 'issues_used'],
} as const;

const defaultProfile = (): LearnerProfile => ({
  role: 'software engineer',
  goals: ['Speak clearly in standups', 'Explain technical decisions', 'Reduce filler words'],
  weakAreas: [],
});

const normalizeProfile = (rawProfile: string): LearnerProfile => {
  const parsed = parseJsonLoose<LearnerProfile>(rawProfile);
  if (!parsed || typeof parsed !== 'object') return defaultProfile();
  return {
    role: typeof parsed.role === 'string' ? parsed.role : 'software engineer',
    goals: Array.isArray(parsed.goals) ? parsed.goals.filter((g): g is string => typeof g === 'string') : [],
    weakAreas: Array.isArray(parsed.weakAreas) ? parsed.weakAreas.filter((g): g is string => typeof g === 'string') : [],
  };
};

const isPronunciationTrait = (traitId: string): boolean => traitId.startsWith('pronunciation.');

const fallbackFeedbackText = (listen: DomainListenResult, profile: LearnerProfile): string => {
  if (listen.issues.length === 0) {
    return [
      `Great work for your ${profile.role} communication practice.`,
      'No major issues were detected in this recording.',
      'Practice task: record one short work update and focus on clear sentence boundaries with steady pace.',
    ].join(' ');
  }
  const lines = listen.issues.slice(0, 4).map((issue) =>
    `You said "${issue.evidence}" -> Say "${issue.fix}" -> Because this improves ${issue.trait_id.replace('.', ' ')}.`,
  );
  return lines.join(' ');
};

export const tools: Record<string, Tool> = {
  listen: {
    description:
      'Analyze audio input and return strict structured JSON with transcript, issues, strengths, segments, and confidence.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Audio path in workspace, e.g. input/day.wav' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const path = String(args.path ?? '');
      if (!path) return JSON.stringify({ error: 'missing path' });
      const abs = safePath(path);
      const audio = await readFile(abs);

      const interaction = await callInteraction({
        model: MODEL,
        input: [
          {
            type: 'text',
            text: `You are an English pronunciation and language coach analyzing a learner recording.
Listen carefully to BOTH what they say AND how they say it.

Analyze two dimensions:
1. LANGUAGE: grammar errors, wrong tense, missing articles, filler words, word choice
2. ACCENT/PRONUNCIATION: unclear sounds, wrong stress placement, vowel problems, consonant issues, unnatural rhythm or intonation, L1 interference patterns

Return ONLY JSON using this schema:
{ transcript, confidence, strengths[], issues[{trait_id,evidence,fix,severity}], segments[{start_sec,end_sec,text,confidence}] }

Trait ID taxonomy:
- grammar.articles, grammar.verb_tense, grammar.preposition, grammar.word_form
- fluency.fillers, fluency.pace, fluency.hesitation
- pronunciation.stress (wrong syllable stress), pronunciation.vowels (vowel quality), pronunciation.consonants (unclear consonants), pronunciation.intonation (flat or unnatural melody), pronunciation.rhythm (choppy or rushed)

For pronunciation issues: evidence = the word or phrase affected, fix = how to pronounce it (describe the sound or stress pattern in plain spoken English).
Only include pronunciation/accent issues when the recording provides clear evidence.
If the audio is noisy or unclear, do not guess: return fewer issues, lower confidence, and mention uncertainty directly in evidence.
Be specific about which sounds are unclear or which syllables are stressed wrong.`,
          },
          { type: 'audio', mime_type: mimeFor(path), data: audio.toString('base64') },
        ],
        response_format: LISTEN_RESPONSE_SCHEMA,
        generation_config: { temperature: 0.1, thinking_level: 'low' },
      });

      const normalized = normalizeListenResult(extractText(interaction.outputs));
      return JSON.stringify(normalized, null, 2);
    },
  },

  speak: {
    description:
      'Generate spoken feedback audio from text and save it in workspace.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Exact speech content' },
        output_path: { type: 'string', description: 'Audio output path in workspace, e.g. output/feedback.wav' },
        style: { type: 'string', enum: ['slow', 'normal'] },
      },
      required: ['text', 'output_path'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const text = String(args.text ?? '');
      const outputPath = String(args.output_path ?? '');
      if (!text || !outputPath) return JSON.stringify({ error: 'missing text or output_path' });
      const stylePrompt = args.style === 'slow'
        ? 'Speak in a calm, natural tone at a slower pace with clear articulation and short pauses between corrections. This is pronunciation-coaching mode. Be direct and precise, no exaggerated expression.'
        : 'Speak in a calm, natural conversational tone. Be direct, clear, and precise. No exaggerated expression or enthusiasm.';

      const interaction = await callInteraction({
        model: TTS_MODEL,
        input: `${stylePrompt}\n\n${text}`,
        response_modalities: ['AUDIO'],
        generation_config: { speech_config: { language: 'en-us', voice: 'kore' } },
      });

      const audio = extractAudio(interaction.outputs);
      if (!audio) return JSON.stringify({ error: 'no audio generated' });

      const raw = Buffer.from(audio.data, 'base64');
      const wav = audio.mime.includes('wav') ? raw : toWav(raw);
      const abs = safePath(outputPath);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, wav);
      return JSON.stringify({ output_path: normalizeRelativePath(outputPath), bytes: wav.length, mime: 'audio/wav' });
    },
  },

  feedback: {
    description:
      'Generate personalized coaching text and spoken feedback from listen output.',
    parameters: {
      type: 'object',
      properties: {
        listen_result_json: {
          type: 'string',
          description: 'Raw JSON string returned by listen tool.',
        },
        profile_json: {
          type: 'string',
          description: 'Raw profile.json content from fs_read profile.json.',
        },
        output_path: { type: 'string', description: 'Audio output path in workspace, e.g. output/feedback.wav' },
        style: { type: 'string', enum: ['slow', 'normal'] },
      },
      required: ['listen_result_json'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const listenRaw = String(args.listen_result_json ?? '');
      if (!listenRaw.trim()) return JSON.stringify({ error: 'missing listen_result_json' });
      const profileRaw = String(args.profile_json ?? '');
      const listen = normalizeListenResult(listenRaw);
      const profile = normalizeProfile(profileRaw);
      const outputPath = String(args.output_path ?? 'output/feedback.wav');
      const preferredStyle = args.style === 'slow' || args.style === 'normal' ? args.style : null;
      const defaultStyle = listen.issues.some((issue) => isPronunciationTrait(issue.trait_id)) ? 'slow' : 'normal';
      const style = preferredStyle ?? defaultStyle;

      const interaction = await callInteraction({
        model: MODEL,
        input: [
          {
            type: 'text',
            text: `You are creating final coaching feedback from structured analysis and profile context.
Return ONLY JSON with this schema:
{ text_feedback: string, speech_script: string, issues_used: string[] }

Goals:
- text_feedback: complete, insightful, and personalized to this learner's role/goals/weakAreas.
- speech_script: concise spoken version optimized for TTS coaching delivery.
- issues_used: trait_id values you used in the feedback.

Rules:
- Use only evidence from listen analysis. Do not invent errors.
- If issues are empty, provide strengths + one concrete practice task.
- For corrections, prefer this pattern: You said X -> Say Y -> Because Z.
- If pronunciation issues exist, include clear sound or stress cues and a short repeat-after-me drill.

Learner profile:
${JSON.stringify(profile, null, 2)}

Listen analysis:
${JSON.stringify(listen, null, 2)}`,
          },
        ],
        response_format: FEEDBACK_RESPONSE_SCHEMA,
        generation_config: { temperature: 0.2, thinking_level: 'low' },
      });

      type RawFeedback = {
        text_feedback?: unknown;
        speech_script?: unknown;
        issues_used?: unknown;
      };
      const parsed = parseJsonLoose<RawFeedback>(extractText(interaction.outputs));
      const textFeedback = typeof parsed?.text_feedback === 'string' && parsed.text_feedback.trim()
        ? parsed.text_feedback.trim()
        : fallbackFeedbackText(listen, profile);
      const speechScript = typeof parsed?.speech_script === 'string' && parsed.speech_script.trim()
        ? parsed.speech_script.trim()
        : textFeedback;
      const parsedIssuesUsed = Array.isArray(parsed?.issues_used)
        ? parsed!.issues_used.filter((v): v is string => typeof v === 'string')
        : [];
      const issuesUsed = (parsedIssuesUsed.length > 0 ? parsedIssuesUsed : listen.issues.map((i) => i.trait_id)).slice(0, 8);

      let spokenFeedbackPath = normalizeRelativePath(outputPath);
      let audioBytes: number | undefined;
      let audioMime: string | undefined;
      let audioError: string | undefined;

      try {
        const speakResultRaw = await tools.speak.handler({
          text: speechScript,
          output_path: outputPath,
          style,
        });
        const speakResult = parseJsonLoose<{
          output_path?: unknown;
          bytes?: unknown;
          mime?: unknown;
          error?: unknown;
        }>(speakResultRaw);
        if (typeof speakResult?.output_path === 'string') spokenFeedbackPath = speakResult.output_path;
        if (typeof speakResult?.bytes === 'number') audioBytes = speakResult.bytes;
        if (typeof speakResult?.mime === 'string') audioMime = speakResult.mime;
        if (typeof speakResult?.error === 'string') audioError = speakResult.error;
      } catch (error) {
        audioError = error instanceof Error ? error.message : String(error);
      }

      return JSON.stringify({
        text_feedback: textFeedback,
        speech_script: speechScript,
        issues_used: issuesUsed,
        style,
        output_path: spokenFeedbackPath,
        ...(typeof audioBytes === 'number' ? { bytes: audioBytes } : {}),
        ...(typeof audioMime === 'string' ? { mime: audioMime } : {}),
        ...(typeof audioError === 'string' ? { audio_error: audioError } : {}),
      }, null, 2);
    },
  },

  fs_read: {
    description: 'Read a text file from workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const path = String(args.path ?? '');
      if (!path) return 'Error: missing path';
      try {
        return await readFile(safePath(path), 'utf-8');
      } catch {
        return `File not found: ${normalizeRelativePath(path)}`;
      }
    },
  },

  fs_write: {
    description: 'Write or append text to a file in workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const path = String(args.path ?? '');
      const content = String(args.content ?? '');
      if (!path) return JSON.stringify({ error: 'missing path' });
      const abs = safePath(path);
      await mkdir(dirname(abs), { recursive: true });
      if (args.append === true) await appendFile(abs, content, 'utf-8');
      else await writeFile(abs, content, 'utf-8');
      return JSON.stringify({
        path: normalizeRelativePath(path),
        append: args.append === true,
        bytes: Buffer.byteLength(content, 'utf-8'),
      });
    },
  },
};

export type { ListenResult } from './types/domain.js';
