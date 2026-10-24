# Handoff — Story Quest

**For an AI assistant or teammate picking this up cold.** Read this first,
then `ABOUT.md` for the why. Last updated 2026-10-24 11:25 PDT, Cal Hacks 13.0.

---

## 0. Situation

- **Event:** Cal Hacks 13.0, San Francisco, Oct 23–25 2026. Submitting to the
  **Cartesia** track ("Best Use of Cartesia").
- **Deadline:** Devpost submission Sunday morning. *Confirm the exact time
  against the live site before trusting any schedule.*
- **Team:** four on paper (A voice / B engine / C audio / D producer). In
  practice one person has built all of it so far. Re-scope against who is
  actually present.
- **Machine:** Windows, PowerShell, `C:\SNU\2026-2\CalHacks`, Bun 1.4.4.
  Repo `github.com/gildong1/story-quest` (private).

## 1. What it is

A child aged 6–9 reads a paper copy of *The Three Little Pigs*. Two voice
characters — **Pip** (a pig who needs help) and **Owl** (who asks the
questions) — talk with them through a laptop they cannot see. A one-word
answer gets a follow-up asking for the reason, and the story only moves once
the child has explained their thinking.

**There is no screen for the child.** Central commitment, not a limitation.

## 2. Current state — it runs

| Piece | State |
| --- | --- |
| Voice round trip (mic → Ink → engine → Sonic → speaker) | **Working** |
| Latency, mock engine (no model in path) | **82–114 ms** |
| Latency, real engine (model in path, non-streaming) | ~1.0–1.9 s |
| Barge-in (child interrupts, playback stops) | **Working** |
| Ink transcription | **Working** — accurate on adult speech |
| Owl via Claude, CROWD + PEER | Wired, quality being tuned |
| Pip | Templated, **no model call** — scenes 2 and 4 are instant |

Known-good commands: `bun run server.ts`, then `localhost:3000`, press
"Start listening".

## 3. Hard-won facts — do not re-derive these

Each cost a debugging cycle.

- **Ink sends the transcript as `msg.transcript`, not `msg.text`.** Reading
  the wrong field gives empty strings and the engine thinks the child is
  silent forever.
- **Ink 2 does semantic turn detection.** There is no VAD threshold to tune
  and no silence timer to set. Events: `turn.start`, `turn.update`,
  `turn.eager_end`, `turn.end`. `turn.eager_end` is an early signal that could
  later be used to start the model call sooner.
- **`temperature` is rejected by `claude-haiku-5-5`** — 400, "Extra inputs are
  not permitted".
- **Do not stream the model response.** Filtering stream deltas on
  `text_delta` silently dropped the entire body whenever the call carried the
  child's words. Non-streaming + filtering `content` blocks on `type === "text"`
  is what works. Revisit streaming only with a diagnostic in place.
- **Assistant prefill was tried and reverted** — it 400'd and could not be
  verified. The `LINE:` parser is the real defence, not prefill.
- **Barge-in cannot be gated on a server-side `speaking` flag.** Sonic
  delivers a whole line in ~200 ms while the browser plays it over several
  seconds, so the server thinks it has finished speaking when the child can
  still hear it. The server sends `stop_audio` unconditionally; the browser
  decides whether anything is playing.
- **Concurrent `respond()` calls overlap** now that the engine takes ~1 s. A
  turn sequence number discards superseded responses (`[skip]` in the log).

## 4. Design decisions — do not silently reverse

**Reversed 2026-10-24: the child now reads from the screen, and the story is
a fixed script.** The original design (no child-facing screen, Pip & Owl,
CROWD/PEER via the model) was deliberately replaced. Now:

- `story.ts` is the full script, step by step: scenes, narration, READ ALOUD
  bubbles, FREE RESPONSE questions, and a `demoStop` (open `/?demo` to stop
  there for the short live demo).
- Four voices: narrator, first pig, second pig, wolf. The child is the
  youngest pig and speaks into the mic. **The first pig asks every follow-up
  question; the second pig gives every explanation.** The wolf only has lines.
- READ ALOUD (`reader.ts`): each word lights up only when Ink hears it; a
  word stuck for 5 s is read aloud by the narrator and repeated until the
  child says it back. "Said right" means Ink transcribed the expected word —
  not phoneme-level scoring.
