"use client";

import { useEffect, useState } from "react";
import { useStory } from "../lib/useStory";
import { Bookshelf, Home, MicHelp, VoiceCheck, VoiceSetup, requestMic } from "./Onboarding";
import StoryScreen from "./StoryScreen";
import Operator from "./Operator";
import s from "./TaleTail.module.css";

type Screen = "home" | "setup" | "check" | "help" | "shelf" | "story";

export default function App() {
  const story = useStory();
  const [screen, setScreen] = useState<Screen>("home");
  const [asking, setAsking] = useState(false);
  const [operator, setOperator] = useState(false);
  useEffect(() => { setOperator(new URLSearchParams(window.location.search).get("op") === "1"); }, []);

  // The shelf listens: Ink is live and waiting to hear a title.
  function toShelf() {
    setScreen("shelf");
    story.start({ pick: true });
  }

  // Said the title, or opened the cover — either way the server has begun.
  useEffect(() => { if (story.picked) setScreen("story"); }, [story.picked]);

  async function askForMic() {
    setAsking(true);
    setScreen((await requestMic()) ? "check" : "help");
    setAsking(false);
  }

  // Opening the cover is the click that starts audio (browsers need a gesture).
  // The shelf connection is already open, so this only tells it to go.
  function openStory() {
    story.pick();
  }

  function exitStory() {
    story.stop();
    toShelf();
  }

  return (
    <div className={s.fit}>
      {screen === "home" && <Home onBegin={() => setScreen("setup")} />}
      {screen === "setup" && <VoiceSetup busy={asking} onEnable={askForMic} onBack={() => setScreen("home")} />}
      {screen === "check" && <VoiceCheck onContinue={toShelf} onHelp={() => setScreen("help")} onBack={() => setScreen("setup")} />}
      {screen === "help" && <MicHelp busy={asking} onRetry={askForMic} onBack={() => setScreen("setup")} />}
      {screen === "shelf" && <Bookshelf onPick={openStory} />}
      {screen === "story" && (
        <StoryScreen
          status={story.status}
          scene={story.scene}
          image={story.image}
          narration={story.narration}
          line={story.line}
          reading={story.reading}
          foxy={story.foxy}
          foxyLine={story.foxyLine}
          partial={story.partial}
          answer={story.answer}
          error={story.error}
          onRestart={story.start}
          onExit={exitStory}
        />
      )}
      {operator && <Operator {...story} onRestart={story.start} />}
    </div>
  );
}
