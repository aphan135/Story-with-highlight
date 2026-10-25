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

  async function askForMic() {
    setAsking(true);
    setScreen((await requestMic()) ? "check" : "help");
    setAsking(false);
  }

  // Opening the cover is the click that starts audio (browsers need a gesture).
  function openStory() {
    setScreen("story");
    story.start();
  }

  function exitStory() {
    story.stop();
    setScreen("shelf");
  }

  return (
    <div className={s.fit}>
      {screen === "home" && <Home onBegin={() => setScreen("setup")} />}
      {screen === "setup" && <VoiceSetup busy={asking} onEnable={askForMic} onBack={() => setScreen("home")} />}
      {screen === "check" && <VoiceCheck onContinue={() => setScreen("shelf")} onHelp={() => setScreen("help")} onBack={() => setScreen("setup")} />}
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
          partial={story.partial}
          error={story.error}
          onRestart={story.start}
          onExit={exitStory}
        />
      )}
      {operator && <Operator {...story} onRestart={story.start} />}
    </div>
  );
}
