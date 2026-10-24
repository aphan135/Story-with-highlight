/**
 * StoryEngine. Same interface as mockEngine.ts — server.ts imports one or the
 * other — plus a structured `meta` on every turn.
 *
 *   Owl  — Claude, in scenes 3 and 5 only: judging whether the child gave a
 *          reason / retold the night, and writing the PEER follow-up.
 *   Pip  — templates. Scenes 1, 2, 4 and every transition are model-free, so
 *          the session opens instantly and most turns cost no latency.
 *   Code — owns the CROWD type, scene advancement limits, the story fork,
 *          input screening and output screening. The model proposes; code
 *          disposes.
 *
 * If the model fails, times out, or returns something unusable, the turn is
 * still answered in character by code (`source: "offline"`), and the story
 * still moves.
 */

import {
  OWL_SYSTEM,
  answerLevel,
  buildTurnMessage,
  completesThought,
  crowdFor,
  ensureQuestion,
  initialState,
  isOpenQuestionLine,
  parseReply,
  type AnswerLevel,
  type Crowd,
  type State,
} from "./prompts";
import { MODEL_LIMITS, TEMPLATE_LIMITS, screenInput, screenOutput } from "./safety";
import {
  MODEL_SCENES,
  afterEndLine,
  applyTurn,
  closingLine,
  decide,
  interpret,
  offlineOwl,
  openerLine,
  pipChoiceOpening,
  pipReask,
  predictionOpening,
  reask,
  reasonOpening,
  redirectLine,
  wolfLine,
  type Line,
  type Speaker,
} from "./story";

export type TurnMeta = {
  scene: { from: number; to: number };
  advanced: boolean;
  /** Moved on because the child was stuck, not because they answered. */
  forced: boolean;
  level: AnswerLevel;
  /** null when no question type applied (templates, redirects). */
  crowd: Crowd | null;
  source: "template" | "model" | "offline";
  /** Machine-readable notes: "input:distress", "model_failed", "line_repaired", ... */
  flags: string[];
  /** Set when the child said something a grown-up should hear about. */
  tellAdult: boolean;
  slots: {
    material?: string;
    reason?: string;
    prediction?: string;
    outcome?: "holds" | "falls";
  };
  ms: number;
};

export type Turn = {
  speaker: "pip" | "owl";
  line: string; // ends in "?" except the post-story goodbye
  state: State;
  done: boolean;
  /** Optional so mockEngine.ts stays assignable to this type. */
  meta?: TurnMeta;
};

export type Completion = (system: string, user: string) => Promise<string>;

export type EngineDeps = {
  complete?: Completion;
  timeoutMs?: number;
};

const slotsOf = (s: State): TurnMeta["slots"] => ({
  material: s.material,
  reason: s.reason,
  prediction: s.prediction,
  outcome: s.outcome,
});

