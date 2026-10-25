"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import coverPigs from "../public/figma/cover-pigs.png";
import coverRed from "../public/figma/cover-red.png";
import coverGold from "../public/figma/cover-goldilocks.png";
import s from "./TaleTail.module.css";

// Screens before the story, from the TaleTail Figma frames:
// Home (7:263), Voice setup (7:264), Voice check (15:275), Microphone help (15:322), Bookshelf (15:369).

const Fox = ({ className }: { className: string }) => (
  <img src="/figma/fox.svg" alt="" className={`${s.abs} ${className}`} />
);

export function Home({ onBegin }: { onBegin(): void }) {
  return (
    <main className={s.stage}>
      <img src="/figma/orange-rise.svg" alt="" className={`${s.abs} ${s.rise}`} />
      <Fox className={s.foxHome} />
      <p className={s.logo}>TaleTail</p>
      <div className={`${s.abs} ${s.welcome}`}>
        <h1 className={s.hero}>Small voice.<br />Big adventure.</h1>
        <p className={s.heroSub}>Step into a story.<br />Make it yours with your voice.</p>
      </div>
      <button className={`${s.primary} ${s.begin}`} onClick={onBegin}>Let’s begin</button>
      <p className={`${s.abs} ${s.grownUp}`}>A little help from a grown-up to get started.</p>
    </main>
  );
}

function SetupFrame({ onBack, children }: { onBack(): void; children: React.ReactNode }) {
  return (
    <main className={`${s.stage} ${s.apricot}`}>
      <Fox className={s.foxSetup} />
      <p className={s.logo}>TaleTail</p>
      <button className={s.back} onClick={onBack}>Back</button>
      <div className={`${s.abs} ${s.setup}`}>{children}</div>
    </main>
  );
}

export function VoiceSetup({ onEnable, onBack, busy }: { onEnable(): void; onBack(): void; busy: boolean }) {
  return (
    <SetupFrame onBack={onBack}>
      <p className={s.eyebrow}>With a grown-up</p>
      <h1 className={s.title}>Let’s get<br />ready to talk.</h1>
      <section className={s.notice} aria-labelledby="before-we-begin">
        <h2 id="before-we-begin">Before we begin</h2>
        <p>TaleTail uses the microphone to hear your child and respond. Audio is sent to Cartesia for speech recognition; some recognized text is sent to Anthropic to generate replies.</p>
        <p>Please avoid sharing names, addresses, schools, or other personal details. A grown-up should stay nearby.</p>
      </section>
      <p className={s.bodyStrong}>You can speak naturally — even while a character is talking.</p>
      <button className={s.primary} onClick={onEnable} disabled={busy}>
        {busy ? "Waiting for permission…" : "Enable microphone"}
      </button>
    </SetupFrame>
  );
}

export function VoiceCheck({ onContinue, onHelp, onBack }: { onContinue(): void; onHelp(): void; onBack(): void }) {
  const wave = useMicLevel(onHelp);
  return (
    <SetupFrame onBack={onBack}>
      <p className={s.eyebrow}>Voice check</p>
      <h1 className={s.titleSm}>Can you say<br />“Hello, fox”?</h1>
      <p className={s.body}>When you speak, the listening waves should move.</p>
      <div className={s.wave} ref={wave} role="img" aria-label="Microphone level"><i /><i /><i /><i /><i /></div>
      <button className={s.primary} onClick={onContinue}>Choose a story</button>
      <button className={s.link} onClick={onHelp}>Microphone not working?</button>
    </SetupFrame>
  );
}

export function MicHelp({ onRetry, onBack, busy }: { onRetry(): void; onBack(): void; busy: boolean }) {
  return (
    <SetupFrame onBack={onBack}>
      <p className={s.eyebrow}>With a grown-up</p>
      <h1 className={s.titleSm}>Let’s check<br />the microphone.</h1>
      <p className={s.body}>Allow microphone access in your device or browser settings, then try again.</p>
      <button className={s.primary} onClick={onRetry} disabled={busy}>Try again</button>
      <p className={s.foot}>Voice is needed to take part in the story.</p>
    </SetupFrame>
  );
}

export function Bookshelf({ onPick }: { onPick(): void }) {
  return (
    <main className={s.stage}>
      <p className={s.logo}>TaleTail</p>
      <h1 className={`${s.abs} ${s.shelfTitle}`}>Your next adventure</h1>
      <p className={`${s.abs} ${s.shelfSub}`}>Which story shall we step into?</p>
      <div className={`${s.abs} ${s.shelf}`} />
      <Fox className={s.foxShelf} />
      <p className={`${s.abs} ${s.invite}`}>Pick a story<br />with me!</p>
      <button className={`${s.cover} ${s.coverPigs}`} onClick={onPick} aria-label="The Three Little Pigs">
        <Image src={coverPigs} alt="" fill sizes="20vw" priority />
      </button>
      {/* Only The Three Little Pigs is playable; the others are shelf dressing. */}
      <div className={`${s.cover} ${s.coverRed}`} aria-label="Little Red Riding Hood (coming soon)" role="img">
        <Image src={coverRed} alt="" fill sizes="20vw" />
      </div>
      <div className={`${s.cover} ${s.coverGold}`} aria-label="Goldilocks and the Three Bears (coming soon)" role="img">
        <Image src={coverGold} alt="" fill sizes="20vw" />
      </div>
      <p className={`${s.abs} ${s.shelfHint}`}>Say “The Three Little Pigs”<br />or open its cover.</p>
    </main>
  );
}

/** Ask for the microphone once. Resolves true if allowed. */
export async function requestMic(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch {
    return false;
  }
}

/** Drives the waveform from the live mic level by writing --level on the element (no re-renders). */
function useMicLevel(onFail: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const failed = useRef(onFail);
  failed.current = onFail;

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let frame = 0;
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
          // ponytail: fixed gain; speech RMS is ~0.02-0.2, so x6 fills the bars.
          ref.current?.style.setProperty("--level", Math.min(1, rms * 6).toFixed(3));
          frame = requestAnimationFrame(tick);
        };
        tick();
        stop = () => { cancelAnimationFrame(frame); stream.getTracks().forEach(t => t.stop()); void ctx.close(); };
      } catch {
        if (!cancelled) failed.current();
      }
    })();
    return () => { cancelled = true; stop(); };
  }, []);

  return ref;
}
