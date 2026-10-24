/**
 * What a child can build a house from, and how the wolf treats it.
 * No imports — prompts.ts and story.ts both depend on this file.
 *
 * Branching in Story Quest is deliberately small: ONE fork, at the wolf test.
 * The material's strength decides whether the house holds. Anything the
 * lexicon does not know ("ice cream", "legos") is accepted as creative and
 * the outcome follows the child's own prediction instead — their reasoning,
 * not a menu, moves the story.
 */

export type Strength = "weak" | "medium" | "strong" | "unknown";

type Entry = { name: string; words: string[]; strength: Strength };

const MATERIALS: Entry[] = [
  { name: "straw", words: ["straw", "hay"], strength: "weak" },
  { name: "sticks", words: ["stick", "sticks", "twig", "twigs", "branch", "branches"], strength: "weak" },
  { name: "grass", words: ["grass", "leaf", "leaves", "flower", "flowers"], strength: "weak" },
  { name: "paper", words: ["paper", "cardboard", "tissue"], strength: "weak" },
  { name: "wood", words: ["wood", "wooden", "log", "logs", "plank", "planks", "timber"], strength: "medium" },
  { name: "mud", words: ["mud", "clay", "dirt"], strength: "medium" },
  { name: "glass", words: ["glass"], strength: "medium" },
  { name: "bricks", words: ["brick", "bricks"], strength: "strong" },
  { name: "stone", words: ["stone", "stones", "rock", "rocks", "concrete", "cement", "boulder", "boulders"], strength: "strong" },
  { name: "metal", words: ["metal", "iron", "steel", "tin"], strength: "strong" },
];

const INDEX = new Map<string, Entry>();
for (const e of MATERIALS) for (const w of e.words) INDEX.set(w, e);

/** Things a child says that are not materials. */
const NON_MATERIAL = new Set([
  "house", "houses", "home", "pig", "pigs", "pip", "owl", "wolf", "thing", "things",
  "something", "anything", "stuff", "building", "build", "built", "made", "make",
  "one", "two", "new", "big", "little", "small", "page", "book", "story",
]);

export type Material = { name: string; strength: Strength; known: boolean };

const tokens = (text: string) =>
  text.toLowerCase().replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);

/** The last known material the child named — self-corrections trend last. */
export function findMaterial(text: string | null): Material | undefined {
  if (!text) return undefined;
  let hit: Entry | undefined;
  for (const t of tokens(text)) hit = INDEX.get(t) ?? hit;
  return hit && { name: hit.name, strength: hit.strength, known: true };
}

/** An unlisted material: accept up to the last two content words, never a non-material. */
export function guessMaterial(content: string[]): Material | undefined {
  const words = content.filter((w) => !NON_MATERIAL.has(w) && w.length > 1);
  if (!words.length) return undefined;
  return { name: words.slice(-2).join(" "), strength: "unknown", known: false };
}

/** Every word that means "the material" — so a reason is not just the material said again. */
export function materialWords(name: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!name) return out;
  for (const t of tokens(name)) out.add(t);
  MATERIALS.find((e) => e.name === name)?.words.forEach((w) => out.add(w));
  return out;
}

/** The alternative Owl contrasts against: "Why bricks and not sticks?" */
export function contrastFor(name: string, strength: Strength | undefined): string {
  const alt = strength === "weak" ? "bricks" : strength === "unknown" ? "straw" : "sticks";
  return alt === name ? "straw" : alt;
}
