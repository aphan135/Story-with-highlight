/**
 * The Three Little Pigs — full script, step by step. Public domain story.
 *
 * Roles:
 *   narrator   — tells the story
 *   firstPig   — asks every follow-up question
 *   secondPig  — gives every explanation and acknowledgment
 *   wolf       — a character with lines, nothing more
 *   the child  — the youngest pig, speaking into the mic (no voice of its own)
 *
 * The story is fixed. Only the question steps (questions.ts) adapt to what the
 * child says. Read lines are checked word by word (reader.ts).
 */

export type Speaker = "narrator" | "firstPig" | "secondPig" | "wolf";

export type QuestionId = "buildingIdea" | "whyStanding" | "tellStory";

export type Step =
  /** A new scene: title plus what is on screen. */
  | { kind: "scene"; title: string; art: string; caption: string }
  /** The picture changes inside a scene. */
  | { kind: "screen"; art: string; caption: string }
  | { kind: "say"; speaker: Speaker; line: string }
  /** READ ALOUD — the child reads this from a speech bubble. */
  | { kind: "read"; line: string }
  /** FREE RESPONSE — the child answers in their own words. */
  | { kind: "ask"; question: QuestionId }
  /** The short live demo ends here. */
  | { kind: "demoStop" };

const scene = (title: string, art: string, caption: string): Step => ({ kind: "scene", title, art, caption });
const screen = (art: string, caption: string): Step => ({ kind: "screen", art, caption });
const say = (speaker: Speaker, line: string): Step => ({ kind: "say", speaker, line });
const read = (line: string): Step => ({ kind: "read", line });
const ask = (question: QuestionId): Step => ({ kind: "ask", question });

export const SCRIPT: Step[] = [
  // --- DEMO START ----------------------------------------------------------
  scene("A House of Your Own", "🌾 🐖 🐖 🐷 🌾",
    "Three little pigs stand in a field. The youngest pig steps forward."),
  say("narrator", "Three little pigs were building homes of their own."),
  read("I'll build a house, too!"),

  scene("Two Houses Fall", "🛖   🪵🏠", "The straw house, then the wooden house."),
  say("narrator", "But a wolf blew down the straw house, then the wooden house!"),
  screen("🐺💨   🐖 🐖 ➡️ 🐷", "Both older pigs escape and run toward the youngest pig."),

  scene("Your Building Idea", "🐖 🐖 🐷", "The pigs gather around the youngest pig."),
  ask("buildingIdea"),
  screen("🐖 🐖 🐷", "The second pig nods at the youngest pig."),

  { kind: "demoStop" },

  // --- FULL STORY CONTINUES ------------------------------------------------
  scene("Look at the Materials Together", "🧱 🧱 🧱   🐖 🐖 🐷", "The pigs examine the materials."),
  say("firstPig", "Let's look at the materials together. There are some bricks here, too!"),
  say("narrator", "The pigs looked carefully at the bricks. They learned how mortar could hold them together."),
  say("secondPig", "Let's stack them carefully and join them firmly."),

  scene("Build Together", "🧱 🐖 🐖 🐷 🧱", "The pigs get ready to build."),
  say("firstPig", "This time, we'll all help!"),
  read("Let's build a strong house together!"),
  say("narrator", "Brick by brick, the pigs built their house. They worked carefully until it was finished."),
  screen("🧱🏠", "The brick house is finished."),

  scene("The Wolf Returns", "🐺 🚪 🧱🏠", "Someone is at the door."),
  say("narrator", "Then came a knock at the door."),
  say("wolf", "Little pigs, little pigs, let me come in!"),
  read("No! You can't come in!"),
  say("wolf", "Then I'll huff, and I'll puff, and I'll blow your house down!"),
  say("narrator", "The wolf blew. Whoooosh! Then he blew again. Whoooooosh!"),
  screen("🐺💨 🧱🏠", "The brick house stays standing."),
  say("narrator", "But the house did not fall down. At last, the wolf gave up and went away."),

  scene("Why Did It Stay Standing?", "🧱🏠 🐖 🐖 🐷", "The pigs are safe inside."),
  ask("whyStanding"),

  scene("Tell Our Story", "🛖 ➡️ 🪵🏠 ➡️ 🧱🏠", "The straw house, the wooden house and the brick house."),
  ask("tellStory"),
  say("firstPig", "Thanks for helping us think it through, little brother!"),
  read("I'm glad we worked together!"),
  say("narrator", "And the three little pigs lived happily together in the house they had built."),
];
