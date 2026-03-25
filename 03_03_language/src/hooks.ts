import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKSPACE } from './config.js';
import { parseJsonLoose } from './gemini.js';
import type { ListenResult, Tool } from './tools.js';
import type { LearnerProfile, SessionRecord } from './types/domain.js';

export interface PhaseFlags {
  listen_done: boolean;
  feedback_done: boolean;
  session_saved: boolean;
}

export interface CompletedPhase {
  audio_input_path: string;
  listen_result: ListenResult;
  text_feedback: string;
  spoken_feedback_path?: string;
}

export interface SessionState {
  session_id: string;
  current_date: string;
  recent_sessions: string[];
  profile_updated: boolean;

  audio_input_path?: string;
  listen_result?: ListenResult;
  text_feedback?: string;
  spoken_feedback_path?: string;
  phase_flags: PhaseFlags;
  phase_errors: string[];

  completed_phases: CompletedPhase[];
}

export interface HookBeforeFinishResult {
  allow: boolean;
  missing: string[];
  inject_message?: string;
}

export interface AgentHooks {
  state: SessionState;
  beforeToolCall: (toolName: string, args: Record<string, unknown>) => void;
  afterToolResult: (
    toolName: string,
    args: Record<string, unknown>,
    output: string,
  ) => { output: string; log_summary?: string };
  beforeFinish: (finalText: string) => HookBeforeFinishResult;
  buildFallbackTextFeedback: () => string;
}

const uniq = (items: string[]): string[] => [...new Set(items)];

const toFilePath = (value: unknown): string => (typeof value === 'string' ? value : '');

const defaultProfile = (): LearnerProfile => ({
  role: 'software engineer',
  goals: ['Speak clearly in standups', 'Explain technical decisions', 'Reduce filler words'],
  weakAreas: [],
});

const tryParseProfile = (raw: string): LearnerProfile => {
  const parsed = parseJsonLoose<LearnerProfile>(raw);
  if (!parsed || typeof parsed !== 'object') return defaultProfile();
  return {
    role: typeof parsed.role === 'string' ? parsed.role : 'software engineer',
    goals: Array.isArray(parsed.goals) ? parsed.goals.filter((g): g is string => typeof g === 'string') : [],
    weakAreas: Array.isArray(parsed.weakAreas) ? parsed.weakAreas.filter((g): g is string => typeof g === 'string') : [],
  };
};

const summaryFromListen = (listen?: ListenResult): string => {
  if (!listen) return 'listen: no structured result';
  return [
    `words=${listen.metadata.word_count}`,
    `unique=${listen.metadata.unique_word_count}`,
    `wpm=${listen.metadata.estimated_wpm ?? 'n/a'}`,
    `issues=${listen.issues.length}`,
    `confidence=${listen.confidence.toFixed(2)}`,
  ].join(' | ');
};

const isPronunciationTrait = (traitId: string): boolean => traitId.startsWith('pronunciation.');

const speechFromListen = (listen?: ListenResult): string => {
  if (!listen || listen.issues.length === 0) {
    return 'Practice one short work update. Use clear sentence boundaries and steady pace.';
  }
  const pronunciation = listen.issues.filter((i) => isPronunciationTrait(i.trait_id)).slice(0, 2);
  const language = listen.issues.filter((i) => !isPronunciationTrait(i.trait_id)).slice(0, 2);
  const parts: string[] = [];

  if (pronunciation.length > 0) {
    parts.push('Pronunciation focus.');
    parts.push(...pronunciation.map((i) =>
      `You said: ${i.evidence}. Say: ${i.fix}. Repeat that two times, slowly and clearly.`,
    ));
  }

  if (language.length > 0) {
    parts.push('Language accuracy focus.');
    parts.push(...language.map((i) =>
      `You said: ${i.evidence}. Say instead: ${i.fix}. This is because the correct form for ${i.trait_id.replace('.', ' ')} requires it.`,
    ));
  }

  parts.push('Now say one full corrected sentence at natural speed.');
  return parts.join(' ');
};

const fallbackTextFromListen = (listen?: ListenResult): string => {
  if (!listen) return 'Audio analysis was not completed.';
  const lines = listen.issues.length > 0
    ? listen.issues.map((i) => `- "${i.evidence}" -> "${i.fix}" (${i.trait_id})`)
    : ['- No major issues found.'];
  return [`Transcript: "${listen.transcript}"`, '', ...lines].join('\n');
};

const detectToolError = (output: string): string | null => {
  if (output.startsWith('Error:')) return output;
  if (output.startsWith('File not found:')) return output;
  const parsed = parseJsonLoose<{ error?: unknown }>(output);
  if (typeof parsed?.error === 'string') return parsed.error;
  return null;
};

const freshPhaseFlags = (): PhaseFlags => ({
  listen_done: false,
  feedback_done: false,
  session_saved: false,
});

const snapshotPhase = (state: SessionState): CompletedPhase | null => {
  if (!state.listen_result || !state.audio_input_path) return null;
  return {
    audio_input_path: state.audio_input_path,
    listen_result: state.listen_result,
    text_feedback: state.text_feedback ?? fallbackTextFromListen(state.listen_result),
    spoken_feedback_path: state.spoken_feedback_path,
  };
};

const resetPhaseFields = (state: SessionState): void => {
  state.audio_input_path = undefined;
  state.listen_result = undefined;
  state.text_feedback = undefined;
  state.spoken_feedback_path = undefined;
  state.phase_flags = freshPhaseFlags();
  state.phase_errors = [];
};