export function createEngine(deps: EngineDeps = {}) {
  const timeoutMs = deps.timeoutMs ?? 4500;
  const complete: Completion =
    deps.complete ?? (async (system, user) => (await import("./llm")).completeOwl(system, user));

  return {
    initial: initialState,

    /**
     * @param onToken Called once with the full line. Kept so server.ts can
     *                move to sentence streaming later; the engine does not
     *                stream today (HANDOFF §3).
     */
    async next(
      childText: string | null,
      incoming: State,
      onToken?: (text: string) => void
    ): Promise<Turn> {
      const t0 = performance.now();
      const state: State = { ...initialState(), ...incoming };
      const text = childText?.trim() || null;
      const flags: string[] = [];
      let tellAdult = false;

      const finish = (
        out: Line,
        to: State,
        info: { source: TurnMeta["source"]; level: AnswerLevel; crowd: Crowd | null; advanced: boolean; forced: boolean }
      ): Turn => {
        // Every line passes the output gate — templates too, because they
        // carry the child's own words.
        let line = out.line;
        const check = screenOutput(line, out.model ? MODEL_LIMITS : TEMPLATE_LIMITS);
        if (check.ok) {
          line = check.line;
        } else {
          flags.push(`output_blocked:${check.reasons.join("+")}`);
          line = reask(to.scene > 5 ? { ...to, scene: 5 } : to);
        }
        onToken?.(line);
        return {
          speaker: out.speaker,
          line,
          state: to,
          done: to.scene > 5,
          meta: {
            scene: { from: state.scene, to: to.scene },
            ...info,
            flags,
            tellAdult,
            slots: slotsOf(to),
            ms: Math.round(performance.now() - t0),
          },
        };
      };

      const quiet = { level: answerLevel(text), crowd: null, advanced: false, forced: false };

      // --- the story is over ------------------------------------------------
      if (state.scene > 5) {
        return finish(
          { speaker: "owl", line: afterEndLine() },
          { ...state, turns: state.turns + 1 },
          { ...quiet, source: "template" }
        );
      }

      // --- Owl opens, unprompted, with no model call ------------------------
      if (state.turns === 0 && !text) {
        return finish(openerLine(), { ...state, turns: 1 }, { ...quiet, source: "template" });
      }

      // --- boundaries: before anything can reach state or a prompt ---------
      const screen = screenInput(text);
      if (screen.kind !== "ok") {
        flags.push(`input:${screen.kind}`);
        tellAdult = screen.kind === "distress";
        // State does not move and the utterance is not stored.
        return finish(
          redirectLine(screen.kind, state),
          { ...state, turns: state.turns + 1 },
          { ...quiet, source: "template" }
        );
      }

      // --- interpret --------------------------------------------------------
      const level = answerLevel(text);
      const crowd = crowdFor(state.scene, level);
      const heard = interpret(state, text);

      // --- ask the model only where judgement is needed ---------------------
      let source: TurnMeta["source"] = "template";
      let modelAdvance: boolean | undefined;
      let modelLine: string | undefined;

      if (MODEL_SCENES.has(state.scene) && heard.hasContent) {
        try {
          const raw = await withTimeout(
            complete(OWL_SYSTEM, buildTurnMessage(state, text, crowd, level)),
            timeoutMs
          );
          console.log(`[raw] scene=${state.scene} crowd=${crowd} level=${level} ${JSON.stringify(raw)}`);
          const parsed = parseReply(raw);
          if (parsed.line.trim()) {
            modelAdvance = parsed.advance;
            modelLine = parsed.line;
            source = "model";
          } else {
            flags.push("model_empty");
            source = "offline";
          }
        } catch (err) {
          console.error("[engine]", err);
          flags.push("model_failed");
          source = "offline";
        }
      } else if (MODEL_SCENES.has(state.scene)) {
        source = "offline"; // silence: nothing to expand, code asks again
      }

      // --- decide and move --------------------------------------------------
      const { satisfied, forced } = decide(state, heard, modelAdvance);
      const resolved = satisfied || forced;
      if (forced) flags.push("forced_advance");
      if (resolved && state.scene === 2 && !heard.material) flags.push("defaulted_material");

      const next = applyTurn(state, text, heard, resolved);

      // Is a model line fit to be spoken as-is?
      const usable = (line: string | undefined): line is string => {
        if (!line) return false;
        if (completesThought(line, text)) {
          flags.push("owl_completed_thought");
          return false;
        }
        const c = screenOutput(line);
        return c.ok && isOpenQuestionLine(c.line);
      };

      let out: Line;

      if (resolved) {
        const to = next.scene;
        if (to === 2) {
          out = { speaker: "pip", line: pipChoiceOpening() };
        } else if (to === 3) {
          out = { speaker: "owl", line: reasonOpening(next) };
        } else if (to === 4) {
          // Leaving scene 3 normally: Owl's own prediction question if it is
          // clean, otherwise the template. Arriving from scene 2 (inline
          // reason) there is no model line.
          const own = state.scene === 3 && !forced && usable(modelLine) ? modelLine : undefined;
          out = { speaker: "owl", line: own ?? predictionOpening(next), model: !!own };
          if (state.scene === 3 && !forced && !own) flags.push("template_bridge");
        } else if (to === 5) {
          out = { speaker: "pip", line: wolfLine(next) };
        } else {
          out = { speaker: "owl", line: closingLine(next, !forced && satisfied) };
        }
      } else {
        switch (state.scene) {
          case 1:
            out = { speaker: "owl", line: offlineOwl(state, text, level, crowd) };
            break;
          case 2:
          case 4:
            out = { speaker: "pip", line: pipReask(state, level, crowd) };
            break;
          default: {
            // Scenes 3 and 5: Owl's PEER move, repaired if needed, else offline.
            let line: string | undefined;
            if (modelLine && !completesThought(modelLine, text)) {
              line = ensureQuestion(modelLine, state, crowd);
              if (line !== modelLine) flags.push("line_repaired");
            } else if (modelLine) {
              flags.push("owl_completed_thought");
            }
            if (!line) {
              line = offlineOwl(state, text, level, crowd);
              if (source === "model") source = "offline";
            }
            out = { speaker: "owl", line, model: source === "model" };
          }
        }
      }

      return finish(out, next, { source, level, crowd: resolved ? null : crowd, advanced: resolved, forced });
    },
  };
}

export const StoryEngine = createEngine();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
