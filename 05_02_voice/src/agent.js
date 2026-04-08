import { PROJECT_DIR } from "./config.js";
import { fileURLToPath } from "node:url";
import { cli, defineAgent, voice, ServerOptions } from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { ElevenLabsTTS } from "./elevenlabs_tts.js";
import { createMcpManager } from "./mcp.js";
import { createTools } from "./tools.js";
import { getGoogleApiKey, resolveVoiceMode } from "./voice_mode.js";

const INSTRUCTIONS = [
  "You are a helpful voice assistant.",
  "You have access to web search and scraping tools via Firecrawl, and can read/write files in a local workspace.",
  "Keep answers concise and natural for spoken conversation.",
  "When using search or scrape tools, summarize the results conversationally rather than dumping raw data.",
].join("\n");

const OPENAI_MODEL = "gpt-4.1";
const GREETING_INSTRUCTIONS =
  "Greet the user briefly and mention you can help with web searches and reading or writing files.";

const buildOpenAISessionOptions = (vad, tts) => ({
  vad,
  stt: new openai.STT(),
  llm: new openai.LLM({ model: OPENAI_MODEL }),
  tts,
});

const createSessionConfig = (vad) => {
  const mode = resolveVoiceMode();
  if (mode.status !== "ready") {
    throw new Error(mode.error);
  }

  if (mode.id === "gemini") {
    const realtimeModel = new google.beta.realtime.RealtimeModel({
      apiKey: getGoogleApiKey(),
      thinkingConfig: { includeThoughts: false },
    });

    // Force manual tool-reply generation (matching the OpenAI realtime path).
    // The default `autoToolReplyGeneration: true` causes a deadlock in the
    // agent framework's speech-queue drain loop when combined with Gemini Live.
    const nativeCaps = realtimeModel.capabilities;
    Object.defineProperty(realtimeModel, "capabilities", {
      get: () => ({ ...nativeCaps, autoToolReplyGeneration: false }),
    });

    return {
      mode,
      sessionOptions: { vad, llm: realtimeModel },
    };
  }

  if (mode.id === "elevenlabs") {
    return {
      mode,
      sessionOptions: buildOpenAISessionOptions(
        vad,
        new ElevenLabsTTS({
          voiceId: "21m00Tcm4TlvDq8ikWAM",
          model: "eleven_flash_v2_5",
        }),
      ),
    };
  }

  return {
    mode,
    sessionOptions: buildOpenAISessionOptions(vad, new openai.TTS()),
  };
};

export default defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load();
    proc.userData.mcp = await createMcpManager(PROJECT_DIR).catch((error) => {
      console.error("[agent] MCP init failed:", error.message);
      return null;
    });
  },
  entry: async (ctx) => {
    await ctx.connect();
    const participant = await ctx.waitForParticipant();
    console.log(`[agent] participant joined: ${participant.identity}`);

    const tools = await createTools(ctx.proc.userData.mcp);

    const agent = new voice.Agent({ instructions: INSTRUCTIONS, tools });
    const { mode, sessionOptions } = createSessionConfig(ctx.proc.userData.vad);

    console.log(`[agent] using ${mode.label} voice stack`);

    const session = new voice.AgentSession(sessionOptions);

    await session.start({ agent, room: ctx.room });

    session.on("agent_speech_committed", (event) => {
      console.log(`[agent] said: ${event.content?.slice(0, 80)}...`);
    });

    session.on("user_speech_committed", (event) => {
      console.log(`[agent] user: ${event.transcript?.slice(0, 80)}...`);
    });

    session.on("close", async () => {
      console.log("[agent] session closed, cleaning up MCP connections");
      await ctx.proc.userData.mcp?.close();
    });

    await session.generateReply({ instructions: GREETING_INSTRUCTIONS });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
