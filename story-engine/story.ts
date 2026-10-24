/**
 * Story logic with no model and no I/O: interpreting a child's answer,
 * deciding whether a scene is satisfied, moving state, and every line the
 * characters can say without calling Claude.
 *
 * Everything here is deterministic given its inputs (apart from picking among
 * equivalent wordings), so it can be tested without an API key.
 *
 * The graph, one fork:
 *
 *   1 Orient ──▶ 2 Choice ──▶ 3 Reason ──▶ 4 Test ──▶ 5 Retell ──▶ 6 End
 *                  │  └────── reason given inline: skip 3 ─────▶ 4
 *                  └─ material strength + prediction ─▶ outcome (holds/falls)
 *                                                       colours scene 5's opening
 */

import {
  answerLevel,
  contentWords,
  pick,
  pickFallback,
  pickProbe,
  probesFor,
  type AnswerLevel,
  type Crowd,
  type PredictionKind,
  type State,
} from "./prompts";
import { contrastFor, findMaterial, guessMaterial, materialWords, type Material, type Strength } from "./materials";
import { isQuotable, type InputKind } from "./safety";

/** A scene is abandoned after this many failed attempts. The child is never stuck. */
export const MAX_PROBES = 2;

/** Scenes whose resolution needs judgement the model is better at. */
export const MODEL_SCENES = new Set<number>([3, 5]);

export type Speaker = "pip" | "owl";
/** `model: true` marks text the model wrote, which is held to tighter limits. */
export type Line = { speaker: Speaker; line: string; model?: boolean };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "the bricks house" sounds wrong aloud; "the brick house" does not. */
const ADJECTIVE: Record<string, string> = { bricks: "brick", sticks: "stick" };
const houseOf = (m: string) => `${ADJECTIVE[m] ?? m} house`;

// ---------------------------------------------------------------------------
// Interpreting an answer

