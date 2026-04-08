const readEnv = (name) => {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export const getGoogleApiKey = () =>
  readEnv("GOOGLE_API_KEY")
  ?? readEnv("GOOGLE_GENAI_API_KEY")
  ?? readEnv("GEMINI_API_KEY");

const hasOpenAIKey = () => Boolean(readEnv("OPENAI_API_KEY"));
const hasElevenLabsKey = () => Boolean(readEnv("ELEVEN_API_KEY"));

export const resolveVoiceMode = () => {
  if (getGoogleApiKey()) {
    return {
      status: "ready",
      id: "gemini",
      label: "Gemini Realtime",
      description: "Gemini native audio realtime voice stack.",
    };
  }

  if (hasElevenLabsKey()) {
    if (!hasOpenAIKey()) {
      return {
        status: "invalid",
        id: "invalid",
        label: "Configuration Error",
        description: "ElevenLabs mode needs OPENAI_API_KEY for STT and LLM.",
        error:
          "ELEVEN_API_KEY was found, but OPENAI_API_KEY is still required for the OpenAI STT/LLM fallback.",
      };
    }

    return {
      status: "ready",
      id: "elevenlabs",
      label: "OpenAI + ElevenLabs",
      description: "OpenAI STT/LLM with ElevenLabs TTS.",
    };
  }

  if (hasOpenAIKey()) {
    return {
      status: "ready",
      id: "openai",
      label: "OpenAI",
      description: "OpenAI STT, LLM, and TTS fallback.",
    };
  }

  return {
    status: "invalid",
    id: "invalid",
    label: "Not Configured",
    description:
      "Set GOOGLE_API_KEY, GOOGLE_GENAI_API_KEY, or GEMINI_API_KEY, or use OPENAI_API_KEY with optional ELEVEN_API_KEY.",
    error:
      "Set GOOGLE_API_KEY, GOOGLE_GENAI_API_KEY, or GEMINI_API_KEY for Gemini realtime, or OPENAI_API_KEY for the OpenAI fallback.",
  };
};
