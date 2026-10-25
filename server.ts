/**
 * Story Quest — local server. Run with: bun run server.ts
 *
 * Browser tab holds the mic, the speaker and the picture book. This process
 * holds the API keys, walks the script in story.ts, and does Ink -> Sonic.
 * Everything runs on one laptop; the only traffic leaving it goes to
 * Cartesia and Anthropic.
 *
 *   browser --PCM16 16k--> server --> Ink (turns)
 *                                      |
 *          READ ALOUD: Reader.feed(partials), stuck 5 s -> narrator says the word
 *          FREE RESPONSE: turn.end -> questions.ts
 *                                      |
 *                                      v
 *   browser <--PCM16 24k-- server <-- Sonic (four voices, optional Foxy voice)
 *
 * .env:  CARTESIA_API_KEY=...  NARRATOR_VOICE_ID=...  FIRST_PIG_VOICE_ID=...
 *        SECOND_PIG_VOICE_ID=...  WOLF_VOICE_ID=...  (ANTHROPIC_API_KEY=...)
 *        FOXY_VOICE_ID=... (optional, falls back to the narrator voice)
 *
 * Open http://localhost:3000/?demo to stop where the short demo stops.
 */

import { Reader } from "./reader";
import { SCRIPT, type Speaker } from "./story";
import { QUESTIONS, type Talk } from "./questions";
import { coachLine } from "./prompts";
import { WAKE, DONE, afterWake, askFoxy } from "./foxy";

const KEY = process.env.CARTESIA_API_KEY!;
const VERSION = "2026-03-01";
/**
 * 캐릭터별 말 속도. 1.0 이 기본이고 0.6~1.5 범위다. 문서상 엄밀한 배수가
 * 아니라 가이드라서, 확실히 느리게 하려면 크게 낮춰야 한다.
 * 내레이터는 아이가 이야기를 따라올 수 있어야 하므로 가장 느리다.
 */
const SPEED: Record<Speaker, number> = {
  narrator: 0.65,
  firstPig: 0.8,
  secondPig: 0.8,
  wolf: 0.7,
  foxy: 0.9,
};

/**
 * 캐릭터별 음량. 1.0 이 기본이고 0.5~2.0 범위다. 속도처럼 엄밀한 배수가
 * 아니라 가이드다. 돼지 목소리가 내레이터보다 훨씬 작게 들려서 올렸다 —
 * 리허설 때 들어 보고 여기서 맞춘다.
 */
const VOLUME: Record<Speaker, number> = {
  narrator: 1.0,
  firstPig: 2.0,
  secondPig: 2.0,
  wolf: 1.0,
  foxy: 1.0,
};

const VOICES: Record<Speaker, string> = {
  narrator: process.env.NARRATOR_VOICE_ID!,
  firstPig: process.env.FIRST_PIG_VOICE_ID!,
  secondPig: process.env.SECOND_PIG_VOICE_ID!,
  wolf: process.env.WOLF_VOICE_ID!,
  foxy: process.env.FOXY_VOICE_ID || process.env.NARRATOR_VOICE_ID!,
};

if (!KEY) throw new Error("CARTESIA_API_KEY missing — check .env");
const missing = Object.entries(VOICES).filter(([, id]) => !id).map(([who]) => who);
if (missing.length) throw new Error(`Voice IDs missing for: ${missing.join(", ")} — check .env`);

/** FREE RESPONSE: this long with nothing said counts as "unsure". */
const SILENCE_MS = 8000;

// ---------------------------------------------------------------------------

