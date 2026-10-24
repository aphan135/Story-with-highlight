/**
 * The four FREE RESPONSE questions. The story is fixed; these adapt to what
 * the child actually said.
 *
 * Role split, applied everywhere:
 *   firstPig  asks every follow-up question
 *   secondPig gives every explanation and acknowledgment
 *
 * The script's branches (bricks / wood / straw, strength / weight / joining)
 * are matched in code and spoken from templates, so they cost no model call.
 * Only an answer none of them covers goes to the model, and only to reflect
 * the child's own words back.
 */

import Anthropic from "@anthropic-ai/sdk";
import { answerLevel } from "./prompts";
import type { QuestionId, Speaker } from "./story";

/** How a question talks. server.ts supplies the real voice and mic. */
export type Talk = {
  say(speaker: Speaker, line: string): Promise<void>;
  /** Speaks a question and resolves with the child's answer, or null on silence. */
  ask(speaker: Speaker, line: string): Promise<string | null>;
};

// ---------------------------------------------------------------------------
// Reading the child's answer

type Material = "bricks" | "wood" | "straw" | "other";
type Reason = "strength" | "weight" | "joining";

const lower = (text: string | null) => (text ?? "").toLowerCase();

/** Silence, filler only, or "I don't know". */
export function unsure(text: string | null): boolean {
  return (
    answerLevel(text) === "silent" ||
    /\b(don'?t know|do not know|dunno|not sure|no idea|i forget|i forgot)\b/.test(lower(text))
  );
}

export function material(text: string | null): Material | null {
  if (unsure(text)) return null;
  const t = lower(text);
  if (/\bbricks?\b/.test(t)) return "bricks";
  if (/\b(wood|wooden|sticks?|logs?|planks?|twigs?|timber)\b/.test(t)) return "wood";
  if (/\b(straw|hay|grass)\b/.test(t)) return "straw";
  return "other";
}

/** Checked in the script's order: strength, weight, joining. */
export function reason(text: string | null): Reason | null {
  const t = lower(text);
  if (/\b(strong|stronger|strongest|strength|tough|hard|sturdy|solid|won'?t break|can'?t break)\b/.test(t)) return "strength";
  if (/\b(heavy|heavier|weight|weigh|weighs)\b/.test(t)) return "weight";
  if (/\b(glue|nails?|tape|tie|rope|cement|mortar|join|joined|connect|screws?|together|hold)\b/.test(t)) return "joining";
  return null;
}

/** Any attempt at a reason, even one we have no template for. */
const givesReason = (text: string | null) =>
  !!reason(text) || /\b(because|cause|cuz|so that|so it|since)\b/.test(lower(text));

/** Strong materials or firm connections — what actually saved the house. */
const builtWell = (text: string | null) =>
  /\b(bricks?|strong|stronger|mortar|cement|glue|join|joined|together|careful|carefully|stack|stacked|firm|firmly|solid|sturdy|hard)\b/.test(lower(text));

const wolfWeak = (text: string | null) =>
  /\b(weak|tired|small|lazy|sick|out of breath|not strong|ran out|gave up)\b/.test(lower(text));

// ---------------------------------------------------------------------------
// Lines from the script

const MATERIAL_FOLLOW_UP: Record<Material, string> = {
  bricks: "Bricks! Why would they make a strong house?",
  // The script gives this line to the second pig, whose house was wooden.
  // The first pig asks it now, so it is "our brother's" house, not "my".
  wood: "Wood! Our brother's wooden house fell down. How would you make yours stronger?",
  straw: "Straw! How could you help it stand up to the wolf's puff?",
  other: "What would make that a good material for your house?",
};

const REASON_REPLY: Record<Reason, string> = {
  strength: "You're thinking about strength. We need walls that can stand up to the wolf!",
  weight: "You're thinking about weight. You think it would be harder to blow away.",
  joining: "You want to hold the pieces firmly together. That could help the walls stay in place.",
};

/** After a material plus a reason: ask about the part they have not explained. */
const DETAIL_QUESTION: Record<Reason, string> = {
  strength: "How would you put the pieces together?",
  weight: "How would you put the pieces together?",
  joining: "What would make the walls strong enough for the wolf?",
};

const WHY_STANDING_EXPLAINED =
  "This house was made of bricks, and we joined them firmly with mortar. The straw and wooden houses were not built that way.";

// ---------------------------------------------------------------------------
// Scene 3 — Questions 1 and 2

async function buildingIdea(t: Talk) {
  let answer = await t.ask("secondPig", "Little brother, what will you build with?");

  const nudges = [
    "Take a look around. What could you build a house out of?",
    "There's straw, wood, and bricks. Which one would you pick?",
  ];
  for (const nudge of nudges) {
    if (material(answer)) break;
    answer = await t.ask("firstPig", nudge);
  }

  const m = material(answer);
  if (!m) {
    await t.say("secondPig", "That's okay. We can figure it out together!");
    return;
  }

  // A material plus a reason: acknowledge the reason, then ask about a detail
  // the child has not already explained.
  const r = reason(answer);
  if (r) {
    await t.say("secondPig", REASON_REPLY[r]);
    const detail = await t.ask("firstPig", DETAIL_QUESTION[r]);
    await respondToExplanation(t, detail, r);
    return;
  }
  if (givesReason(answer)) {
    await t.say("secondPig", await reflect("what they would build with, and why", answer,
      "You have a reason for that. I like how you're thinking."));
    const detail = await t.ask("firstPig", "How would you put the pieces together?");
    await respondToExplanation(t, detail);
    return;
  }

  const explanation = await t.ask("firstPig", MATERIAL_FOLLOW_UP[m]);
  await respondToExplanation(t, explanation);
}

/** Question 2. Short, grounded in the child's words, never a guarantee. */
async function respondToExplanation(t: Talk, answer: string | null, alreadySaid?: Reason) {
  if (unsure(answer)) {
    answer = await t.ask("firstPig", "What would make it hard for the wolf to blow down?");
    if (unsure(answer)) {
      await t.say("secondPig", "That's a tricky one. Let's keep thinking about it together.");
      return;
    }
  }

  const r = reason(answer);
  if (r && r !== alreadySaid) {
    await t.say("secondPig", REASON_REPLY[r]);
    return;
  }
  await t.say("secondPig", await reflect("how they would make their house stand up to the wolf", answer,
    "That's your own idea. Let's see how it could work."));
}

// ---------------------------------------------------------------------------
// Scene 7 — Question 3

async function whyStanding(t: Talk) {
  const answer = await t.ask("firstPig", "Little brother, why do you think our house stayed standing?");

  if (unsure(answer)) {
    await t.ask("firstPig",
      "Let's look at the pictures. What did we use for this house that was different from the first two?");
    await t.say("secondPig", WHY_STANDING_EXPLAINED);
    return;
  }

  if (wolfWeak(answer) && !builtWell(answer)) {
    await t.say("secondPig", "You're thinking about the wolf's strength.");
    const again = await t.ask("firstPig",
      "The same wolf knocked down the other houses. What was different about this one?");
    if (builtWell(again)) {
      await t.say("secondPig", "You spotted it. This house was made of bricks, joined firmly together.");
    } else if (unsure(again)) {
      await t.say("secondPig", WHY_STANDING_EXPLAINED);
    } else {
      await t.say("secondPig", await reflect("what was different about the brick house", again,
        "That's something to think about. We built this one with bricks, joined firmly."));
    }
    return;
  }

  if (builtWell(answer)) {
    await t.say("secondPig", "You noticed how we built the walls. We joined the bricks firmly and worked carefully.");
    return;
  }
  if (reason(answer) === "weight") {
    await t.say("secondPig", "You thought about the weight. Joining the bricks firmly helped the house stay together, too.");
    return;
  }
  await t.say("secondPig", await reflect("why the brick house stayed standing", answer,
    "That's an interesting idea. We also joined the bricks firmly and worked carefully."));
}

// ---------------------------------------------------------------------------
// Scene 8 — Question 4

/** What the child might mention, and how the second pig names it back. */
const EVENTS: [RegExp, string][] = [
  [/\bstraw\b/, "the straw house"],
  [/\b(wood|wooden|sticks?)\b/, "the wooden house"],
  [/\b(blew|blow|blowing|huff|puff|whoosh)\w*/, "the wolf blowing"],
  [/\bbricks?\b/, "our brick house"],
  [/\b(together|help|helped|built|build)\b/, "building it together"],
  [/\b(gave up|went away|left|ran away|go away)\b/, "the wolf giving up"],
];

function eventsMentioned(text: string | null): string[] {
  const t = lower(text);
  return EVENTS.filter(([re]) => re.test(t)).map(([, phrase]) => phrase);
}

const list = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`;

async function tellStory(t: Talk) {
  let answer = await t.ask("secondPig", "Can you tell me what happened to us today?");

  // A complete retelling is not required, but a child who has not started
  // gets a picture to start from.
  if (unsure(answer) || answerLevel(answer) === "oneWord") {
    answer = await t.ask("firstPig", "Look at the first picture. What happened to the straw house?");
  }

  if (unsure(answer)) {
    await t.say("secondPig", "That's okay. We had a big day!");
    return;
  }

  const events = eventsMentioned(answer);
  if (events.length) {
    await t.say("secondPig", `You remembered ${list(events)}.`);
    return;
  }
  await t.say("secondPig", await reflect("what happened in the story today", answer,
    "You told it in your own words."));
}

export const QUESTIONS: Record<QuestionId, (t: Talk) => Promise<void>> = {
  buildingIdea,
  whyStanding,
  tellStory,
};

// ---------------------------------------------------------------------------
// The one model call: reflect an answer no template covers.

const REFLECT_SYSTEM = `You are the Second Pig in "The Three Little Pigs",
speaking to your little brother: a child aged 6 to 9 who plays the youngest pig.
This is voice only.

The child just answered a question. Reflect their answer back in one or two
short sentences, using only ideas they actually said.

Rules:
- Never add a fact or idea the child did not say.
- Never promise their idea is sure to work.
- Never ask a question. Someone else asks the questions.
- No "good job", "well done" or "correct". Name what they thought about.
- Words a seven-year-old uses.

Output exactly one line, nothing before or after:
LINE: <what the child hears>`;

let client: Anthropic | null = null;

async function reflect(about: string, childText: string | null, fallback: string): Promise<string> {
  if (!childText?.trim() || !process.env.ANTHROPIC_API_KEY) return fallback;

  try {
    client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Non-streaming and text blocks only — see HANDOFF §3. Thinking is off:
    // this is a one-sentence echo, and the child is waiting in silence.
    const res = await withTimeout(
      client.messages.create({
        model: "claude-haiku-5-5",
        max_tokens: 300,
        thinking: { type: "disabled" },
        system: REFLECT_SYSTEM,
        messages: [
          {
            role: "user",
            content: `The question was about ${about}.\nThe child said, word for word: "${childText.trim()}"`,
          },
        ],
      }),
      4000
    );

    const raw = res.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    const line = raw.match(/LINE:\s*([\s\S]*)$/i)?.[1]?.replace(/\s+/g, " ").trim();
    console.log(`[reflect] ${JSON.stringify(raw)}`);

    // Only spoken words reach the child; anything off-format gets the template.
    if (!line || line.length > 220 || line.includes("?")) return fallback;
    return line;
  } catch (err) {
    console.error("[reflect]", err);
    return fallback;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}
