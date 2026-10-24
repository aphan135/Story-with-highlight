/**
 * 진짜 StoryEngine. mockEngine.ts와 인터페이스가 같으므로
 * server.ts의 import 한 줄만 바꾸면 교체된다.
 *
 * 가이드라인에 따른 구조:
 *   Owl  — 모델 호출. PEER(평가→확장→재질문)와 CROWD 질문 생성을 맡는다.
 *   Pip  — 템플릿. 모델을 부르지 않으므로 씬 2·4는 레이턴시가 0에 가깝다.
 *
 * CROWD 유형과 난이도는 코드가 정해서 프롬프트에 넣는다. 모델에게 고르게
 * 두면 Open-ended/Wh- 쪽으로 쏠린다는 것이 연구의 지적이다.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  OWL_SYSTEM,
  answerLevel,
  buildTurnMessage,
  crowdFor,
  ensureQuestion,
  extractKeyword,
  initialState,
  parseReply,
  pickFallback,
  pipLine,
  sceneSpeaker,
  type State,
} from "./prompts";

export type Turn = {
  speaker: "pip" | "owl";
  line: string;
  state: State;
  done: boolean;
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const TIMEOUT_MS = 4500;

export const StoryEngine = {
  initial: initialState,

  /**
   * @param onToken LINE: 뒤의 텍스트를 도착하는 대로 흘려보낸다.
   *                server.ts가 문장 단위로 Sonic에 보낼 때 쓴다.
   */
  async next(
    childText: string | null,
    state: State,
    onToken?: (text: string) => void
  ): Promise<Turn> {
    const speaker = sceneSpeaker(state.scene);
    const level = answerLevel(childText);
    const crowd = crowdFor(state.scene, level);

    // --- Pip: 모델을 부르지 않는다 -----------------------------------------
    // 그는 상황과 정서를 담당하고, 가르치는 일은 Owl이 한다.
    if (speaker === "pip") {
      const advance = level !== "silent";
      const next = applyAdvance(state, childText, advance);
      const line = pipLine(state, childText);
      onToken?.(line);
      return { speaker: "pip", line, state: next, done: next.scene > 5 };
    }

    // --- Owl: PEER 한 수 ----------------------------------------------------
    try {
      const { line, advance } = await withTimeout(
        generate(state, childText, crowd, level, onToken),
        TIMEOUT_MS
      );

      const next = applyAdvance(state, childText, advance);

      return {
        speaker: "owl",
        line: ensureQuestion(line, state, crowd),
        state: next,
        done: next.scene > 5,
      };
    } catch (err) {
      // 데모 중에 절대 죽으면 안 된다. 침묵 대신 캐릭터 대사를 돌려준다.
      console.error("[engine]", err);
      return {
        speaker: "owl",
        line: pickFallback(level === "silent" ? "silence" : "misheard"),
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
  crowd: ReturnType<typeof crowdFor>,
  level: ReturnType<typeof answerLevel>,
  onToken?: (text: string) => void
): Promise<{ line: string; advance: boolean }> {
  // 스트리밍을 쓰지 않는다. 델타 종류(text/thinking)에 따라 본문을 통째로
  // 놓치는 문제가 있었고, server.ts가 아직 onToken을 쓰지 않으므로
  // 잃는 것이 없다. 문장 단위 전송은 이것이 안정된 뒤에 올린다.
  const res = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 400, // 넉넉히. LINE: 뒤만 읽으므로 여분 토큰은 아이에게 닿지 않는다.
    system: OWL_SYSTEM,
    messages: [
      { role: "user", content: buildTurnMessage(state, childText, crowd, level) },
    ],
  });

  const raw = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!raw.trim()) {
    console.log(
      `[raw-empty] stop=${res.stop_reason} blocks=${JSON.stringify(res.content.map((b) => b.type))}`
    );
  } else {
    console.log(`[raw] crowd=${crowd} level=${level} ${JSON.stringify(raw)}`);
  }

  const parsed = parseReply(raw);
  onToken?.(parsed.line);
  return parsed;
}

/** 아이의 답이 씬 요건을 채웠을 때 state를 다음으로 옮긴다. */
function applyAdvance(state: State, childText: string | null, advance: boolean): State {
  if (!advance) return { ...state, probedThisScene: true };

  const said = (childText ?? "").trim();
  const keyword = extractKeyword(childText);

  return {
    ...state,
    scene: (state.scene + 1) as State["scene"],
    probedThisScene: false,
    // 아이가 고른 재료는 키워드만 뽑아 둔다. Pip의 대사 슬롯과 콜백에 쓰인다.
    material: state.scene === 2 ? keyword ?? state.material : state.material,
    reason: state.scene === 3 ? said || state.reason : state.reason,
    prediction: state.scene === 4 ? said || state.prediction : state.prediction,
    events: said ? [...state.events, said] : state.events,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}