type Session = {
  /** 진단용: 브라우저에서 오디오가 한 번이라도 도착했는가. */
  sawAudio?: boolean;
  /** 보이스 오류로 내레이터 목소리로 재시도 중인가. */
  retrying?: boolean;
  /** 재시도에 쓸 마지막 대사. */
  lastLine?: string;
  browser: WebSocket;
  ink: WebSocket;
  sonic: WebSocket;
  demo: boolean;
  closed: boolean;
  /**
   * idle: narration, only Foxy's wake words are heard.
   * reading: a READ ALOUD bubble is up. listening: a FREE RESPONSE is open.
   */
  mode: "idle" | "reading" | "listening" | "foxy";
  foxyPrev: "idle" | "reading" | "listening";
  foxyWaiters: (() => void)[];
  cutByFoxy: string | null;
  foxyNudged: boolean;
  /** The Ink turn generating a reply, or null when Foxy is free. */
  foxyThinking: number | null;
  foxyWakeTurn: number;
  foxyHistory: Parameters<typeof askFoxy>[0];
  storySoFar: string[];
  lastAsk: { speaker: Speaker; line: string } | null;
  /** Set at turn.end, cleared when the first audio byte goes out. */
  turnEndedAt: number | null;
  /** 현재 재생 중인 Sonic 컨텍스트. 바지인 시 버려진다. */
  contextId: string | null;
  /**
   * True from sending a line until the browser reports it finished playing.
   * Only the browser knows when audio stops (see HANDOFF §3).
   */
  audioPlaying: boolean;
  audioAt: number;
  onPlayed: (() => void) | null;
  reader: Reader | null;
  onRead: (() => void) | null;
  onAnswer: ((text: string | null) => void) | null;
  waitingSince: number;
  childTalking: boolean;
  /** Ink turns seen. A turn still open when a bubble is finished is not an answer. */
  inkTurn: number;
  ignoreTurn: number;
};

const sessions = new Map<WebSocket, Session>();

const send = (session: Session, msg: object) => session.browser.send(JSON.stringify(msg));

/** Ink 2 does semantic turn detection itself — no VAD threshold to tune. */
function openInk(session: Session) {
  const url =
    `wss://api.cartesia.ai/stt/turns/websocket` +
    `?model=ink-2&encoding=pcm_s16le&sample_rate=16000` +
    `&cartesia_version=${VERSION}&api_key=${KEY}`;

  const ink = new WebSocket(url);

  ink.onmessage = (e) => {
    const msg = JSON.parse(e.data as string);

    console.log(`[ink] ${msg.type}`, msg.transcript ?? "");

    switch (msg.type) {
      case "turn.start":
        session.inkTurn++;
        session.childTalking = true;
        if (session.mode === "reading") session.reader?.startTurn();
        if (session.mode === "foxy") session.foxyThinking = null;
        // Barge-in only when it is the child's turn. Narration and the wolf
        // play through, so a chatty child does not skip the story.
        if (session.mode !== "idle") interrupt(session);
        break;

      case "turn.update":
        // Partial transcript. While reading, this is what lights words up
        // as the child says them, instead of waiting for the turn to end.
        send(session, { type: "partial", text: msg.transcript });
        if (session.mode === "foxy") break;
        if (WAKE.test(msg.transcript ?? "") && !DONE.test(msg.transcript ?? "") &&
          !(/foxy/i.test(session.lastLine ?? "") && (session.audioPlaying || performance.now() - session.waitingSince < 2000))) {
          startFoxy(session);
          break;
        }
        if (session.mode === "reading") read(session, msg.transcript ?? "");
        break;

      case "turn.end":
        session.childTalking = false;
        if (session.mode === "foxy") {
          if (DONE.test(msg.transcript ?? "")) void endFoxy(session);
          else void foxyAnswer(session, msg.transcript ?? "");
          break;
        }
        if (WAKE.test(msg.transcript ?? "") && !DONE.test(msg.transcript ?? "") &&
          !(/foxy/i.test(session.lastLine ?? "") && (session.audioPlaying || performance.now() - session.waitingSince < 2000))) {
          startFoxy(session);
          void foxyAnswer(session, msg.transcript ?? "");
          break;
        }
        if (session.inkTurn === session.ignoreTurn) break;
        if (session.mode === "reading") read(session, msg.transcript ?? "", true);
        else if (session.mode === "listening") {
          session.turnEndedAt = performance.now();
          answer(session, msg.transcript?.trim() || null);
        }
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
      // 버려진 컨텍스트의 잔여 청크는 무시한다.
      if (msg.context_id !== session.contextId) return;

      if (session.turnEndedAt !== null) {
        const ms = Math.round(performance.now() - session.turnEndedAt);
        session.turnEndedAt = null;
        console.log(`[latency] child stopped -> first audio: ${ms}ms`);
        send(session, { type: "latency", ms });
      }
      send(session, { type: "audio", data: msg.data });
    }

    if (msg.type === "done") {
      if (msg.context_id !== session.contextId) return;
      send(session, { type: "audio_done" });
    }

    if (msg.type === "error") {
      if (msg.context_id && msg.context_id !== session.contextId) return;
      console.error("[sonic]", msg.error_code ?? "", msg.message ?? "");

      // 보이스 ID가 틀리면 그 대사가 통째로 사라진다. 데모 중에 캐릭터가
      // 말없이 넘어가느니 내레이터 목소리로라도 들려주는 편이 낫다.
      if (session.contextId && msg.context_id === session.contextId && !session.retrying && session.lastLine) {
        session.retrying = true;
        console.log("[sonic] 내레이터 목소리로 다시 시도");
        sendToSonic(session, VOICES.narrator, session.lastLine, session.contextId, SPEED.narrator, VOLUME.narrator);
        return;
      }

      // 재시도까지 실패했다. 기다리던 쪽을 풀어줘야 이야기가 멈추지 않는다.
      played(session);
    }
  };

  sonic.onerror = (e) => console.error("[sonic]", e);
  return sonic;
}

