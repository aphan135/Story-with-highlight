/**
 * Story Quest — local server. Run with: bun run server.ts
 *
 * Browser tab holds the mic, the speaker and the book page. This process holds
 * the API keys and does Ink -> (Reader | StoryEngine) -> Sonic. Everything runs
 * on one laptop; the only traffic leaving it goes to Cartesia and Anthropic.
 *
 *   browser --PCM16 16k--> server --> Ink (turns)
 *                                      |
 *                     reading mode     |      asking mode
 *              Reader.feed(partials) <-+-> StoryEngine.next() at turn.end
 *              stuck 5s -> coachLine         (CROWD + PEER, unchanged)
 *                                      |
 *                                      v
 *   browser <--PCM16 24k-- server <-- Sonic
 *
 * .env:  CARTESIA_API_KEY=...  PIP_VOICE_ID=...  OWL_VOICE_ID=...
 */

import { StoryEngine, type Turn } from "./engine";
import { Reader } from "./reader";
import { STORY } from "./story";
import {
  READ_INTRO,
  THE_END,
  coachLine,
  dropFinalQuestion,
  pickReadOn,
  type State,
} from "./prompts";

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
  /** 현재 재생 중인 Sonic 컨텍스트. 바지인 시 버려진다. */
  contextId: string | null;
  /** 턴 일련번호. 응답 생성 중에 새 턴이 오면 옛 응답을 버린다. */
  turnSeq: number;

  /** reading: the child reads the page. asking: a checkpoint's scenes run. */
  mode: "reading" | "asking" | "done";
  reader: Reader;
  /** Scenes the current checkpoint runs through. */
  checkpoint: State["scene"][];
  /** Ink turns seen. The turn that finished a page is not an answer. */
  inkTurn: number;
  askingSinceTurn: number;
  /**
   * True from sending a line until the browser reports playback finished.
   * Only the browser knows when audio stops (see HANDOFF §3).
   */
  audioPlaying: boolean;
  audioAt: number;
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

  ink.onmessage = async (e) => {
    const msg = JSON.parse(e.data as string);

    console.log(`[ink] ${msg.type}`, msg.transcript ?? "");

    switch (msg.type) {
      case "turn.start":
        // 아이가 말하기 시작했다. 재생 중인지는 브라우저만 안다 —
        // Sonic은 대사 전체를 수백 ms 만에 보내지만 재생은 몇 초 걸리므로,
        // 서버의 speaking 플래그로 판단하면 거의 항상 false다.
        // 무조건 보내고, 재생 중이 아니면 브라우저가 알아서 무시한다.
        session.contextId = null;
        session.speaking = false;
        // Whatever was playing is stopped or its chunks are now dropped.
        session.audioPlaying = false;
        session.inkTurn++;
        session.reader.startTurn();
        send(session, { type: "stop_audio" });
        break;

      case "turn.update":
        // Partial transcript. In reading mode this is what lights words up
        // as the child says them, instead of waiting for the turn to end.
        send(session, { type: "partial", text: msg.transcript });
        if (session.mode === "reading") read(session, msg.transcript ?? "");
        break;

      case "turn.end":
        if (session.mode === "reading") {
          read(session, msg.transcript ?? "", true);
        } else if (session.mode === "asking" && session.inkTurn > session.askingSinceTurn) {
          session.turnEndedAt = performance.now();
          await askTurn(session, msg.transcript?.trim() || null);
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
      session.speaking = true;
      send(session, { type: "audio", data: msg.data });
    }

    if (msg.type === "done") {
      if (msg.context_id !== session.contextId) return;
      session.speaking = false;
      send(session, { type: "audio_done" });
    }

    if (msg.type === "error") console.error("[sonic]", msg);
  };

  sonic.onerror = (e) => console.error("[sonic]", e);
  return sonic;
}

/** Shows a line in the browser and sends it to Sonic in that character's voice. */
function speak(session: Session, speaker: "pip" | "owl", line: string) {
  send(session, { type: "line", speaker, line });

  const contextId = crypto.randomUUID();
  session.contextId = contextId;
  session.audioPlaying = true;
  session.audioAt = performance.now();

  session.sonic.send(
    JSON.stringify({
      model_id: "sonic-3.5",
      transcript: line,
      voice: { mode: "id", id: VOICES[speaker] },
      language: "en",
      context_id: contextId,
      continue: false, // last chunk for this context — lowest latency
      output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 },
    })
  );
}

// ---------------------------------------------------------------------------
// Reading mode

function showPage(session: Session) {
  const r = session.reader;
  send(session, { type: "mode", mode: "reading" });
  send(session, { type: "page", page: r.page, total: STORY.length, words: r.words });
}

function read(session: Session, transcript: string, final = false) {
  const r = session.reader;

  if (r.feed(transcript)) {
    send(session, { type: "progress", word: r.word });
    if (r.pageDone) finishPage(session);
    return;
  }

  // The child tried the coached word and missed: say it again now rather
  // than make them sit through another five seconds.
  if (final && r.stuck && !session.audioPlaying) coach(session);
}

