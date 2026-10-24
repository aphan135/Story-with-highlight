/**
 * Boundaries, in code. Two gates:
 *
 *   screenInput   what the child said, BEFORE it can reach state or a prompt
 *   screenOutput  what a character is about to say, BEFORE it reaches Sonic
 *
 * Both are deliberately blunt word-and-shape checks. They are a backstop for
 * the prompt, not a replacement for it, and they will miss things. Treat this
 * as "the obvious failures cannot happen", not as a content-moderation system.
 */

export type InputKind = "ok" | "distress" | "personal" | "rude" | "identity";

const DISTRESS = [
  // First-person only: "the pig is scared" is story talk, "I'm scared" is not.
  /\b(i am|i'm|im|i feel|i felt)\s+(really\s+|so\s+|very\s+)?(scared|afraid|sad|hurt|sick|lonely|alone|crying)\b/i,
  /\b(want to die|kill myself|hurt myself|hate myself|nobody loves me|no one loves me)\b/i,
  /\b(hits me|hit me|hurts me|hurt me|touched me|touches me|locked me)\b/i,
];

const PERSONAL = [
  /\bmy (first |last |real )?name is\b/i,
  /\bmy (home |street )?address is\b/i,
  /\bmy (phone|cell|mobile)( number)? is\b/i,
  /\bi live (at|on|in|near)\b/i,
  /\bi go to\b.*\bschool\b/i,
  /\d{4,}/, // digits read out by recognition: phone numbers, zip codes
];

const RUDE =
  /\b(shit|fuck\w*|damn|hell|bitch|bastard|crap|ass|asshole|dick|piss|sex|sexy|naked|porn|stupid|dumb|idiot|shut up|hate you|kill you)\b/i;

const IDENTITY = [
  /\bare you\s+(a\s+|an\s+)?(really\s+)?(real|human|person|robot|computer|ai|bot|machine|alive|an owl)\b/i,
  /\bis this\s+(a\s+)?(real|computer|robot|person)\b/i,
  /\bwho made you\b/i,
  /\bwhat are you\b/i,
  /\bare you\s+(talking\s+)?(to me|listening)\b/i,
];

export function screenInput(text: string | null): { kind: InputKind } {
  if (!text?.trim()) return { kind: "ok" };
  if (DISTRESS.some((r) => r.test(text))) return { kind: "distress" };
  if (PERSONAL.some((r) => r.test(text))) return { kind: "personal" };
  if (RUDE.test(text)) return { kind: "rude" };
  if (IDENTITY.some((r) => r.test(text))) return { kind: "identity" };
  return { kind: "ok" };
}

// ---------------------------------------------------------------------------

/** Words a character must never say, and must never echo back from a child. */
const VIOLENT =
  /\b(kill|kills|killed|killing|dead|die|dies|died|blood|bleed|bleeding|stab|shoot|gun|knife|weapon|boil|boiled|eats? (him|you|her|the pig|pip)|eaten|monster|ghost|hate)\b/i;

const META_LEAK =
  /\b(the child|child said|ADVANCE|LINE:|as an ai|language model|claude|anthropic|openai|system prompt|i am an ai|i'm an ai)\b/i;

/** Can this child-supplied phrase be repeated back to them? */
export function isQuotable(text: string): boolean {
  return !RUDE.test(text) && !VIOLENT.test(text) && !PERSONAL.some((r) => r.test(text));
}

export type OutputCheck = { ok: boolean; line: string; reasons: string[] };

export type OutputLimits = { maxSentences: number; maxChars: number };

/** Model-written lines are held to a child's attention span. Authored templates are not. */
export const MODEL_LIMITS: OutputLimits = { maxSentences: 3, maxChars: 240 };
export const TEMPLATE_LIMITS: OutputLimits = { maxSentences: 8, maxChars: 420 };

export function screenOutput(raw: string, limits: OutputLimits = MODEL_LIMITS): OutputCheck {
  const reasons: string[] = [];

  // Sonic reads symbols aloud. Strip what is not speech.
  let line = raw
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#`~<>[\]{}|]/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!line) reasons.push("empty");
  if (META_LEAK.test(line)) reasons.push("meta");
  if (VIOLENT.test(line)) reasons.push("violent");
  if (RUDE.test(line)) reasons.push("rude");
  if (/\d/.test(line)) reasons.push("digits");

  // A child holds two short sentences, not a paragraph. Keep the first
  // sentence and the final question rather than rejecting a good line.
  const sentences = line.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [];
  if (sentences.length > limits.maxSentences) {
    const lastQ = [...sentences].reverse().find((s) => s.endsWith("?"));
    line = [sentences[0], lastQ].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join(" ");
  }
  if (line.length > limits.maxChars) reasons.push("long");

  return { ok: reasons.length === 0, line, reasons };
}