// ---------------------------------------------------------------------------
// Speaking

/** Speaks one line in that character's voice. Resolves when it has finished playing. */
async function say(session: Session, speaker: Speaker, line: string, question = false): Promise<void> {
  await untilFoxyGone(session);
  if (session.closed) return;
  if (speaker !== "foxy") session.storySoFar.push(line);
  while (!session.closed) {
    await untilFoxyGone(session);
    const id = await speak(session, speaker, line, question);
    if (id && session.cutByFoxy === id) {
      session.cutByFoxy = null;
      continue;
    }
    await untilFoxyGone(session);
    return;
  }
}

/** Resolves with the utterance id after playback, including an interrupted line. */
function speak(session: Session, speaker: Speaker, line: string, question = false): Promise<string | null> {
  if (session.closed) return Promise.resolve(null);
  console.log(`[say] ${speaker}: ${line}`);

  // Lines play one at a time; a line cut short releases whoever waited on it.
  played(session);

  const contextId = crypto.randomUUID();
  session.contextId = contextId;
  session.audioPlaying = true;
  session.audioAt = performance.now();
  send(session, { type: "line", id: contextId, speaker, line, question });

  session.lastLine = line;
  session.retrying = false;
  sendToSonic(session, VOICES[speaker], line, contextId, SPEED[speaker], VOLUME[speaker]);

  return new Promise((resolve) => (session.onPlayed = () => resolve(contextId)));
}

function sendToSonic(
  session: Session,
  voiceId: string,
  line: string,
  contextId: string,
  speed: number,
  volume: number
) {
  session.sonic.send(
    JSON.stringify({
      model_id: "sonic-3.5",
      transcript: line,
      voice: { mode: "id", id: voiceId },
      language: "en",
      generation_config: { speed, volume },
      context_id: contextId,
      continue: false, // last chunk for this context — lowest latency
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
    })
  );
}

/** 대사 사이의 쉼. 책을 읽어줄 때처럼 한 박자 두고 넘어간다. */
const BEAT_MS = 700;

/** The current line is over, whether it finished or was cut off. */
function played(session: Session, pause = false) {
  session.audioPlaying = false;
  session.waitingSince = performance.now();
  session.reader?.restartClock();
  const resolve = session.onPlayed;
  session.onPlayed = null;
  if (!resolve) return;
  // 끊고 들어온 경우(pause=false)는 기다리지 않는다. 아이가 말하는 중이다.
  if (pause) setTimeout(resolve, BEAT_MS);
  else resolve();
}

/** The child started talking over a line: stop it. */
function interrupt(session: Session) {
  // 재생 중인지는 브라우저만 안다. 무조건 보내고, 재생 중이 아니면
  // 브라우저가 알아서 무시한다. 남은 청크는 contextId로 버린다.
  session.contextId = null;
  send(session, { type: "stop_audio" });
  played(session);
}

// ---------------------------------------------------------------------------
// Foxy

function untilFoxyGone(session: Session): Promise<void> {
  if (session.mode !== "foxy" || session.closed) return Promise.resolve();
  return new Promise((resolve) => session.foxyWaiters.push(resolve));
}

function startFoxy(session: Session) {
  if (session.mode === "foxy" || session.closed) return;
  session.foxyPrev = session.mode;
  session.mode = "foxy";
  session.cutByFoxy = session.audioPlaying ? session.contextId : null;
  session.foxyWakeTurn = session.inkTurn;
  session.foxyThinking = null;
  session.foxyNudged = false;
  interrupt(session);
  send(session, { type: "foxy", on: true });
}