- FREE RESPONSE (`questions.ts`): the script's branches are matched in code
  and spoken from templates. Only an answer no branch covers goes to
  `claude-haiku-5-5`, to reflect the child's own words back.
- `engine.ts`, `mockEngine.ts` and the Owl/Pip parts of `prompts.ts` are no
  longer used by the server.

**Public domain story only.** A modern picture book would be an IP problem in
a judged, published submission.

**CROWD types are assigned in code, never chosen by the model.** Research
(Yılmaz & Yurtbakan 2025) shows adults drift toward Open-ended/Wh- and ignore
Completion; an LLM drifts the same way. `SCENES[n].crowd` maps answer level →
CROWD type.

**Difficulty follows the child's last answer.** `answerLevel()` returns
silent / oneWord / phrase / sentence; filler-only input ("um", "I think")
counts as silent. Short answers step the question down, full sentences step it
up.

**Owl runs PEER, Pip carries affect.** Owl: evaluate → expand → repeat, one
model call. Pip: templates with slots, no model call. This is both the
research split and the latency decision.

**Three prohibitions, enforced in different places:**
1. *Owl never completes the child's thought* — prompt only, not mechanically
   checkable. This is the rule that makes the product worth anything.
2. *No yes/no questions* — `isYesNoQuestion()` checks the final question's
   opening word and swaps in a probe if closed.
3. *Every turn ends on a question* — `ensureQuestion()`. Without a screen the
   rising intonation is the child's only turn signal.

**Reply format is `ADVANCE:` / `LINE:`.** The parser reads only what follows
`LINE:`, so reasoning the model leaks above it can never be spoken. On format
drift it falls back to the last question in the text. Do not "clean this up"
into JSON — and do not put the spoken line first again, which is how model
reasoning got read aloud to the child once already.

## 5. Next steps, in order

1. Confirm Owl's line quality now that the response is read correctly.
2. Sound cues for listening start/stop — there is no screen, so this is the
   child's only feedback. Nothing exists yet.
3. Rehearse against the demo script; record a backup video.
4. README (setup, Cartesia features used, known limitations), `.env.example`,
   Devpost.
5. Optional latency work: stream sentence-by-sentence to Sonic via `onToken`
   (the callback exists, `server.ts` does not use it), or start the model call
   on `turn.eager_end`.

## 6. Not built

Sound cues, scene ambience, operator view beyond the minimal transcript,
README, `.env.example`, Devpost entry, demo video, anything past scene 5.

## 7. Reference material not in this repo

A planning document lives as a Claude artifact: the 2-minute demo script with
timings, the character bible, the probe bank, voice-selection procedure, phase
timeline, role split, checkpoints and cut list. **Ask the user for the link**
rather than reconstructing it — especially the demo script, which is the
source of truth for the scene graph.

A second document, the *Pip & Owl Dialogue Generation Guide*, is the research
spec `prompts.ts` was refactored against (CROWD, PEER, difficulty calibration,
the quality rubric in its §6). Ask for it before changing dialogue logic.

## 8. Cut list, strictly top-down

1. Expressive-speaking activities — already out of scope
2. Scene ambience and audio polish
3. Age-adaptive difficulty
4. The retelling scene — reluctantly; say in the pitch that it is next
5. **Do not cut:** memory callbacks — cheap, and it is the moment judges remember
6. **Do not cut:** the second character — two distinct voices *is* the Cartesia argument
7. **Never cut:** one working scene with a voice round trip and a scaffolding follow-up

Cut on sight if proposed: accounts, saved progress, settings screens, multiple
adventures, anything needing a database.

## 9. Judging criteria

Cartesia track, 25% each: problem and originality; use of Cartesia; execution;
impact and responsibility. Deliverables: working demo; 2-minute demo-first
presentation; README with setup, Cartesia features used and known limitations;
source access for judges with **no API keys in the repo**.

The responsibility quarter is the one most teams skip. `ABOUT.md` §10 is real
and implementable in about ten minutes — implement it, then say so in the
README and the pitch.

## 10. Tone note

The user is under time pressure and does not need encouragement. What helps:
naming the one thing that matters now, flagging when a plan has drifted from
reality, and saying plainly when something written earlier turned out to be
wrong — which has happened several times in this project, each time logged in
§3. What does not help: expanding scope, adding unrequested features, or
agreeing with a plan that no longer fits the people actually in the room.