const CAUSAL = /\b(because|'cause|cause|coz|since)\b/i;

export type Heard = {
  level: AnswerLevel;
  hasContent: boolean;
  /** Scene 2: what they chose, if anything usable. */
  material?: Material;
  /** Scene 2: they gave the material AND a reason in one breath. */
  inlineReason: boolean;
  /** Scene 3: something beyond the material itself. */
  reasonOk: boolean;
  /** Scene 5: two or more events and enough substance, counting earlier turns. */
  retellOk: boolean;
};

/** Event units in a retelling: split on sentence ends and sequence words. */
function eventUnits(parts: string[]): number {
  const SPLIT = /[.!?]+|\b(?:and then|then|next|after that|after|finally|first|in the end|at the end|at last|last)\b/i;
  let n = 0;
  for (const part of parts) {
    for (const seg of part.split(SPLIT)) {
      if (seg && contentWords(seg).length > 0) n++;
    }
  }
  return n;
}

export function interpret(state: State, text: string | null): Heard {
  const level = answerLevel(text);
  const content = contentWords(text);
  const hasContent = content.length > 0;

  let material: Material | undefined;
  let inlineReason = false;
  if (state.scene === 2) {
    material = findMaterial(text) ?? guessMaterial(content);
    if (material && CAUSAL.test(text ?? "")) {
      const mw = materialWords(material.name);
      inlineReason = content.some((w) => !mw.has(w));
    }
  }

  const mw = materialWords(state.material);
  const reasonOk = content.some((w) => !mw.has(w));

  const parts = [...state.retelling, ...(text?.trim() ? [text.trim()] : [])];
  const totalContent = parts.reduce((n, p) => n + contentWords(p).length, 0);
  const retellOk = state.scene === 5 && eventUnits(parts) >= 2 && totalContent >= 4;

  return { level, hasContent, material, inlineReason, reasonOk, retellOk };
}

// ---------------------------------------------------------------------------
// The wolf test — the one fork

const NEG_FALL =
  /\b(won'?t|can'?t|cannot|couldn'?t|doesn'?t|does not|didn'?t|not|never)\b[^.!?]{0,24}\b(fall|blow|blew|blown|break|broke|collapse|crash|down|flatten|topple|knock)/i;
const HOLD = /\b(hold|holds|held|stand|stands|stay|stays|strong|safe|survive|survives|fine)\b/i;
const FALL =
  /\b(fall|falls|fell|blow|blows|blew|blown|break|breaks|broke|collapse|crash|flatten|topple|knock|smash|fly|flies|flew|gone|destroy)\b|\bdown\b/i;

export function predictionKind(text: string | null): PredictionKind {
  if (!text) return "unsure";
  if (NEG_FALL.test(text)) return "holds";
  const f = FALL.test(text);
  const h = HOLD.test(text);
  if (f && !h) return "falls";
  if (h && !f) return "holds";
  return "unsure";
}

/**
 * Known materials decide it. An unknown one ("ice cream") follows the child's
 * own prediction, so what they reasoned is what happens.
 */
export function outcomeFor(
  strength: Strength | undefined,
  kind: PredictionKind | undefined
): "holds" | "falls" {
  if (strength === "weak") return "falls";
  if (strength === "strong" || strength === "medium") return "holds";
  return kind === "falls" ? "falls" : "holds";
}

// ---------------------------------------------------------------------------
// Deciding and moving

export function decide(
  state: State,
  h: Heard,
  modelAdvance: boolean | undefined
): { satisfied: boolean; forced: boolean } {
  let codeOk: boolean;
  switch (state.scene) {
    case 1: codeOk = h.hasContent; break;
    case 2: codeOk = !!h.material; break;
    case 3: codeOk = h.reasonOk; break;
    case 4: codeOk = h.hasContent; break;
    case 5: codeOk = h.retellOk; break;
    default: codeOk = true;
  }
  // The model may say "not yet" in scenes 3 and 5. It can never advance a
  // scene the code says is empty.
  const satisfied = codeOk && (MODEL_SCENES.has(state.scene) ? modelAdvance !== false : true);
  const forced = !satisfied && state.probes >= MAX_PROBES;
  return { satisfied, forced };
}

/** Move state. `resolved` = satisfied or forced. */
export function applyTurn(state: State, text: string | null, h: Heard, resolved: boolean): State {
  const said = (text ?? "").trim();
  const base: State = { ...state, turns: state.turns + 1 };

  if (!resolved) {
    return {
      ...base,
      retelling: state.scene === 5 && h.hasContent ? [...state.retelling, said] : state.retelling,
      probes: state.probes + 1,
      probedThisScene: true,
    };
  }

  const next: State = {
    ...base,
    events: said && h.hasContent ? [...state.events, said] : state.events,
    probes: 0,
    probedThisScene: false,
    scene: (state.scene + 1) as State["scene"],
  };

  switch (state.scene) {
    case 2: {
      // If the child gave nothing for three tries, Pip decides.
      const mat = h.material ?? { name: "bricks", strength: "strong" as Strength, known: true };
      next.material = mat.name;
      next.strength = mat.strength;
      if (h.inlineReason && said) {
        next.reason = said;
        next.scene = 4; // they already explained — do not ask again
      }
      break;
    }
    case 3:
      if (h.reasonOk && said) next.reason = said;
      break;
    case 4:
      if (h.hasContent) {
        next.prediction = said;
        next.predictionKind = predictionKind(said);
      }
      next.outcome = outcomeFor(next.strength, next.predictionKind);
      break;
    case 5:
      if (h.hasContent) next.retelling = [...state.retelling, said];
      break;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Quoting the child back to themselves

/** A short, lower-case echo of what they said, or undefined if it cannot be repeated. */
export function gist(text: string | null | undefined, maxWords = 6): string | undefined {
  if (!text) return undefined;
  let t = text.toLowerCase().replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();
  const LEAD = /^(um+|uh+|well|maybe|so|i think|i guess|because|'cause|cause|coz|since)\s+/;
  for (let i = 0; i < 3 && LEAD.test(t); i++) t = t.replace(LEAD, "");
  const g = t.split(" ").filter(Boolean).slice(0, maxWords).join(" ");
  return g && isQuotable(g) ? g : undefined;
}

// ---------------------------------------------------------------------------
// Lines the characters say without a model

export const openerLine = (): Line => ({
  speaker: "owl",
  line: "You're back! Where are you up to — what's happening on your page?",
});

/** The scene-3 opening: "Bricks! Why bricks and not sticks?" */
export function reasonOpening(s: State): string {
  const m = s.material ?? "that";
  return `${cap(m)}! ${probesFor({ ...s, scene: 3 }, "openEnded")[0]}`;
}

/** Scene 4's opening question, used whenever Owl does not write it. */
export function predictionOpening(s: State): string {
  const m = s.material ?? "house";
  const g = gist(s.reason, 5);
  const ask = `So what happens when the wolf blows on the ${m}?`;
  return g ? `${cap(g)}! ${ask}` : `Pip is nearly done building! ${ask}`;
}

/** Scene 5's opening: the wolf arrives, the house holds or falls, the callback. */
export function wolfLine(s: State): string {
  const m = s.material ?? "house";
  const holds = s.outcome === "holds";
  const said = gist(s.prediction, 7);
  const kind = s.predictionKind;

  const result = holds
    ? `and the ${houseOf(m)} does not move at all!`
    : `and whoosh, the ${houseOf(m)} tumbles right over! I scampered out just in time.`;

  let callback = "";
  if (said && kind === (holds ? "holds" : "falls")) {
    callback = `You said "${said}" before he even got here!`;
  } else if (kind === "falls" && holds) {
    callback = "You thought it might fall, and look at that!";
  } else if (kind === "holds" && !holds) {
    callback = "You thought it would stand. The wind was stronger than we both guessed!";
  }

  return [
    "The last one is laid. Shh, he's at the door! Huff, puff,",
    result,
    callback,
    "Tell me the whole night, from the start. What happened first?",
  ]
    .filter(Boolean)
    .join(" ");
}

export function closingLine(s: State, retold: boolean): string {
  if (!retold) {
    return "Thank you for telling me about Pip's night. Who will you tell about it first?";
  }
  const reason = s.reason ? ", and you gave a reason" : "";
  return `Beginning, middle, end${reason}. You told the whole night! Who will you tell about it first?`;
}

export const afterEndLine = () =>
  "That's our story for tonight! Go and tell someone what happened to Pip. Who will it be?";

/** Pip's opening for scene 2. */
export const pipChoiceOpening = () =>
  pick([
    "Oh, I know that page, that's me! The wolf comes tonight and I have nothing built. What should I build my house out of?",
    "That's my page! The wolf is coming tonight and I have no house at all. What should I build mine out of?",
  ]);

/** The short question that re-asks a scene. Used after any interruption. */
export function reask(s: State): string {
  switch (s.scene) {
    case 1: return "Where are you up to? What is happening on your page?";
    case 2: return "What should Pip build his house out of?";
    case 3: return `Why ${s.material ?? "that"}?`;
    case 4: return `What do you think happens when the wolf blows on the ${s.material ?? "house"}?`;
    default: return "What happened first?";
  }
}

/** Safe, in-character handling of things the child should not be pulled into. */
export function redirectLine(kind: Exclude<InputKind, "ok">, s: State): Line {
  switch (kind) {
    case "distress":
      // Closed on purpose: this one needs an action, not an answer.
      return {
        speaker: "owl",
        line: "Thank you for telling me. That is a big feeling, and a grown-up who loves you can help with it. Can you go and find one now?",
      };
    case "personal":
      return { speaker: "owl", line: `Ooh, that one is a secret just for you, so keep it safe! Back to our story. ${reask(s)}` };
    case "rude":
      return { speaker: "owl", line: `Hee hee, that's a silly one! Let's get back to Pip. ${reask(s)}` };
    case "identity":
      // Honest on purpose. A child who sincerely asks gets a true answer.
      return {
        speaker: "owl",
        line: `I'm not a real owl. I'm a talking computer helper, and I love this story! ${reask(s)}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Unresolved turns: probe within the scene, no model

/** Pip re-asks in scenes 2 and 4. */
export function pipReask(s: State, level: AnswerLevel, crowd: Crowd): string {
  if (s.scene === 2) {
    if (level === "silent" && s.probes >= 1) return pickFallback("silenceTwice"); // closed: a way back in
    return level === "silent"
      ? "The wolf comes tonight and I have nothing built! What could a house be made of?"
      : "The wolf comes tonight and I have nothing built! What should I build my house out of?";
  }
  return `${pick(["Oh! ", "Quick, think! "])}${pickProbe(s, crowd)}`;
}

/** Owl's probe with no model: a plain echo of what they said, then a question. */
export function offlineOwl(s: State, text: string | null, level: AnswerLevel, crowd: Crowd): string {
  const probe = pickProbe(s, crowd);
  if (level === "silent") return s.probes >= 1 ? pickFallback("silence") : probe;
  const echo = contentWords(text).slice(-4).join(" ");
  return echo && isQuotable(echo) ? `${cap(echo)}! ${probe}` : probe;
}