async function foxyAnswer(session: Session, text: string) {
  const turn = session.inkTurn;
  const question = session.foxyWakeTurn === turn ? afterWake(text) : text.trim();
  // Only the wake turn earns a greeting; an empty or noise-only turn later is ignored.
  if (!question && session.foxyWakeTurn !== turn) return;
  session.foxyThinking = turn;
  session.foxyNudged = false;
  session.turnEndedAt = performance.now();
  const history = [...session.foxyHistory];
  const line = question ? await askFoxy(history, session.storySoFar, question) : "Hi! What's your question?";
  if (session.closed || session.mode !== "foxy" || session.foxyThinking !== turn) return;
  session.foxyHistory = history;
  await speak(session, "foxy", line);
  if (session.foxyThinking === turn) session.foxyThinking = null;
}

async function endFoxy(session: Session, bye = "Okay! Back to the story!") {
  const turn = session.inkTurn;
  session.foxyThinking = turn;
  await speak(session, "foxy", bye);
  // Not cancellable: a sound over the goodbye must not leave the story paused.
  if (session.closed || session.mode !== "foxy") return;
  session.foxyThinking = null;
  send(session, { type: "foxy", on: false });
  session.mode = session.foxyPrev;
  session.waitingSince = performance.now();
  session.reader?.restartClock();
  if (session.foxyPrev === "listening" && session.lastAsk) {
    void speak(session, session.lastAsk.speaker, session.lastAsk.line, true);
  }
  session.foxyWaiters.splice(0).forEach((resolve) => resolve());
}

// ---------------------------------------------------------------------------
// READ ALOUD

async function readAloud(session: Session, line: string): Promise<void> {
  await untilFoxyGone(session);
  if (session.closed) return;
  const reader = new Reader([{ words: line.split(/\s+/).filter(Boolean) }]);
  session.reader = reader;
  session.mode = "reading";
  send(session, { type: "read", words: reader.words });
  return new Promise((resolve) => (session.onRead = resolve));
}

function read(session: Session, transcript: string, final = false) {
  const r = session.reader;
  if (!r) return;

  if (r.feed(transcript)) {
    send(session, { type: "progress", word: r.word });
    if (r.pageDone) {
      session.mode = "idle";
      session.reader = null;
      // The child is still finishing the sentence; that turn is not an answer.
      if (session.childTalking) session.ignoreTurn = session.inkTurn;
      send(session, { type: "readDone" });
      const resolve = session.onRead;
      session.onRead = null;
      resolve?.();
    }
    return;
  }

  // The child tried the coached word and missed: say it again now rather
  // than make them sit through another five seconds.
  if (final && r.stuck && !session.audioPlaying) coach(session);
}

/** The narrator reads the stuck word. Repeats until the child says it back. */
function coach(session: Session) {
  const r = session.reader!;
  const tries = r.coach();
  console.log(`[read] stuck on "${r.target}" (try ${tries})`);
  send(session, { type: "stuck", word: r.word });
  say(session, "narrator", coachLine(r.target, tries));
}

// ---------------------------------------------------------------------------
// FREE RESPONSE

/** Asks a question and resolves with the answer, or null after SILENCE_MS. */
async function ask(session: Session, speaker: Speaker, line: string): Promise<string | null> {
  await untilFoxyGone(session);
  if (session.closed) return null;
  session.lastAsk = { speaker, line };
  // Listen before speaking, so an answer that talks over the question counts.
  const heard = new Promise<string | null>((resolve) => (session.onAnswer = resolve));
  session.mode = "listening";
  await say(session, speaker, line, true);
  session.waitingSince = performance.now();
  const text = await heard;
  console.log(`[answer] ${JSON.stringify(text)}`);
  return text;
}

function answer(session: Session, text: string | null) {
  session.mode = "idle";
  const resolve = session.onAnswer;
  session.onAnswer = null;
  resolve?.(text);
}

// ---------------------------------------------------------------------------
// The timer: stuck words and silent answers. Counts only while no voice is
// playing.

