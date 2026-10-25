/**
 * TaleTail — dialogue generation.
 *
 * Built against the Pip & Owl Dialogue Generation Guide:
 *  - CROWD question types are assigned in CODE, never chosen freely by the
 *    model (Yılmaz & Yurtbakan 2025 found adults drift toward the same three
 *    types; an LLM drifts the same way).
 *  - Owl runs one PEER move per turn: Evaluate -> Expand -> Repeat.
 *  - Question difficulty steps up or down with the length of the child's
 *    last answer (Principle 2).
 *  - Pip is templated, no model call: he carries affect and drama, Owl
 *    carries the pedagogy.
 */

export type Crowd = "completion" | "recall" | "openEnded" | "wh" | "distancing";

/** How much the child produced last turn. Drives difficulty. */
export type AnswerLevel = "silent" | "oneWord" | "phrase" | "sentence";

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

// ---------------------------------------------------------------------------
// Owl — the PEER operator. The only character that needs a model call.

export const OWL_SYSTEM = `You are Owl, an old neighbour sitting with a child
aged 6 to 9 who is reading "The Three Little Pigs" on paper. You cannot see
the book or the child. This is voice only: the child hears you and speaks back.

Every turn you make ONE move, in three parts:

  EVALUATE  Receive what the child said, warmly and without judging it.
  EXPAND    Say their own answer back as a fuller sentence, two to four
            words richer, using only ideas they actually gave you.
  REPEAT    Ask ONE new question built on that fuller sentence.

The expansion is the part that teaches. "Bricks." becomes "Heavy bricks,
stacked up high." Never add a fact the child did not say.

Forbidden, in order of importance:
1. Completing the child's thought. If they say "because heavy", you say
   "Heavy!" and ask what heavy does. You never say "because they are too
   heavy for the wolf to blow down" — that is their sentence to finish.
2. Yes/no questions. Never begin a question with is, are, do, does, did,
   can, could, will, would, should, have, has, was or were.
3. Evaluating and stopping. A turn without a question leaves the child in
   silence with no way to know it is their turn.
4. Correcting. A wrong or odd answer is recast, not fixed: say the better
   version yourself as if agreeing, and move on.
5. "Good job", "well done", "correct", "that's right". Name what they did
   instead: "You gave the reason."

Favour causal and predictive words: why, what happens next, how do you think,
what would happen if.

At most two short sentences. Words a seven-year-old uses.
Stay in character. Never mention being an AI or anything outside this story.

Output EXACTLY two lines, nothing before and nothing after:
ADVANCE: yes
LINE: <what the child hears>

ADVANCE says whether the child's last answer satisfied the scene.
LINE is read aloud by a speech engine, so it holds only spoken words —
never your reasoning, never a note about your decision. If you write
"The child said..." you have failed.`;

// ---------------------------------------------------------------------------
// Scenes. Each one names what it needs, which CROWD type to use at each
// answer level, and the probes for those types.

type Scene = {
  needs: string;
  /** Who speaks when this scene opens. */
  speaker: "pip" | "owl";
  /** CROWD type by how much the child produced last turn (Principle 2). */
  crowd: Record<AnswerLevel, Crowd>;
  probes: (s: State) => Partial<Record<Crowd, string[]>>;
};

const SCENES: Record<number, Scene> = {
  1: {
    needs: "any description of what is on the page",
    speaker: "owl",
    crowd: { silent: "wh", oneWord: "wh", phrase: "openEnded", sentence: "openEnded" },
    probes: () => ({
      wh: [
        "Who is on your page right now?",
        "What are they holding?",
        "Where are they standing?",
      ],
      openEnded: [
        "Tell me everything you can see?",
        "What is happening on that page?",
        "What else is going on there?",
      ],
    }),
  },

  2: {
    needs: "a material to build the house from",
    speaker: "pip",
    crowd: { silent: "wh", oneWord: "wh", phrase: "openEnded", sentence: "openEnded" },
    probes: () => ({
      wh: ["What could a house be made of?", "What would you pick up first?"],
      openEnded: [
        "If you were building it, what would you use?",
        "What is the strongest thing you can think of?",
      ],
    }),
  },

  3: {
    needs: "a reason for that material",
    speaker: "owl",
    crowd: { silent: "wh", oneWord: "wh", phrase: "openEnded", sentence: "distancing" },
    probes: (s) => {
      const m = s.material ?? "that";
      return {
        wh: [`What is ${m} like?`, `What happens when you push on ${m}?`],
        openEnded: [
          `Why ${m} and not straw?`,
          `What makes ${m} a good idea?`,
          `What does ${m} do when he blows?`,
        ],
        distancing: [
          `Where have you seen ${m} before?`,
          `What would you build out of ${m}?`,
        ],
      };
    },
  },

  4: {
    needs: "a prediction about what the wolf will do",
    speaker: "pip",
    crowd: { silent: "wh", oneWord: "wh", phrase: "openEnded", sentence: "openEnded" },
    probes: () => ({
      wh: ["What is he going to find?", "What happens when he blows?"],
      openEnded: [
        "What do you think happens next?",
        "How do you think this ends?",
      ],
    }),
  },

  5: {
    needs: "the night retold with two or more events in order",
    speaker: "owl",
    crowd: { silent: "recall", oneWord: "recall", phrase: "recall", sentence: "distancing" },
    probes: (s) => ({
      recall: [
        "What happened first?",
        "And then what happened?",
        "How did it end?",
      ],
      distancing: [
        "What would you have built, if it were your house?",
        `Who would you tell about the ${s.material ?? "house"}?`,
      ],
    }),
  },
};

