"use client";

import { useEffect, useRef, useState } from "react";
import { connectStory, type ServerMessage, type Speaker } from "./storySocket";
import { yourTurn } from "./cues";

export type { Speaker };
export type Status = "idle" | "connecting" | "speaking" | "listening" | "reading" | "done" | "error";
export type Line = { speaker: Speaker; text: string; question: boolean };
export type Reading = { words: string[]; progress: number; stuck: number | null };
export type TranscriptEntry = { who: Speaker | "child"; text: string };

/** Story state for the UI, driven by ../server.ts. */
export function useStory() {
  const [status, setStatus] = useState<Status>("idle");
  const [scene, setScene] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [narration, setNarration] = useState("");
  const [line, setLine] = useState<Line | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [partial, setPartial] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const conn = useRef<ReturnType<typeof connectStory> | null>(null);
  // Read inside socket callbacks, which outlive any one render.
  const live = useRef({ question: false, reading: false, partial: "" });

  useEffect(() => () => conn.current?.close(), []);

  function onMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "scene": setScene(msg.title); setImage(msg.image ?? null); break;
      case "screen": if (msg.image) setImage(msg.image); break;
      case "line": {
        live.current.question = msg.question;
        // The server sends only partials, so the last one before the next line
        // is the child's turn as heard.
        const child = live.current.partial;
        live.current.partial = "";
        setLine({ speaker: msg.speaker, text: msg.line, question: msg.question });
        if (msg.speaker === "narrator") setNarration(msg.line);
        setTranscript(t => [...t, ...(child ? [{ who: "child" as const, text: child }] : []), { who: msg.speaker, text: msg.line }]);
        setPartial("");
        if (!live.current.reading) setStatus("speaking");
        break;
      }
      case "read":
        live.current.reading = true;
        setReading({ words: msg.words, progress: 0, stuck: null });
        setStatus("reading");
        if (conn.current) yourTurn(conn.current.audio);
        break;
      case "progress": setReading(r => r && { ...r, progress: msg.word, stuck: null }); break;
      case "stuck": setReading(r => r && { ...r, stuck: msg.word }); break;
      case "readDone":
        live.current.reading = false;
        setReading(r => r && { ...r, progress: r.words.length, stuck: null });
        // Leave the finished line up for a beat, as ../index.html does.
        setTimeout(() => setReading(null), 700);
        break;
      case "partial": live.current.partial = msg.text; setPartial(msg.text); break;
      case "latency": setLatencyMs(msg.ms); break;
      case "end": setStatus("done"); break;
    }
  }

  function onPlayed() {
    // A question has been asked: now it is the child's turn to answer.
    if (live.current.question && !live.current.reading) {
      setStatus("listening");
      if (conn.current) yourTurn(conn.current.audio);
    }
  }

  function start() {
    conn.current?.close();
    live.current = { question: false, reading: false, partial: "" };
    setScene(null); setNarration(""); setLine(null); setReading(null);
    setImage(null);
    setPartial(""); setLatencyMs(null); setTranscript([]); setError(null);
    setStatus("connecting");
    conn.current = connectStory({
      demo: new URLSearchParams(window.location.search).has("demo"),
      onMessage,
      onPlayed,
      onOpen: () => setStatus(s => (s === "connecting" ? "speaking" : s)),
      onClose: clean => {
        if (clean) return;
        setStatus(s => (s === "done" ? s : "error"));
        setError("Lost the connection to the story. Is the story server running?");
      },
    });
  }

  function stop() {
    conn.current?.close();
    conn.current = null;
    setStatus("idle");
  }

  return { status, scene, image, narration, line, reading, partial, latencyMs, transcript, error, start, stop };
}