setInterval(() => {
  const now = performance.now();
  for (const session of sessions.values()) {
    // A line whose playback report never came back must not freeze the story.
    if (session.audioPlaying && now - session.audioAt > 20_000) played(session);
    if (session.audioPlaying) continue;

    if (session.mode === "foxy") {
      if (!session.childTalking && session.foxyThinking === null && now - session.waitingSince > 10_000) {
        if (session.foxyNudged) void endFoxy(session, "Okay, back to the story!");
        else {
          session.foxyNudged = true;
          void speak(session, "foxy", "Any other questions?");
        }
      }
      continue;
    }

    if (session.mode === "reading" && session.reader?.isStalled(now)) coach(session);

    if (
      session.mode === "listening" &&
      !session.childTalking &&
      now - session.waitingSince > SILENCE_MS
    ) {
      answer(session, null);
    }
  }
}, 250);

// ---------------------------------------------------------------------------
// The story

async function runStory(session: Session) {
  const talk: Talk = {
    say: (speaker, line) => say(session, speaker, line),
    ask: (speaker, line) => ask(session, speaker, line),
  };

  for (const step of SCRIPT) {
    await untilFoxyGone(session);
    if (session.closed) return;
    switch (step.kind) {
      case "scene":
      case "screen":
        send(session, step.kind === "scene" ? { type: "scene", ...step } : { type: "screen", ...step });
        break;
      case "say":
        await say(session, step.speaker, step.line);
        break;
      case "read":
        await readAloud(session, step.line);
        break;
      case "ask":
        await QUESTIONS[step.question](talk);
        break;
      case "demoStop":
        if (session.demo) {
          send(session, { type: "end", demo: true });
          return;
        }
        break;
    }
  }
  await untilFoxyGone(session);
  if (session.closed) return;
  send(session, { type: "end", demo: false });
}

// ---------------------------------------------------------------------------

Bun.serve<{ demo: boolean }, never>({
  port: 3000,

  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const demo = url.searchParams.has("demo");
      return server.upgrade(req, { data: { demo } })
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    }
    return new Response(Bun.file("./index.html"));
  },

  websocket: {
    open(ws) {
      const session: Session = {
        browser: ws as unknown as WebSocket,
        ink: null!,
        sonic: null!,
        demo: ws.data.demo,
        closed: false,
        mode: "idle",
        foxyPrev: "idle",
        foxyWaiters: [],
        cutByFoxy: null,
        foxyNudged: false,
        foxyThinking: null,
        foxyWakeTurn: -1,
        foxyHistory: [],
        storySoFar: [],
        lastAsk: null,
        turnEndedAt: null,
        contextId: null,
        audioPlaying: false,
        audioAt: 0,
        onPlayed: null,
        reader: null,
        onRead: null,
        onAnswer: null,
        waitingSince: 0,
        childTalking: false,
        inkTurn: 0,
        ignoreTurn: -1,
      };
      session.ink = openInk(session);
      session.sonic = openSonic(session);
      sessions.set(ws as unknown as WebSocket, session);

      session.sonic.addEventListener(
        "open",
        () => runStory(session).catch((err) => console.error("[story]", err)),
        { once: true }
      );
    },

    message(ws, data) {
      const session = sessions.get(ws as unknown as WebSocket);
      if (!session) return;

      // Text frames are control messages from the page.
      if (typeof data === "string") {
        const msg = JSON.parse(data);
        // Only the line still current counts; a late report for an older one is ignored.
        // 재생이 실제로 끝난 경우에만 한 박자 쉬고 다음으로 간다.
        if (msg.type === "played" && msg.id === session.contextId) played(session, true);
        return;
      }

      // 진단용: 마이크 소리가 실제로 도착하는지 한 번만 찍는다.
      if (!session.sawAudio) {
        session.sawAudio = true;
        console.log("[mic] 오디오 수신 시작 — 브라우저 마이크는 살아 있음");
      }

      // Binary frames are mic audio, straight through to Ink.
      if (session.ink.readyState === WebSocket.OPEN) session.ink.send(data);
    },

    close(ws) {
      const session = sessions.get(ws as unknown as WebSocket);
      if (session) {
        session.closed = true;
        played(session);
        session.foxyWaiters.splice(0).forEach((resolve) => resolve());
        session.onRead?.();
        session.onAnswer?.(null);
      }
      session?.ink.close();
      session?.sonic.close();
      sessions.delete(ws as unknown as WebSocket);
    },
  },
});

console.log("Story Quest on http://localhost:3000  (short demo: /?demo)");
