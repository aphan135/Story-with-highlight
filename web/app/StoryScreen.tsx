import Image, { type StaticImageData } from "next/image";
import type { Line, Reading, Status } from "../lib/useStory";
import opening from "../public/figma/scene-opening.png";
import housesFall from "../public/figma/scene-houses-fall.png";
import conversation from "../public/figma/scene-conversation.png";
import s from "./TaleTail.module.css";

// Story page, from the TaleTail Figma DEMO frames (15:423, 35:724, 35:744, 35:775, 54:375):
// full-bleed illustration, a paper text bar for the narrator, speech bubbles
// for the characters, and the child's READ ALOUD line with word highlighting.

type Props = {
  status: Status;
  /** Scene title from ../story.ts. */
  scene: string | null;
  narration: string;
  line: Line | null;
  reading: Reading | null;
  error: string | null;
  onRestart(): void;
  onExit(): void;
};

// ponytail: Figma has art for the first three scenes; later scenes reuse the
// conversation art. Add a title here when its illustration exists.
const ART: Record<string, StaticImageData> = {
  "A House of Your Own": opening,
  "Two Houses Fall": housesFall,
  "Your Building Idea": conversation,
};

// Who speaks from where, after the Figma frames: the first (eldest) pig on the
// left (DEMO 01a), the second (middle) pig in the centre (DEMO 08). The wolf
// shares the left spot, where he stands in the houses-fall art.
const SPOT = { firstPig: s.left, secondPig: s.center, wolf: s.left } as const;

export default function StoryScreen({ status, scene, narration, line, reading, error, onRestart, onExit }: Props) {
  const listening = status === "listening" || status === "reading";
  const spoken = !reading && line && line.speaker !== "narrator" && (status === "speaking" || status === "listening") ? line : null;

  return (
    <main className={`${s.stage} ${s.sky}`}>
      <div className={`${s.abs} ${s.scene}`}>
        <Image src={(scene && ART[scene]) || (scene ? conversation : opening)} alt="" fill sizes="100vw" priority />
      </div>
      <p className={`${s.abs} ${s.storyLogo}`}>TaleTail</p>

      {reading ? (
        // The child reads this aloud, above the youngest pig (Figma DEMO 05).
        // Each word lights up once the server hears it.
        <p className={`${s.bubble} ${s.child} ${s.reading}`} aria-live="polite">
          {reading.words.map((w, i) => (
            <span key={i} className={`${s.w} ${i < reading.progress ? s.wRead : ""} ${i === reading.progress ? s.wNext : ""} ${i === reading.stuck ? s.wStuck : ""}`}>
              {w}
            </span>
          ))}
          <Tail />
        </p>
      ) : spoken && spoken.speaker !== "narrator" ? (
        <p className={`${s.bubble} ${SPOT[spoken.speaker]}`}>
          {spoken.text}
          <Tail />
        </p>
      ) : null}

      <div className={`${s.abs} ${s.textBar}`} role="status">
        <p className={s.storyText}>
          {status === "error" ? error ?? "Oops — the story got stuck."
            : status === "connecting" ? "Opening the book…"
            : status === "done" && !narration ? "The End"
            : narration}
        </p>
        {listening && (
          <div className={s.wave} style={{ ["--level" as string]: 0.6 }} aria-label={status === "reading" ? "Read it out loud" : "Your turn to answer"}>
            <i /><i /><i /><i /><i />
          </div>
        )}
        {status === "error" && <button className={`${s.primary} ${s.barButton}`} onClick={onRestart}>Try again</button>}
        {status === "done" && <button className={`${s.primary} ${s.barButton}`} onClick={onExit}>Back to stories</button>}
      </div>
    </main>
  );
}

const Tail = () => <img src="/figma/speech-tail.svg" alt="" className={s.tail} />;
