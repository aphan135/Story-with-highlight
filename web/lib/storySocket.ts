"use client";

// Browser side of ../server.ts. A port of the client in ../index.html: same
// messages, same audio handling. The server runs the story; this only carries
// the mic up and plays the voices back.
//
//   server -> page: scene, screen, line, lineMore, read, progress, stuck, readDone, end,
//                   foxy, partial, latency, audio, audio_done, stop_audio
//   page -> server: mic audio (binary PCM16 @16k), { type: "played", id }

export type Speaker = "narrator" | "firstPig" | "secondPig" | "wolf" | "foxy";

export type ServerMessage =
  | { type: "scene"; title: string; art: string; caption: string; image?: string }
  | { type: "screen"; art: string; caption: string; image?: string }
  | { type: "line"; id: string; speaker: Speaker; line: string; question: boolean }
  | { type: "lineMore"; id: string; text: string }
  | { type: "read"; words: string[] }
  | { type: "progress"; word: number }
  | { type: "stuck"; word: number }
  | { type: "readDone" }
  | { type: "foxy"; on: boolean }
  | { type: "end"; demo: boolean }
  | { type: "partial"; text: string }
  | { type: "latency"; ms: number };

const SEND_RATE = 16000; // Ink input
const PLAY_RATE = 24000; // Sonic output

/** Where server.ts listens. Set NEXT_PUBLIC_STORY_SERVER for a deployed server. */
export const STORY_SERVER = process.env.NEXT_PUBLIC_STORY_SERVER ?? "ws://localhost:3000/ws";

export function connectStory(opts: {
  demo: boolean;
  onMessage(msg: ServerMessage): void;
  /** Fires when the current line has finished playing in the speaker. */
  onPlayed(): void;
  onOpen(): void;
  onClose(clean: boolean): void;
}) {
  const ctx = new AudioContext({ sampleRate: PLAY_RATE });
  const ws = new WebSocket(`${STORY_SERVER}${opts.demo ? "?demo" : ""}`);
  ws.binaryType = "arraybuffer";

  let sources: AudioBufferSourceNode[] = [];
  let playingAt = 0;
  // Chunks still arriving after a barge-in belong to a muted generation.
  let generation = 0;
  let mutedGeneration = -1;
  // The line now playing. Its playback report goes back once, tagged with its id.
  let lineId: string | null = null;
  let lineDone = true;
  let reported = true;
  let closing = false;
  let mic: { stream: MediaStream; ctx: AudioContext } | null = null;

  function playChunk(b64: string) {
    if (generation === mutedGeneration) return;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const i16 = new Int16Array(bytes.buffer);
    const buf = ctx.createBuffer(1, i16.length, PLAY_RATE);
    const out = buf.getChannelData(0);
    for (let i = 0; i < i16.length; i++) out[i] = i16[i]! / 0x8000;

    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    playingAt = Math.max(playingAt, ctx.currentTime);
    node.start(playingAt);
    playingAt += buf.duration;
    sources.push(node);
    node.onended = () => {
      sources = sources.filter(s => s !== node);
      reportIfPlayed();
    };
  }

  // The server waits for this before the next line and starts its 5 s stuck
  // timer from it, so it must go exactly once per line, after the audio drains.
  function reportIfPlayed() {
    if (reported || !lineDone || sources.length > 0 || ws.readyState !== WebSocket.OPEN) return;
    reported = true;
    ws.send(JSON.stringify({ type: "played", id: lineId }));
    opts.onPlayed();
  }

  function stopAudio() {
    // Nothing playing: muting now would drop the next line before it starts.
    if (sources.length === 0) return;
    mutedGeneration = generation;
    sources.forEach(s => { try { s.stop(); } catch { /* already ended */ } });
    sources = [];
    playingAt = 0;
    reported = true; // the server already counts an interrupted line as over
  }

  ws.onopen = () => opts.onOpen();
  ws.onclose = () => opts.onClose(closing);
  ws.onmessage = e => {
    const msg = JSON.parse(e.data as string);
    switch (msg.type) {
      case "line":
        generation++;
        lineId = msg.id; lineDone = false; reported = false;
        break;
      case "audio": playChunk(msg.data); return;
      case "audio_done": playingAt = 0; lineDone = true; reportIfPlayed(); return;
      case "stop_audio": stopAudio(); return;
    }
    opts.onMessage(msg as ServerMessage);
  };

  // Mic -> PCM16 @16k. A separate context at the send rate lets the browser resample.
  void (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (closing) { stream.getTracks().forEach(t => t.stop()); return; }
      const micCtx = new AudioContext({ sampleRate: SEND_RATE });
      mic = { stream, ctx: micCtx };
      const node = micCtx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = e => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const f32 = e.inputBuffer.getChannelData(0);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]!));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(i16.buffer);
      };
      micCtx.createMediaStreamSource(stream).connect(node);
      node.connect(micCtx.destination);
    } catch {
      closing = true;
      ws.close();
      opts.onClose(false);
    }
  })();

  return {
    /** The playback context, for interface sounds. */
    audio: ctx,
    close() {
      closing = true;
      ws.close();
      stopAudio();
      mic?.stream.getTracks().forEach(t => t.stop());
      void mic?.ctx.close().catch(() => {});
      void ctx.close().catch(() => {});
    },
  };
}
