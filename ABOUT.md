# TaleTail

**A voice-only companion that turns a child's one-word answers into explained thinking.**

Cal Hacks 13.0 · Cartesia track · October 2026

---

## 1. What this is

A child aged 6–9 sits with a paper picture book. Next to them, a laptop they
cannot see. Two characters live in the speaker: **Pip**, a pig who needs help,
and **Owl**, a neighbour who asks questions.

The child reads. The characters talk with them about what they are reading. When
the child says "bricks", Owl asks why bricks and not sticks. The story does not
move until the child has explained their own reasoning — and when it moves, it
moves on what they said.

There is no screen, no app to look at, no buttons. The book is paper. Everything
else is voice.

## 2. The problem

Children's media is one-directional. Kids listen to stories, watch stories, and
read stories. They are almost never asked to *produce* anything — to explain a
choice, justify a guess, or tell the events back in order.

This matters because the gap it leaves is specific and well-studied. Between
ages 6 and 9, children are building three things at once:

- **Expressive language** — getting an idea out of your head in a sentence
  someone else can follow
- **Verbal reasoning** — attaching a *because* to a decision
- **Narrative structure** — putting events in an order that makes sense to a
  listener

All three are built by *talking*, not by listening. And the thing that builds
them fastest is a particular kind of conversation: an adult who reads with a
child, stops, and asks open questions about what is happening.

The catch is that this requires a patient adult, one-to-one, who knows not to
answer their own questions. That adult is not always available. A parent reading
at the end of a long day asks "did you like it?" and gets "yes", and the moment
passes.

## 3. Why this is a voice problem, not an app problem

The obvious product here is an app: a tablet, an animated book, tap-to-choose
branches. We think that is the wrong shape, for three reasons.

**A screen competes with the book.** The child is already looking at something —
paper, which is where the pictures and the words are. A second screen splits
attention and quietly becomes the main event.

**Tapping is not talking.** A multiple-choice branch asks the child to
*recognise* an option. Speaking asks them to *produce* one. The whole learning
outcome lives in that difference, and a touch interface removes it.

**No screen forces the child to supply context.** Our system cannot see the
book and does not track the page. So the first thing it does is ask: "Where are
you up to — what's happening on your page?" The child has to describe it. That
constraint, which looks like a limitation, *is* the first exercise.

This is why Cartesia is not an integration here. Strip the voice out and there is
no product left — not a degraded product, no product at all.

## 4. How it works

```
paper book (child's hands and eyes)

browser tab ──PCM16──→ local server ──→ Cartesia Ink 2   (speech in, turn detection)
                            │
                            ├──→ Claude   (one question, scene state)
                            │
browser tab ←──audio──── server ←──── Cartesia Sonic 3.5  (two character voices)
```

Everything runs on one laptop. The browser holds the microphone and the speaker;
a local server holds the API keys and the story logic.

**Cartesia Ink 2** handles speech in. We rely on its semantic turn detection
rather than a silence timer, which matters more here than in most voice products:
children pause mid-sentence, constantly, and a fixed threshold would cut them off
exactly when they are working hardest to express something.

**Cartesia Sonic 3.5** gives the two characters distinct voices. Pip is higher
and faster; Owl is lower and slower. In a screenless product the voices are the
only way the child knows who is speaking, so the separation has to survive laptop
speakers in a noisy room.

**Claude** generates one question per turn, under a tight prompt, and decides
whether the child's answer satisfied the scene.

## 5. The mechanic

The core loop is four moves:

| | What happens | Example |
| --- | --- | --- |
| **Prompt** | Pip asks an open question | "What should I build mine out of?" |
| **Answer** | The child says something short | "Bricks!" |
| **Probe** | Owl repeats their word and asks for the reason | "Bricks! Why bricks and not sticks?" |
| **Advance** | The story moves on the child's reasoning | "Too heavy to blow over — let's lay them before dark." |

Three rules make it work, and all three are prohibitions:

1. **Owl never completes the child's thought.** Given "because heavy", the
   tempting reply is "because bricks are too heavy for him to blow down, right?"
   That hands the child the exact thing we want them to produce. Owl takes the
   fragment and asks for the rest instead.
2. **No yes/no questions.** "Will it hold?" gets a yes and the turn is wasted.
   Every question is open.
3. **Every turn ends on a question.** Without a screen, the rising intonation at
   the end of a question is the only signal the child gets that it is their turn.
   This is enforced in code, not just in the prompt.

## 6. Grounding

