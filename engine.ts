/**
 * 진짜 StoryEngine. mockEngine.ts와 인터페이스가 완전히 동일하므로
 * server.ts의 import 한 줄만 바꾸면 교체된다.
 *
 *   import { StoryEngine } from "./mockEngine";  ->  "./engine"
 *
 * .env 추가: ANTHROPIC_API_KEY=...
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  OWL_SYSTEM,
  PIP_SYSTEM,
  buildTurnMessage,
  parseReply,
  ensureQuestion,
  pickFallback,
  initialState,
  type State,
} from "./prompts";

export type Turn = {
  speaker: "pip" | "owl";
  line: string;
  state: State;
  done: boolean;
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

/** 씬별로 누가 말하는지. 씬 그래프와 일치해야 한다. */
const SPEAKER: Record<number, "pip" | "owl"> = {
  1: "owl",
  2: "pip",
  3: "owl",
  4: "pip",
  5: "owl",
};

const TIMEOUT_MS = 3000;

export const StoryEngine = {
  initial: initialState,

  /**
   * @param onToken 구분자(---) 앞의 텍스트를 도착하는 대로 흘려보낸다.
   *                server.ts가 문장 단위로 Sonic에 보내고 싶을 때 쓴다.
   *                넘기지 않으면 전체를 받은 뒤 한 번에 반환한다.
   */
  async next(
    childText: string | null,
    state: State,
    onToken?: (text: string) => void
  ): Promise<Turn> {
    const speaker = SPEAKER[state.scene] ?? "owl";

    try {
      const { line, advance } = await withTimeout(
        generate(state, childText, speaker, onToken),
        TIMEOUT_MS
      );

      const next = applyAdvance(state, childText, advance);

      return {
        speaker,
        line: ensureQuestion(line, state),
        state: next,
        done: next.scene > 5,
      };
    } catch (err) {
      // 데모 중에 절대 죽으면 안 된다. 침묵 대신 캐릭터 대사를 돌려준다.
      console.error("[engine]", err);
      return {
        speaker: "owl",
        line: pickFallback("misheard"),
        state: { ...state, probedThisScene: true },
        done: false,
      };
    }
  },
};

// ---------------------------------------------------------------------------

async function generate(
  state: State,
  childText: string | null,
  speaker: "pip" | "owl",
  onToken?: (text: string) => void
): Promise<{ line: string; advance: boolean }> {
  const stream = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 150, // 두 문장을 넘기지 못하게. 레이턴시도 같이 내려간다.
    system: speaker === "pip" ? PIP_SYSTEM : OWL_SYSTEM,
    messages: [{ role: "user", content: buildTurnMessage(state, childText) }],
    stream: true,
  });

  let raw = "";
  let emitted = 0; // onToken으로 이미 내보낸 글자 수

  for await (const event of stream) {
    if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
    raw += event.delta.text;

    if (!onToken) continue;

    // 구분자가 나타나면 그 앞까지만 흘리고 멈춘다.
    const cut = raw.indexOf("---");
    const speakable = cut === -1 ? raw : raw.slice(0, cut);

    // 구분자가 반쯤 도착한 상태("-" 또는 "--")를 내보내지 않도록 꼬리를 남긴다.
    const safe = cut === -1 ? speakable.slice(0, Math.max(0, speakable.length - 2)) : speakable;

    if (safe.length > emitted) {
      onToken(safe.slice(emitted));
      emitted = safe.length;
    }
  }

  const parsed = parseReply(raw);

  // 꼬리로 남겨둔 글자가 있으면 마저 내보낸다.
  if (onToken && parsed.line.length > emitted) onToken(parsed.line.slice(emitted));

  return parsed;
}

/** 아이의 답이 씬 요건을 채웠을 때 state를 다음으로 옮긴다. */
function applyAdvance(state: State, childText: string | null, advance: boolean): State {
  if (!advance) return { ...state, probedThisScene: true };

  const said = (childText ?? "").trim();

  return {
    ...state,
    scene: (state.scene + 1) as State["scene"],
    probedThisScene: false,
    material: state.scene === 2 ? said : state.material,
    reason: state.scene === 3 ? said : state.reason,
    prediction: state.scene === 4 ? said : state.prediction,
    events: said ? [...state.events, said] : state.events,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}
