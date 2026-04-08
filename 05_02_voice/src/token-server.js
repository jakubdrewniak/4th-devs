import "./config.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { AccessToken } from "livekit-server-sdk";
import { resolveVoiceMode } from "./voice_mode.js";

const PORT = Number(process.env.TOKEN_SERVER_PORT ?? "3310");
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "devkey";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "secret";
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "ws://localhost:7880";

const app = new Hono();

app.get("/api/config", (c) => {
  return c.json({ agentMode: resolveVoiceMode() });
});

app.get("/api/token", async (c) => {
  const identity = `user-${Date.now().toString(36)}`;
  const room = `voice_${Date.now().toString(36)}`;

  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    ttl: "10m",
  });

  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const jwt = await token.toJwt();
  return c.json({
    token: jwt,
    url: LIVEKIT_URL,
    room,
    identity,
    agentMode: resolveVoiceMode(),
  });
});

app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[token-server] http://localhost:${PORT}`);
  console.log(`[token-server] LiveKit URL: ${LIVEKIT_URL}`);
});