The mechanic above is not invented. It closely follows **dialogic reading**, an
established shared-reading practice in which the adult's job is to get the child
talking about the book rather than to read it to them. Its standard prompt
sequence — prompt, evaluate, expand, repeat — is the loop in the table above, and
its emphasis on open-ended and *wh-* questions over yes/no questions is where our
second rule comes from.

What we are doing is not replacing that adult. It is making the practice
available at the moments when no adult is free to do it — and doing it with more
patience than a tired human has at 8pm.

**We have not validated this.** Nothing here has been tested with children. The
design follows an evidence-based practice; whether this particular
implementation produces the outcome is an open question, and we would want
early-childhood educators involved before claiming otherwise.

## 7. What makes this different

**Voice is load-bearing, not decorative.** Most voice features are a TTS layer on
a product that works fine without it. Remove the screen from ours and it still
works; remove the voice and nothing remains.

**It asks instead of telling.** Almost every AI product for children explains
things. This one is built around refusing to explain — the system's job is to not
answer, which is a harder constraint to hold than it sounds and is why the
prohibitions above are enforced in code.

**The child's reasoning changes the story.** Not a branch they selected from a
menu. The material they named and the reason they gave are stored and quoted back
at them later, including at the moment their prediction turns out to be right.

**It meets the child where they already are.** On paper, with a book they
already own. No subscription to a content library, no new screen in a child's
life.

**It works with any edition.** The story is a folk tale in the public domain,
so the system can discuss it freely with no rights problem — and the child's
copy can be any version from any publisher, because the system asks them what is
on the page rather than assuming.

## 8. Scope for the hackathon

One complete adventure — *The Three Little Pigs* — in five scenes:

1. **Orient** — the child describes where they are in the book
2. **Choice** — Pip asks what to build his house from
3. **Reason** — Owl probes for the *why*
4. **Test** — the wolf arrives; the child's reasoning is tested
5. **Retelling** — the child narrates the whole night back

With two distinct Cartesia voices, live speech both directions, adaptive
follow-up questions, memory of what the child invented, and a callback to their
own reasoning at the climax.

**Deliberately out of scope:** multiple stories, user accounts, saved progress,
age-adaptive difficulty, pronunciation and intonation exercises, any screen for
the child.

## 9. Known limitations

Stated plainly, because they will be asked about and because pretending
otherwise is worse than owning them.

- **English only.** Ink 2 is English-only at present.
- **One story.** The scene graph is hand-authored. Generalising to arbitrary
  books is the main open engineering problem, not a packaging exercise.
- **Untested with actual children.** See §6. Everything we know about how a
  seven-year-old behaves with this is an assumption.
- **Noisy rooms are hard.** Recognition degrades, and a child who is misheard
  twice will give up faster than an adult would.
- **Network dependent.** Both APIs are remote; there is no offline mode.
- **It cannot see the book.** If the child describes the page wrong, the system
  goes along with it.

## 10. Responsibility

Children's voices are among the most sensitive inputs a system can take, so the
handling is deliberately boring:

- **Audio is discarded after transcription.** Nothing is written to disk: no
  database, no log file, no browser storage.
- **State lives in memory for the session only.** What the child said is wiped
  when the story ends, and again when the tab closes (`forget()` in
  `server.ts`). Transcripts are not printed either unless a developer sets
  `DEBUG=1`.
- **No accounts, no profiles, no identifiers.** The system does not know who the
  child is and has no way to find out.
- **Content is filtered before it reaches the child**, and the characters are
  constrained to the story — they will not discuss anything else.
- **The adult is not removed.** This is built to be used near a parent, not
  instead of one, and the best version of this is a child who then goes and tells
  someone what happened in their book.

What we cannot claim: the audio and the transcript still travel to Cartesia and
to Anthropic, and what those vendors keep is their policy, not ours. Cartesia's
zero-data-retention option is enterprise-only, so we cannot enable it on a
hackathon account. For a real product used by children that is the first thing
we would negotiate, and until it is in place the honest statement is that
nothing is retained *on our side*.

## 11. Where it goes next

- More public-domain tales, then a general mode that works with any book by
  asking the child what is happening rather than knowing the plot
- Difficulty that adapts to the child's age and to how much they are already
  producing unprompted
- A retelling transcript for a parent or teacher — not a score, just what their
  child said
- Validation with early-childhood educators, which is the step that would turn
  §6 from a design rationale into a claim

---

*Built at Cal Hacks 13.0 with Cartesia Sonic 3.5, Cartesia Ink 2, and Claude.*
