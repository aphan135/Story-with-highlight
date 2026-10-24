import { useEffect, useRef } from "react";
import type { useStory } from "../lib/useStory";
import { STORY_SERVER } from "../lib/storySocket";
import styles from "./Operator.module.css";

type Props = Pick<ReturnType<typeof useStory>, "status" | "scene" | "partial" | "latencyMs" | "error" | "transcript"> & {
  onRestart(): void;
};

export default function Operator({ status, scene, partial, latencyMs, error, transcript, onRestart }: Props) {
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [transcript]);
  return (
    <details className={styles.panel}>
      <summary>Operator</summary>
      <div className={styles.content}>
        <dl>
          <div><dt>Server</dt><dd>{STORY_SERVER}</dd></div>
          <div><dt>Status</dt><dd>{status}</dd></div>
          <div><dt>Scene</dt><dd>{scene ?? "—"}</dd></div>
          <div><dt>Latency</dt><dd>{latencyMs === null ? "—" : `${latencyMs} ms`}</dd></div>
          <div><dt>Hearing</dt><dd>{partial || "—"}</dd></div>
        </dl>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button onClick={onRestart}>Restart story</button>
        <div className={styles.transcript} ref={log} role="log" aria-label="Story transcript" tabIndex={0}>
          {transcript.length === 0 && <p>No lines yet.</p>}
          {transcript.map((entry, index) => <p key={index}><strong>{entry.who}</strong> {entry.text}</p>)}
        </div>
      </div>
    </details>
  );
}
