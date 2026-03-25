# 03_03_language

English coaching agent with Gemini for ASR, pronunciation scoring, drills, and TTS.

## Run

```bash
npm run lesson13:language
```

Then ask the agent to analyze a recording, e.g. `Please give me feedback on input/day.wav`.

Sample audio files are already in `workspace/input/`. You can also drop your own `.wav` files there.

Generate additional sample audio:

```bash
cd 03_03_language && bun run sample:audio -- --style clear
```

## Required setup

1. Copy `env.example` to `.env` in the repo root.
2. Set `GEMINI_API_KEY` (required — used for ASR, analysis, and TTS).
3. Optional: `COACH_MODEL` (default `gemini-2.5-flash`), `ASR_MODEL` (default `gemini-2.5-flash`), `TTS_MODEL` (default `gemini-2.5-flash-preview-tts`).

## What it does

1. Reads the learner's profile (`workspace/profile.json`) with goals and weak areas
2. Transcribes and analyzes the audio recording via Gemini API — catches grammar errors, pronunciation issues, filler words, and speech rhythm
3. Generates personalized feedback as text and audio (Gemini TTS) — a `text + audio input → text + audio output` interaction
4. Saves session notes, transcript, and coaching artifacts to `workspace/sessions/` and updates the learner profile with discovered weak areas

## Agent hooks

The agent uses lifecycle hooks to enforce the full coaching flow:

- **beforeToolCall** — when `listen` is called, records the audio file path for the current session
- **afterToolResult** — tracks phase completion flags (`listen_done`, `feedback_done`, `session_saved`); resets state when all phases are complete, allowing the next analysis
- **beforeFinish** — guards the finish: if required steps (listen → feedback → session save → profile update) are incomplete, it injects a message asking the agent to complete them before finishing

## Notes

The `listen` and `feedback` tools make **additional Gemini API calls** internally — the agent orchestrates when to call them, but the tools themselves run separate model requests for ASR/analysis and TTS generation. Progress is persisted across sessions, so feedback becomes more personalized over time.
