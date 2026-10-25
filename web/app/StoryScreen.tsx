import Image, { type StaticImageData } from "next/image";
import type { Line, Reading, Status } from "../lib/useStory";
import opening from "../public/figma/scene-opening.png";
import housesFall from "../public/figma/scene-houses-fall.png";
import conversation from "../public/figma/scene-conversation.png";
import bricks from "../public/figma/scene-bricks.png";
import houseBuilt from "../public/figma/scene-house-built.png";
import wolfKnocks from "../public/figma/scene-wolf-knocks.png";
import wolfBlows from "../public/figma/scene-wolf-blows.png";
import wolfLeaves from "../public/figma/scene-wolf-leaves.png";
import whyStanding from "../public/figma/scene-why-standing.png";
import retell from "../public/figma/scene-retell.png";
import ending from "../public/figma/scene-ending.png";
import s from "./TaleTail.module.css";

// Story page, from the TaleTail Figma DEMO frames (15:423, 35:724, 35:744, 35:775, 54:375):
// full-bleed illustration, a paper text bar for the narrator, speech bubbles
// for the characters, and the child's READ ALOUD line with word highlighting.

type Props = {
  status: Status;
  /** Scene title from ../story.ts. */
  scene: string | null;
  image: string | null;
  narration: string;
  line: Line | null;
  reading: Reading | null;
  error: string | null;
  onRestart(): void;
  onExit(): void;
};

// Art is chosen by the image id that story.ts puts on scene/screen steps.
// Full-frame pictures already contain the TaleTail logo and cream text-bar area.
const ART: Record<string, { src: StaticImageData; full: boolean }> = {
  opening: { src: opening, full: false },
  "houses-fall": { src: housesFall, full: false },
  conversation: { src: conversation, full: false },
  bricks: { src: bricks, full: true },
  "house-built": { src: houseBuilt, full: true },
  "wolf-knocks": { src: wolfKnocks, full: true },
  "wolf-blows": { src: wolfBlows, full: true },
  "wolf-leaves": { src: wolfLeaves, full: true },
  "why-standing": { src: whyStanding, full: true },
  retell: { src: retell, full: true },
  ending: { src: ending, full: true },
};

// Who speaks from where, after the Figma frames: the first (eldest) pig on the
// left (DEMO 01a), the second (middle) pig in the centre (DEMO 08). The wolf
// shares the left spot, where he stands in the houses-fall art.
const SPOT = { firstPig: s.left, secondPig: s.center, wolf: s.left } as const;
// In these pictures the wolf stands mid-frame, at the door, so his tail points from the centre.
const WOLF_CENTRE = new Set(["wolf-knocks", "wolf-blows"]);

export default function StoryScreen({ status, scene, image, narration, line, reading, error, onRestart, onExit }: Props) {
  const art = (image && Object.hasOwn(ART, image) ? ART[image] : undefined)
    ?? { src: scene === null ? opening : conversation, full: false };
  const listening = status === "listening" || status === "reading";
  const spoken = !reading && line && line.speaker !== "narrator" && (status === "speaking" || status === "listening") ? line : null;

  return (
    <main className={`${s.stage} ${s.sky}`}>
      <div className={`${s.abs} ${art.full ? s.sceneFull : s.scene}`}>
        <Image src={art.src} alt="" fill sizes="100vw" priority />
      </div>
      {!art.full && <p className={`${s.abs} ${s.storyLogo}`}>TaleTail</p>}

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
        <p className={`${s.bubble} ${spoken.speaker === "wolf" && image && WOLF_CENTRE.has(image) ? s.center : SPOT[spoken.speaker]}`}>
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