/** Owl reads the stuck word aloud. Repeats until the child says it back. */
function coach(session: Session) {
  const r = session.reader;
  const tries = r.coach();
  console.log(`[read] stuck on "${r.target}" (try ${tries})`);
  send(session, { type: "stuck", word: r.word });
  speak(session, "owl", coachLine(r.target, tries));
}

function finishPage(session: Session) {
  const ask = STORY[session.reader.page]?.ask;
  if (ask?.length) startQuestions(session, ask);
  else nextPage(session);
}

function endStory(session: Session, lead = "") {
  session.mode = "done";
  send(session, { type: "end" });
  speak(session, "owl", `${lead} ${THE_END}`.trim());
}

function nextPage(session: Session) {
  const r = session.reader;
  if (r.lastPage) return endStory(session);
  r.nextPage();
  session.mode = "reading";
  showPage(session);
  // The child may have read straight on past the last word of the old page.
  if (r.lastTranscript) read(session, r.lastTranscript);
}

// Stall timer. Counts only while nobody is talking to the child.
setInterval(() => {
  const now = performance.now();
  for (const session of sessions.values()) {
    // A line whose playback report never came back must not freeze the timer.
    if (session.audioPlaying && now - session.audioAt > 20_000) session.audioPlaying = false;
    if (session.mode !== "reading" || session.audioPlaying) continue;
    if (session.reader.isStalled(now)) coach(session);
  }
}, 250);

// ---------------------------------------------------------------------------
// Asking mode — the existing Pip & Owl dialogue, run as a checkpoint

function startQuestions(session: Session, scenes: State["scene"][]) {
  session.mode = "asking";
  session.checkpoint = scenes;
  // The turn that read the last word is still open; its turn.end is reading,
  // not an answer.
  session.askingSinceTurn = session.inkTurn;
  session.reader.startTurn();
  session.state = { ...session.state, scene: scenes[0]!, probedThisScene: false };
  send(session, { type: "mode", mode: "asking" });
  askTurn(session, null);
}

/** One child answer in, one spoken character line out. */
async function askTurn(session: Session, childText: string | null) {
  // 엔진 호출은 1초 넘게 걸린다. 그 사이 아이가 또 말하면 이 응답은 낡은 것이므로
  // 버린다. 없으면 두 대사가 동시에 Sonic으로 가서 겹쳐 들린다.
  const seq = ++session.turnSeq;
  const last = session.checkpoint.at(-1)!;
  const before = session.state.scene;

  let turn: Turn = await StoryEngine.next(childText, session.state);
  if (seq !== session.turnSeq) {
    console.log(`[skip] 턴 ${seq} 폐기 — 그 사이 새 발화가 들어왔다`);
    return;
  }

  // Pip only creates the need. Once the child answers him, Owl takes that
  // same answer for the next scene ("Bricks! Why bricks?") instead of Pip
  // asking his question a second time.
  if (turn.speaker === "pip" && turn.state.scene > before && turn.state.scene <= last) {
    turn = await StoryEngine.next(childText, turn.state);
    if (seq !== session.turnSeq) return;
  }

  session.state = turn.state;
  console.log(`[engine] scene=${turn.state.scene} ${turn.speaker}: ${turn.line}`);

  if (turn.state.scene <= last) {
    // 질문 보장과 예/아니오 차단은 엔진 안에서 이미 적용됐다.
    speak(session, turn.speaker, turn.line);
    return;
  }

  // Checkpoint satisfied. Keep Owl's evaluate-and-expand, drop his next
  // question — the book answers it.
  const lead = turn.speaker === "owl" ? dropFinalQuestion(turn.line) : "";
  if (session.reader.lastPage) return endStory(session, lead);
  nextPage(session);
  speak(session, turn.speaker, `${lead} ${pickReadOn(turn.speaker)}`.trim());
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
        contextId: null,
        turnSeq: 0,
        mode: "reading",
        reader: new Reader(STORY),
        checkpoint: [],
        inkTurn: 0,
        askingSinceTurn: 0,
        audioPlaying: false,
        audioAt: 0,
      };
      session.ink = openInk(session);
      session.sonic = openSonic(session);
      sessions.set(ws as unknown as WebSocket, session);

      // Never open on silence: Owl speaks first, then the first page opens.
      session.sonic.addEventListener(
        "open",
        () => {
          showPage(session);
          speak(session, "owl", READ_INTRO);
        },
        { once: true }
      );
    },

    message(ws, data) {
      const session = sessions.get(ws as unknown as WebSocket);
      if (!session) return;

      // Text frames are control messages from the page.
      if (typeof data === "string") {
        const msg = JSON.parse(data);
        if (msg.type === "played") {
          session.audioPlaying = false;
          session.reader.restartClock();
        }
        return;
      }

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