export const sceneSpeaker = (scene: number): "pip" | "owl" =>
  SCENES[scene]?.speaker ?? "owl";

// ---------------------------------------------------------------------------
// Reading the child's answer.

const FILLER =
  /\b(um+|uh+|er+|hmm+|well|like|maybe|i|think|will|would|use|used|using|with|it|is|was|the|a|an|and|so|then|that|this|my|we|you|can|could|should|be|to|of|for|in|on|do|does|did|have|has|just|really|very|okay|ok|yeah|yes|no)\b/gi;

/** Words left once filler is stripped — the content the child actually gave. */
export function contentWords(text: string | null): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .replace(FILLER, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Principle 2: difficulty follows the length of what the child produced. */
export function answerLevel(text: string | null): AnswerLevel {
  if (!text?.trim()) return "silent";
  const words = text.trim().split(/\s+/).length;
  const content = contentWords(text).length;
  if (content === 0) return "silent"; // "um", "I think" — nothing to build on
  if (words <= 2 || content === 1) return "oneWord";
  if (words <= 5) return "phrase";
  return "sentence";
}

/** The thing the child named, for slot-filling Pip's lines and callbacks. */
export function extractKeyword(text: string | null): string | undefined {
  const words = contentWords(text);
  return words.at(-1);
}

// ---------------------------------------------------------------------------
// Probes. The CROWD type is chosen by code, never by the model.

export function crowdFor(scene: number, level: AnswerLevel): Crowd {
  return SCENES[scene]?.crowd[level] ?? "openEnded";
}

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

export function probesFor(state: State, crowd: Crowd): string[] {
  const bank = SCENES[state.scene]?.probes(state) ?? {};
  const forType = bank[crowd];
  if (forType?.length) return forType;
  // The scene does not offer that type — fall back to whatever it does have.
  return Object.values(bank).flat().filter(Boolean) as string[];
}

export const pickProbe = (state: State, crowd: Crowd): string =>
  pick(probesFor(state, crowd));

export const sceneNeeds = (scene: number): string =>
  SCENES[scene]?.needs ?? "an answer";

// ---------------------------------------------------------------------------
// Pip — templated, no model call. He creates the need; Owl does the teaching.

export function pipLine(state: State, childText: string | null): string {
  const level = answerLevel(childText);

  if (state.scene === 2) {
    // Opening the scene, or re-prompting because nothing usable came back.
    if (level === "silent") {
      return "The wolf comes tonight and I have nothing built! What could a house be made of?";
    }
    return "The wolf comes tonight and I have nothing built! What should I build my house out of?";
  }

  if (state.scene === 4) {
    const m = state.material ?? "that";
    if (level === "silent") {
      return `The last ${m} is laid. He is at the door, taking a big breath. What happens now?`;
    }
    return `${cap(m)} it is — the last one is laid! He is at the door, taking a big breath. What do you think happens now?`;
  }

  return "Oh! Where were we?";
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// The user message for Owl's call. Everything §3 of the guide asks for.

export function buildTurnMessage(
  state: State,
  childText: string | null,
  crowd: Crowd,
  level: AnswerLevel
): string {
  const known = [
    state.material && `the child chose ${state.material}`,
    state.reason && `their reason was "${state.reason}"`,
  ]
    .filter(Boolean)
    .join("; ");

  const CROWD_BRIEF: Record<Crowd, string> = {
    completion: "COMPLETION — leave a sentence for the child to finish out loud",
    recall: "RECALL — ask them to remember something that already happened",
    openEnded: "OPEN-ENDED — ask them to describe or explain freely",
    wh: "WH — a short who/what/where question that names one thing",
    distancing: "DISTANCING — connect the story to the child's own life",
  };

  const PEER_STEP =
    level === "silent"
      ? "This is a PROMPT. The child gave you nothing, so there is nothing to expand. Ask again, shorter and easier."
      : "This is EVALUATE then EXPAND then REPEAT. Receive it, say it back fuller, then ask.";

  const LEVEL_BRIEF: Record<AnswerLevel, string> = {
    silent: "nothing usable — step the question down to its simplest form",
    oneWord: "one word — keep the next question small and concrete",
    phrase: "a short phrase — you can ask for a little more",
    sentence: "a full sentence — they are warmed up, so ask something harder",
  };

  return [
    `Scene ${state.scene}. This scene is finished once the child gives ${sceneNeeds(state.scene)}.`,
    childText?.trim()
      ? `The child just said, word for word: "${childText.trim()}"`
      : "The child has said nothing for three seconds.",
    `That is ${LEVEL_BRIEF[level]}.`,
    known && `Already known: ${known}.`,
    ``,
    `Use this question type this turn: ${CROWD_BRIEF[crowd]}`,
    PEER_STEP,
    ``,
    `Questions of the right shape for this turn — match their type, do not copy the words:`,
    ...probesFor(state, crowd).slice(0, 3).map((p) => `  "${p}"`),
    ``,
    `ADVANCE: yes if the child has now given ${sceneNeeds(state.scene)}, otherwise ADVANCE: no.`,
  ]
    .filter((l) => l !== undefined && l !== false && l !== "" || l === "")
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------

export function parseReply(raw: string): { line: string; advance: boolean } {
  const advance = /ADVANCE:\s*yes/i.test(raw);

  // Normal path: LINE: holds everything the child hears, so reasoning the
  // model leaks above it can never be spoken.
  const marked = raw.match(/LINE:\s*([\s\S]*)$/i);
  if (marked?.[1]?.trim()) {
    return { line: marked[1].replace(/\s+/g, " ").trim(), advance };
  }

  // Format drift: strip the control lines and keep the last question only.
  // Reasoning runs before the question, so this leaves it behind.
  const rest = raw
    .replace(/^\s*ADVANCE:.*$/gim, "")
    .replace(/^\s*-{3,}\s*$/gm, "")
    .trim();

  const questions = rest.match(/[^.!?\n]*\?/g);
  const line = (questions?.at(-1) ?? rest.split(/\n+/).pop() ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return { line, advance };
}

// ---------------------------------------------------------------------------
// §4: what ensureQuestion checks, in priority order.

const CLOSED_OPENER =
  /^(is|are|am|do|does|did|can|could|will|would|shall|should|have|has|had|was|were|may|might|must)\b/i;

/** The question a line ends on, if any. */
function finalQuestion(line: string): string | undefined {
  const qs = line.match(/[^.!?]*\?/g);
  return qs?.at(-1)?.trim();
}

export function isYesNoQuestion(question: string): boolean {
  return CLOSED_OPENER.test(question.replace(/^[^a-z]*/i, ""));
}

/**
 * The child's only turn-taking signal is a rising question, and the commonest
 * failure is a closed one. Checked here rather than trusted to the prompt.
 *
 * 1. a question is present
 * 2. it is not answerable with yes or no
 * 3. the line is more than a bare echo
 */
export function ensureQuestion(line: string, state: State, crowd: Crowd): string {
  const spoken = line.trim();
  const question = finalQuestion(spoken);

  // Completion prompts are the one type that may close — they are finished
  // out loud rather than answered.
  const closedIsFine = crowd === "completion";

  const ok =
    !!question &&
    (closedIsFine || !isYesNoQuestion(question)) &&
    spoken.length > 3;

  if (ok) return spoken;

  const probe = pickProbe(state, crowd);

  // Keep whatever Owl said before the bad question — that part is the
  // expansion, which is the half that teaches.
  const lead = question ? spoken.slice(0, spoken.lastIndexOf(question)).trim() : spoken;

  return lead ? `${lead.replace(/[.!?\s]+$/, ".")} ${probe}` : probe;
}

// ---------------------------------------------------------------------------
// Fallbacks. Spoken instead of silence, a beep, or a stack trace.

export const FALLBACKS = {
  /** Recognition failed. Owl, never Pip — failure sounds curious, not panicked. */
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
  /** Three seconds of silence: shorter and easier than the question that got none. */
  silence: [
    "What do you think?",
    "What comes into your head first?",
    "Tell me any part of it?",
  ],
  /** A second silence. Closed on purpose — a stuck child needs a way back in. */
  silenceTwice: ["Straw, or bricks?", "Sticks, or something stronger?"],
  /** Anything unhandled. Wire this to the catch-all. */
  recover: ["Whoops, I tripped over a brick! Where were we?"],
};

export const pickFallback = (kind: keyof typeof FALLBACKS): string =>
  pick(FALLBACKS[kind]);

// ---------------------------------------------------------------------------
// Read-along. The narrator's lines while the child reads a speech bubble out
// loud. Templated, no model call — a stuck reader needs the word now.

/** Reads the stuck word and hands it back. Varies so a repeat is not a loop. */
export function coachLine(word: string, tries: number): string {
  const w = word.replace(/[^A-Za-z']/g, "");
  if (tries === 1) return `That word says ${w}. Now you say it: ${w}.`;
  if (tries % 2 === 0) return `Listen close. ${w}. Your turn!`;
  return `${w}. ${w}. What does this word say?`;
}
