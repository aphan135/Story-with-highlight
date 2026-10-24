/**
 * Read-along. The child reads a line out loud and each word lights up only
 * once Ink hears it, in order. A word that has not come after STUCK_MS is
 * read to the child by the narrator, and read again until the child says it back.
 *
 * "Said right" means Ink transcribed the expected word. Ink is a transcriber,
 * not a phoneme scorer: a mispronunciation it hears as a different word (or
 * nothing) does not count, but a near miss it still hears as the right word
 * does. That is the honest limit of this check.
 */

/** One line or page for the child to read. */
export type Page = { words: string[] };

export const STUCK_MS = 5000;

/** Lowercase, punctuation off, digits spelled out — "3," and "Three" match. */
export function norm(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  return DIGITS[w] ?? w;
}

const DIGITS: Record<string, string> = {
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
  "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
};

/** Ink cannot tell these apart from sound, so neither do we. */
const SOUNDS_SAME = [
  ["to", "too", "two"],
  ["there", "their", "theyre"],
  ["no", "know"],
  ["blew", "blue"],
  ["by", "buy", "bye"],
  ["one", "won"],
  ["for", "four"],
  ["hair", "hare"],
  ["in", "inn"],
  ["new", "knew"],
  ["right", "write"],
];

/** Ink may write out a contraction the book prints short: "I will" for "I'll". */
const CONTRACTIONS: [RegExp, string][] = [
  [/\bi will\b/g, "ill"],
  [/\bi am\b/g, "im"],
  [/\bcan not\b|\bcannot\b/g, "cant"],
  [/\blet us\b/g, "lets"],
  [/\bwe will\b/g, "well"],
  [/\byou will\b/g, "youll"],
];

function heardWords(transcript: string): string[] {
  let text = transcript.split(/\s+/).map(norm).filter(Boolean).join(" ");
  for (const [long, short] of CONTRACTIONS) text = text.replace(long, short);
  return text.split(" ").filter(Boolean);
}

export function sameWord(heard: string, expected: string): boolean {
  if (heard === expected) return true;
  // Ink often adds or drops a plural s on children's speech.
  if (heard === expected + "s" || expected === heard + "s") return true;
  return SOUNDS_SAME.some((g) => g.includes(heard) && g.includes(expected));
}

export class Reader {
  page = 0;
  /** Words read so far on this page; also the index of the word to say next. */
  word = 0;
  /** The word being coached, and how many times it has been said. */
  stuck: { word: number; tries: number } | null = null;
  lastProgressAt = performance.now();
  lastTranscript = "";
  /** Tokens of the current Ink turn already matched to a word. */
  private used = 0;

  private pages: Page[];

  constructor(pages: Page[]) {
    this.pages = pages;
  }

  get words(): string[] {
    return this.pages[this.page]?.words ?? [];
  }

  /** The word the child has to say next. */
  get target(): string {
    return this.words[this.word] ?? "";
  }

  get pageDone(): boolean {
    return this.word >= this.words.length;
  }

  get lastPage(): boolean {
    return this.page >= this.pages.length - 1;
  }

  /** Ink transcripts are per turn, so matching restarts at each turn. */
  startTurn() {
    this.used = 0;
    this.lastTranscript = "";
  }

  /**
   * Feed a partial or final transcript for the current turn. Unmatched words
   * are skipped, so a misread word holds the pointer where it is until the
   * child says it right. Returns whether any word lit up.
   */
  feed(transcript: string): boolean {
    this.lastTranscript = transcript;
    const heard = heardWords(transcript);
    const before = this.word;

    for (let i = this.used; i < heard.length && !this.pageDone; i++) {
      if (!sameWord(heard[i]!, norm(this.target))) continue;
      this.used = i + 1;
      this.word++;
      this.stuck = null;
    }

    if (this.word === before) return false;
    this.lastProgressAt = performance.now();
    return true;
  }

  /** Turns the page. Tokens already used this turn stay used. */
  nextPage() {
    this.page++;
    this.word = 0;
    this.stuck = null;
    this.lastProgressAt = performance.now();
  }

  isStalled(now: number): boolean {
    return !this.pageDone && now - this.lastProgressAt >= STUCK_MS;
  }

  /** Marks the current word as coached. Returns which attempt this is. */
  coach(): number {
    const tries = this.stuck?.word === this.word ? this.stuck.tries + 1 : 1;
    this.stuck = { word: this.word, tries };
    this.lastProgressAt = performance.now();
    return tries;
  }

  /** The five seconds count from when the voice stops talking, not when it starts. */
  restartClock() {
    this.lastProgressAt = performance.now();
  }
}