export const listRecentSessions = async (limit = 3): Promise<string[]> => {
  const sessionsDir = join(WORKSPACE, 'sessions');
  const files = await readdir(sessionsDir).catch(() => []);
  return files
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(-limit);
};

export const createAgentHooks = (params: {
  currentDate: string;
  sessionId: string;
  recentSessions: string[];
}): AgentHooks => {
  const state: SessionState = {
    session_id: params.sessionId,
    current_date: params.currentDate,
    recent_sessions: params.recentSessions,
    profile_updated: false,
    phase_flags: freshPhaseFlags(),
    phase_errors: [],
    completed_phases: [],
  };

  const tryCompletePhase = (): string | null => {
    const { phase_flags } = state;
    if (!phase_flags.listen_done || !phase_flags.feedback_done || !phase_flags.session_saved) return null;

    const snapshot = snapshotPhase(state);
    if (!snapshot) return null;

    const phaseIndex = state.completed_phases.length + 1;
    state.completed_phases.push(snapshot);
    resetPhaseFields(state);
    return `Phase ${phaseIndex} complete (${snapshot.audio_input_path}). Ready for next file.`;
  };

  return {
    state,

    beforeToolCall: (toolName, args) => {
      if (toolName === 'listen') {
        state.audio_input_path = toFilePath(args.path);
      }
    },

    afterToolResult: (toolName, args, output) => {
      const errorSignal = detectToolError(output);

      if (toolName === 'listen') {
        if (errorSignal) {
          state.phase_errors.push(`listen: ${errorSignal}`);
          return { output, log_summary: `listen error: ${errorSignal}` };
        }
        const parsed = parseJsonLoose<ListenResult>(output);
        if (parsed) {
          state.listen_result = parsed;
          state.phase_flags.listen_done = true;
          return { output, log_summary: summaryFromListen(parsed) };
        }
        return { output, log_summary: 'listen: could not parse structured JSON' };
      }

      if (toolName === 'speak') {
        if (errorSignal) {
          state.phase_errors.push(`speak: ${errorSignal}`);
          return { output, log_summary: `speak error: ${errorSignal}` };
        }
        const parsed = parseJsonLoose<{ output_path?: string }>(output);
        if (parsed?.output_path) {
          state.spoken_feedback_path = parsed.output_path;
          state.phase_flags.feedback_done = true;
          return { output, log_summary: `speak: ${parsed.output_path}` };
        }
      }

      if (toolName === 'feedback') {
        const parsed = parseJsonLoose<{
          text_feedback?: unknown;
          output_path?: unknown;
          audio_error?: unknown;
        }>(output);
        if (typeof parsed?.text_feedback === 'string' && parsed.text_feedback.trim()) {
          state.text_feedback = parsed.text_feedback.trim();
        }
        if (typeof parsed?.output_path === 'string' && parsed.output_path.trim()) {
          state.spoken_feedback_path = parsed.output_path;
        }
        state.phase_flags.feedback_done = true;

        const detail = [
          ...(state.text_feedback ? ['text'] : []),
          ...(state.spoken_feedback_path ? [`audio=${state.spoken_feedback_path}`] : []),
          ...(typeof parsed?.audio_error === 'string' ? [`audio_error=${parsed.audio_error}`] : []),
        ].join(' | ');
        return { output, log_summary: `feedback: ${detail || 'completed'}` };
      }

      if (toolName === 'fs_write') {
        const path = toFilePath(args.path);
        if (path === 'profile.json') state.profile_updated = true;
        if (path.startsWith('sessions/')) {
          state.phase_flags.session_saved = true;
          const phaseMsg = tryCompletePhase();
          if (phaseMsg) return { output, log_summary: phaseMsg };
        }
        return { output, log_summary: `fs_write: ${path}` };
      }

      return { output };
    },

    beforeFinish: (finalText) => {
      if (state.phase_errors.length > 0) {
        return { allow: true, missing: [] };
      }

      const missing: string[] = [];

      const hasActivePhase = state.phase_flags.listen_done
        || state.phase_flags.feedback_done
        || state.audio_input_path;

      if (hasActivePhase) {
        if (!state.phase_flags.listen_done) missing.push('listen to audio');
        if (!state.phase_flags.feedback_done) missing.push('generate feedback (use feedback tool)');
        if (!state.phase_flags.session_saved) missing.push(`save session to sessions/${state.session_id}.json`);
      }

      if (!state.profile_updated && (state.completed_phases.length > 0 || state.phase_flags.listen_done)) {
        missing.push('update profile.json weakAreas');
      }

      const hasText = finalText.trim().length > 0
        || (state.text_feedback?.trim().length ?? 0) > 0
        || state.completed_phases.length > 0;
      if (!hasText) missing.push('text feedback');

      if (missing.length === 0) return { allow: true, missing: [] };

      return {
        allow: false,
        missing,
        inject_message: [
          'You must complete these before finishing:',
          ...missing.map((m) => `- ${m}`),
          ...(!state.phase_flags.session_saved && hasActivePhase
            ? [`Session file: sessions/${state.session_id}.json`]
            : []),
          ...(!state.profile_updated
            ? ['Profile file: profile.json (only update weakAreas, keep role and goals)']
            : []),
        ].join('\n'),
      };
    },

    buildFallbackTextFeedback: () => {
      const parts = state.completed_phases.map((p) => p.text_feedback);
      if (state.text_feedback?.trim()) parts.push(state.text_feedback.trim());
      else if (state.listen_result) parts.push(fallbackTextFromListen(state.listen_result));
      return parts.join('\n\n---\n\n') || 'No feedback generated.';
    },
  };
};
