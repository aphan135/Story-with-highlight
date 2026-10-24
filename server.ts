/**
 * Story Quest — local server. Run with: bun run server.ts
 *
 * Browser tab holds the mic and the speaker. This process holds the API keys
 * and does Ink -> StoryEngine -> Sonic. Everything runs on one laptop; the
 * only traffic leaving it goes to Cartesia and Anthropic.
 *
 *   browser --PCM16 16k--> server --> Ink (turns)
 *                                      |  turn.end = the child stopped talking
 *                                      v
 *                                 StoryEngine.next()
 *                                      |
 *                                      v
 *   browser <--PCM16 24k-- server <-- Sonic
 *
 * .env:  CARTESIA_API_KEY=...  PIP_VOICE_ID=...  OWL_VOICE_ID=...
 */

import { StoryEngine, type Turn } from "./mockEngine";
import { ensureQuestion } from "./prompts";

const KEY = process.env.CARTESIA_API_KEY!;
const VERSION = "2026-03-01";
const VOICES = {
  pip: process.env.PIP_VOICE_ID!,
  owl: process.env.OWL_VOICE_ID!,
};

if (!KEY) throw new Error("CARTESIA_API_KEY missing — check .env");

// ---------------------------------------------------------------------------

type Session = {
  browser: WebSocket;
  ink: WebSocket;
  sonic: WebSocket;
  state: ReturnType<typeof StoryEngine.initial>;
  /** Set at turn.end, cleared when the first audio byte goes out. */
  turnEndedAt: number | null;
  speaking: boolean;
};

const sessions = new Map<WebSocket, Session>();

/** Ink 2 does semantic turn detection itself — no VAD threshold to tune. */
function openInk(session: Session) {
  const url =
    `wss://api.cartesia.ai/stt/turns/websocket` +
    `?model=ink-2&encoding=pcm_s16le&sample_rate=16000` +
    `&cartesia_version=${VERSION}&api_key=${KEY}`;

  const ink = new WebSocket(url);

  ink.onmessage = async (e) => {
    const msg = JSON.parse(e.data as string);

    switch (msg.type) {
      case "turn.start":
        // The child started talking. If a character is mid-sentence, this is
        // the barge-in signal: stop playback so they are not talked over.
        if (session.speaking) session.browser.send(JSON.stringify({ type: "stop_audio" }));
        break;

      case "turn.update":
        // Partial transcript. Useful for the operator screen, not for logic.
        session.browser.send(JSON.stringify({ type: "partial", text: msg.text }));
        break;

      case "turn.end":
        session.turnEndedAt = performance.now();
        await respond(session, msg.text ?? null);
        break;
    }
  };

  ink.onerror = (e) => console.error("[ink]", e);
  return ink;
}

function openSonic(session: Session) {
  const url =
    `wss://api.cartesia.ai/tts/websocket` +
    `?cartesia_version=${VERSION}&api_key=${KEY}`;

  const sonic = new WebSocket(url);

  sonic.onmessage = (e) => {
    const msg = JSON.parse(e.data as string);

    if (msg.type === "chunk") {
      if (session.turnEndedAt !== null) {
        const ms = Math.round(performance.now() - session.turnEndedAt);
        session.turnEndedAt = null;
        console.log(`[latency] child stopped -> first audio: ${ms}ms`);
        session.browser.send(JSON.stringify({ type: "latency", ms }));
      }
      session.speaking = true;
      session.browser.send(JSON.stringify({ type: "audio", data: msg.data }));
    }

    if (msg.type === "done") {
      session.speaking = false;
      session.browser.send(JSON.stringify({ type: "audio_done" }));
    }

    if (msg.type === "error") console.error("[sonic]", msg);
  };

  sonic.onerror = (e) => console.error("[sonic]", e);
  return sonic;
}

/** One child utterance in, one spoken character line out. */
async function respond(session: Session, childText: string | null) {
  const turn: Turn = await StoryEngine.next(childText, session.state);
  session.state = turn.state;

  // The prompt is told to end on a question; this is what actually guarantees it.
  const line = ensureQuestion(turn.line, session.state);

  session.browser.send(JSON.stringify({ type: "line", speaker: turn.speaker, line }));

  session.sonic.send(
    JSON.stringify({
      model_id: "sonic-3.5",
      transcript: line,
      voice: { mode: "id", id: VOICES[turn.speaker] },
      language: "en",
      context_id: crypto.randomUUID(),
      continue: false, // last chunk for this context — lowest latency
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
    })
  );
}

// ---------------------------------------------------------------------------

Bun.serve({
  port: 3000,

  fetch(req, server) {
    const { pathname } = new URL(req.url);
    if (pathname === "/ws") {
      return server.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    return new Response(Bun.file("./index.html"));
  },

  websocket: {
    open(ws) {
      const session: Session = {
        browser: ws as unknown as WebSocket,
        ink: null!,
        sonic: null!,
        state: StoryEngine.initial(),
        turnEndedAt: null,
        speaking: false,
      };
      session.ink = openInk(session);
      session.sonic = openSonic(session);
      sessions.set(ws as unknown as WebSocket, session);

      // Never open on silence: Owl speaks first, unprompted.
      session.sonic.addEventListener("open", () => respond(session, null), { once: true });
    },

    message(ws, data) {
      const session = sessions.get(ws as unknown as WebSocket);
      if (!session) return;
      // Binary frames are mic audio, straight through to Ink.
      if (session.ink.readyState === WebSocket.OPEN) session.ink.send(data);
    },

    close(ws) {
      const session = sessions.get(ws as unknown as WebSocket);
      session?.ink.close();
      session?.sonic.close();
      sessions.delete(ws as unknown as WebSocket);
    },
  },
});

console.log("Story Quest on http://localhost:3000");
