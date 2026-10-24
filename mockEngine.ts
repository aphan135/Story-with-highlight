/**
 * Fake StoryEngine. Same signature as the real one, no model call.
 *
 * Purpose: unblock A's voice pipeline immediately, and let latency be measured
 * without the LLM in the path — whatever this reports is pure Ink + Sonic.
 * Replace with the real engine later; nothing on A's side changes.
 */

import { initialState, type State } from "./prompts";

export type Turn = {
  speaker: "pip" | "owl";
  line: string; // always ends in "?"
  state: State;
  done: boolean;
};

const SCRIPT: Array<{ speaker: "pip" | "owl"; line: string }> = [
  { speaker: "owl", line: "You're back! Where are you up to — what's happening on your page?" },
  { speaker: "owl", line: "Building houses! Who hasn't built theirs yet?" },
  { speaker: "pip", line: "That's me — and the wolf comes tonight. What should I build mine out of?" },
  { speaker: "owl", line: "Bricks! Why bricks and not sticks?" },
  { speaker: "owl", line: "Heavy — so what happens when the wolf blows on them?" },
  { speaker: "pip", line: "Too heavy to blow over — let's lay them before dark. Can you find that page?" },
  { speaker: "pip", line: "Last brick in. Shh — he's at the door. Owl, why didn't it fall?" },
  { speaker: "owl", line: "You said that before he even got here. Can you tell me the whole night?" },
  { speaker: "owl", line: "Beginning, middle, end — and you gave the reason. Shall we read on?" },
];

export const StoryEngine = {
  initial: initialState,

  async next(childText: string | null, state: State): Promise<Turn> {
    const i = state.events.length;
    const beat = SCRIPT[i];
    if (!beat) return { speaker: "owl", line: "That's our story. Shall we read another?", state, done: true };

    return {
      ...beat,
      state: { ...state, events: [...state.events, childText ?? "(silence)"] },
      done: false,
    };
  },
};
