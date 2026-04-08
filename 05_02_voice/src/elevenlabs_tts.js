import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { AudioByteStream, tts } from "@livekit/agents";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import WebSocket from "ws";

const API_BASE = "wss://api.elevenlabs.io/v1";

class ElevenLabsSynthesizeStream extends tts.SynthesizeStream {
  label = "elevenlabs-mp3.SynthesizeStream";
  #opts;

  constructor(ttsInstance, opts) {
    super(ttsInstance);
    this.#opts = opts;
  }

  async run() {
    const requestId = randomUUID();
    const segmentId = requestId;
    const byteStream = new AudioByteStream(this.#opts.sampleRate, 1);

    const url = `${API_BASE}/text-to-speech/${this.#opts.voiceId}/stream-input?model_id=${this.#opts.model}&output_format=mp3_44100_128`;
    const socket = new WebSocket(url, {
      headers: { "xi-api-key": this.#opts.apiKey },
    });

    const ffmpeg = spawn(
      ffmpegInstaller.path,
      ["-i", "pipe:0", "-f", "s16le", "-ar", String(this.#opts.sampleRate), "-ac", "1", "pipe:1"],
      { stdio: ["pipe", "pipe", "ignore"] },
    );

    let lastFrame;

    ffmpeg.stdout.on("data", (pcmChunk) => {
      const ab = pcmChunk.buffer.slice(
        pcmChunk.byteOffset,
        pcmChunk.byteOffset + pcmChunk.byteLength,
      );
      for (const frame of byteStream.write(ab)) {
        if (lastFrame)
          this.queue.put({ requestId, segmentId, frame: lastFrame, final: false });
        lastFrame = frame;
      }
    });

    const ffmpegDone = new Promise((resolve) => ffmpeg.on("close", resolve));

    const wsDone = new Promise((resolve) => {
      socket.on("message", (raw) => {
        const d = JSON.parse(raw.toString());
        if (d.audio && d.audio.length > 10 && ffmpeg.stdin.writable) {
          ffmpeg.stdin.write(Buffer.from(d.audio, "base64"));
        }
        if (d.isFinal) {
          if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
          resolve();
        }
      });
      socket.on("close", () => {
        if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
        resolve();
      });
      socket.on("error", () => {
        if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
        resolve();
      });
    });

    const abortHandler = () => {
      socket.close();
      if (ffmpeg.stdin.writable) ffmpeg.stdin.end();
    };
    this.abortSignal.addEventListener("abort", abortHandler, { once: true });

    await new Promise((res, rej) => {
      socket.once("open", res);
      socket.once("error", rej);
    });

    socket.send(
      JSON.stringify({
        text: " ",
        voice_settings: this.#opts.voiceSettings,
        generation_config: { chunk_length_schedule: [50, 80, 120, 150] },
      }),
    );

    for await (const data of this.input) {
      if (this.abortSignal.aborted) break;
      if (data === tts.SynthesizeStream.FLUSH_SENTINEL) {
        socket.send(JSON.stringify({ text: " ", flush: true }));
        continue;
      }
      const text = data.endsWith(" ") ? data : `${data} `;
      if (text.trim()) socket.send(JSON.stringify({ text }));
    }

    socket.send(JSON.stringify({ text: " ", flush: true }));
    socket.send(JSON.stringify({ text: "" }));

    await wsDone;
    await ffmpegDone;

    for (const frame of byteStream.flush()) {
      if (lastFrame)
        this.queue.put({ requestId, segmentId, frame: lastFrame, final: false });
      lastFrame = frame;
    }
    if (lastFrame)
      this.queue.put({ requestId, segmentId, frame: lastFrame, final: true });

    this.abortSignal.removeEventListener("abort", abortHandler);
    if (socket.readyState <= 1) socket.close();
  }
}

export class ElevenLabsTTS extends tts.TTS {
  label = "elevenlabs-mp3.TTS";
  #opts;

  constructor(opts = {}) {
    const apiKey = opts.apiKey ?? process.env.ELEVEN_API_KEY;
    if (!apiKey) throw new Error("Set ELEVEN_API_KEY");

    const sampleRate = opts.sampleRate ?? 24000;
    super(sampleRate, 1, { streaming: true });

    this.#opts = {
      apiKey,
      voiceId: opts.voiceId ?? "21m00Tcm4TlvDq8ikWAM",
      model: opts.model ?? "eleven_flash_v2_5",
      sampleRate,
      voiceSettings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        use_speaker_boost: true,
        speed: 1,
        ...(opts.voiceSettings ?? {}),
      },
    };
  }

  get model() {
    return this.#opts.model;
  }
  get provider() {
    return "elevenlabs";
  }

  synthesize() {
    throw new Error("Use stream() for ElevenLabs TTS");
  }
  stream() {
    return new ElevenLabsSynthesizeStream(this, this.#opts);
  }
}
