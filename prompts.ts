/**
 * Story Quest — system prompts and turn construction.
 *
 * Two separate calls, never one. A single call voicing both characters lets
 * Owl drift into Pip's job and start answering its own questions.
 */

export const OWL_SYSTEM = `You are Owl, talking with a child aged 6 to 9 who is reading
"The Three Little Pigs" on paper. You cannot see the book or
the child. This is voice only; the child hears you and speaks back.

Your only job is to ask ONE question that makes the child
explain their own thinking.

Rules, in order of importance:
1. Output one or two short sentences. The last one MUST be a
   question ending in "?".
2. NEVER answer your own question, and never complete the
   child's thought. If the child gives a fragment such as
   "because heavy", repeat their word back and ask for the
   rest. Do not supply the rest yourself.
3. Never ask a yes/no question. Never ask two questions in
   one turn.
4. Never correct the child. Any answer with a reason behind
   it is a good answer, even an unexpected one.
5. Use words a seven-year-old uses. No sentence over 12 words.
6. Praise only by naming what they did: "You gave the reason."
   Never "Good job."
7. Stay in character. Never mention being an AI. Never discuss
   anything outside this story.`;

export const PIP_SYSTEM = `You are Pip, the third little pig, talking to a child aged 6 to 9.
Voice only. You need the child's help and you never know the
answer yourself.

Rules:
1. One or two short sentences, present tense, excited.
2. When you hand the turn back to the child, your last sentence
   MUST be an open question ending in "?". Never a yes/no
   question.
3. Never explain, never teach, and never ask "why" — that is
   Owl's job, not yours.
4. Use the child's own words back to them when they have
   decided something.
5. Words a seven-year-old uses. No sentence over 10 words.
6. Stay in character at all times.`;

// ---------------------------------------------------------------------------

export type State = {
  scene: 1 | 2 | 3 | 4 | 5;
  material?: string;
  reason?: string;
  prediction?: string;
  events: string[];
  probedThisScene: boolean;
};

export const initialState = (): State => ({
  scene: 1,
  events: [],
  probedThisScene: false,
});

/** What each scene needs before it will advance, plus probes of the right shape. */
const SCENES: Record<number, { needs: string; probes: (s: State) => string[] }> = {
  1: {
    needs: "any description of where the child is in the book",
    probes: () => [
      "Who's in the picture right now?",
      "Tell me what you can see?",
      "What just happened in your book?",
    ],
  },
  2: {
    needs: "a material to build the house from",
    probes: () => [
      "What could a house be made of?",
      "If you were building it, what would you use?",
      "What's the strongest thing you can think of?",
    ],
  },
  3: {
    needs: "a reason for choosing that material",
    probes: (s) => [
      `Why ${s.material} and not straw?`,
      `What's good about ${s.material}?`,
      `How does ${s.material} help when he blows?`,
      "What would happen if I used straw instead?",
    ],
  },
  4: {
    needs: "a prediction or a reaction to the wolf arriving",
    probes: () => [
      "What do you think will happen?",
      "What's he going to find?",
      "What happens when he blows?",
    ],
  },
  5: {
    needs: "two or more events retold in order",
    probes: () => ["What happened first?", "And then what?", "How did it end?"],
  },
};

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/**
 * The user message, built fresh each turn.
 *
 * The reply format puts the spoken line FIRST and the tag after `---`, so the
 * line can be streamed to TTS as tokens arrive. Asking for JSON instead would
 * block streaming until the whole object parses — roughly double the perceived
 * latency.
 */
export function buildTurnMessage(state: State, childText: string | null): string {
  const scene = SCENES[state.scene];
  const known = [
    state.material && `material=${state.material}`,
    state.reason && `reason=${state.reason}`,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `Scene ${state.scene}. The child must give ${scene.needs}.`,
    childText === null
      ? "The child has said nothing for three seconds. Ask again, shorter and easier."
      : `The child just said: "${childText}"`,
    known && `Known so far: ${known}`,
    `Probes of the right shape (do not copy word for word):`,
    `  ${scene.probes(state).slice(0, 2).map((p) => `"${p}"`).join(" | ")}`,
    ``,
    `Reply as Owl. Then on a new line write --- and then`,
    `ADVANCE: yes if the child gave ${scene.needs}, ADVANCE: no if not.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Split the streamed reply into the spoken line and the advance decision. */
export function parseReply(raw: string): { line: string; advance: boolean } {
  const [spoken, tail = ""] = raw.split(/^---$/m);
  return {
    line: spoken.trim(),
    advance: /ADVANCE:\s*yes/i.test(tail),
  };
}

/**
 * Rule 1 is broken occasionally no matter how the prompt is worded, so it is
 * enforced here rather than trusted. Without a screen, the question mark is the
 * only signal the child gets that it is their turn.
 */
export function ensureQuestion(line: string, state: State): string {
  if (/\?\s*$/.test(line)) return line;
  return `${line.replace(/[.!\s]+$/, ".")} ${pick(SCENES[state.scene].probes(state))}`;
}

// ---------------------------------------------------------------------------
// Fallbacks. Spoken instead of silence, a beep, or a stack trace.

export const FALLBACKS = {
  /** Recognition failed. Owl, never Pip — failure should sound curious, not panicked. */
  misheard: [
    "Ooh, the wind took that one. Say it again for me?",
    "Hmm, I missed that — what did you say?",
    "My old ears! One more time?",
  ],
  /** Model still generating. Holds the turn, so these do NOT end in a question. */
  stalling: [
    "Ooh, let me think about that one...",
    "Hmm. Hold on...",
    "That's a good one. Give me a second...",
  ],
  /** Three seconds of silence: shorter and easier than the question that got no answer. */
  silence: [
    "What do you think?",
    "Any idea at all?",
    "Just say the first thing you think of?",
  ],
  /** Second silence. Breaks the no-yes/no rule on purpose — a stuck child needs a way back in. */
  silenceTwice: ["Straw, or bricks?", "Sticks, or something stronger?"],
  /** Anything unhandled. Wire this to the catch-all. */
  recover: ["Whoops, I tripped over a brick! Where were we?"],
};

export const pickFallback = (kind: keyof typeof FALLBACKS): string =>
  pick(FALLBACKS[kind]);
