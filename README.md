# TaleTail

**Small voice. Big adventure.** A read-along picture book in which the child reads part of the story out loud and talks with the characters.

Built at Cal Hacks 13.0 for the Cartesia track.

**Deployed on:** https://story-with-highlight.vercel.app/

The child plays the youngest of the Three Little Pigs. A narrator and three characters speak, each in their own voice. When it is the child's turn, a line appears in a speech bubble and each word lights up as the child reads it correctly. If the child gets stuck on a word, the narrator says it and has the child repeat it. Between scenes, the pigs ask the child open questions ("What would you build with?" "Why did it stay standing?") and reply to what the child actually said.

## How it works

| Piece | What it does |
|---|---|
| **Cartesia Ink** (speech-to-text) | Hears the child, streaming 16 kHz PCM over a WebSocket |
| **Cartesia Sonic** (text-to-speech) | Speaks four voices: narrator, first pig, second pig and wolf, plus an optional voice for Foxy. Each is given its own speed and volume. |
| **Claude** (`@anthropic-ai/sdk`) | Replies to free answers that the templates don't cover, and answers Foxy questions. It has a short timeout and a scripted fallback. |
| `server.ts` | Bun server that runs the script, holds the mic and audio session, and handles stuck-word coaching and barge-in |
| `web/` | Next.js app built from the TaleTail Figma: the illustrated pages, speech bubbles and word highlighting |
| `index.html` | A plain fallback client served by the Bun server itself |

### The story
- **`story.ts`** holds the fixed script as a list of steps (`scene`, `screen`, `say`, `read`, `ask`, `demoStop`). The first pig asks the follow-up questions, the second pig gives the explanations, and the wolf just says his lines.
- **`reader.ts`** checks the read-aloud lines word by word. It allows for homophones, contractions ("I will" for "I'll") and dropped endings ("work" for "worked"). After 5 seconds without progress, the narrator coaches the stuck word until the child says it back.
- **`questions.ts`** classifies the child's free answers (material, reason, unsure…) and picks a reply from templates. It falls back to Claude only when no template fits.
- **`foxy.ts`**: the child can say "hey Foxy" at any time to ask a question. Foxy answers from the story so far without spoiling what comes next, and goes away when the child says "I'm done, Foxy".

## What we use from Cartesia

Voice is not a wrapper around this app; it is the only way in. The child never
touches a keyboard, and on the bookshelf they open a book by saying its name.

**Ink 2** — speech-to-text over a WebSocket, 16 kHz PCM:
- **Semantic turn detection.** Ink decides when the child has finished a
  thought, so there is no silence threshold to tune. A six-year-old pauses
  mid-sentence to think; a VAD would cut them off and we would have built the
  wrong thing.
- **Partial transcripts** (`turn.update`) drive the word-by-word highlighting.
  Words light up while the child is still reading, not after.
- The same stream powers the wake word. "Hey Foxy" is matched on a partial, so
  the interruption lands before the child has finished saying it.

**Sonic 3.5** — text-to-speech over a WebSocket, streamed back as raw PCM:
- **Five voices** from one API key — narrator, two pigs, the wolf, Foxy. The
  narrator, the wolf and Foxy are Cartesia library voices.
- **Instant voice cloning for the two pigs.** The pigs are the child's older
  brothers, and an adult doing a pig voice sounds like an adult doing a pig
  voice. We cloned them from royalty-free child-voice samples (Pixabay), which
  is the one thing in this build a library voice could not have given us.
- **`generation_config` per speaker.** The narrator reads at `speed: 0.65` so a
  child can follow; the cloned pigs get `volume: 2.0`, because a small voice
  recorded quietly does not carry against a narrator.
- **`context_id` abandonment** is how barge-in works. When the child speaks, we
  stop the context mid-line and the browser drops everything still queued.
- **`continue` with `max_buffer_delay_ms: 0`** streams Foxy's answer sentence by
  sentence, so he starts talking before the model has finished writing.

**Measured, not estimated.** The server logs the time from the child's last word
to the first audio byte, and `?op=1` shows it live:

| Path | Child stops speaking → first audio |
|---|---|
| Scripted reply (templates in `questions.ts`) | **82–114 ms** |
| Claude in the loop (free answers, Foxy) | 1–2 s |

## Privacy

Children's voices are among the most sensitive inputs a system can take, so the
handling is deliberately boring.

- **Nothing is written to disk.** No database, no log file, no browser storage.
- **Transcripts are not even printed.** The `[ink]` and `[answer]` lines are
  behind `DEBUG=1`, off by default, so a child's words do not end up in a
  terminal's scrollback.
- **Memory is wiped when the story ends** and again when the tab closes —
  `forget()` in `server.ts`.
- **No accounts, no profiles, no identifiers.** The system does not know who the
  child is and has no way to find out.
- **Input and output are screened** (`story-engine/safety.ts`), and the
  characters are constrained to the story.

What we cannot claim: audio and transcripts still travel to Cartesia and to
Anthropic, and what those vendors retain is their policy, not ours. Cartesia's
zero-data-retention option is enterprise-only, so we cannot enable it on a
hackathon account. For a real product used by children that is the first thing
we would negotiate; until then the honest statement is that nothing is retained
*on our side*.

## Run it locally

You need [Bun](https://bun.com) (`curl -fsSL https://bun.sh/install | bash`).

```bash
bun install
cp .env.example .env        # then fill it in (see below)
bun run server.ts           # story server on http://localhost:3000

cd web && bun install && bun run dev   # app on http://localhost:3001
```

Open http://localhost:3001 and allow the microphone. On the bookshelf, say
**"The Three Little Pigs"** — or just "pigs" — to open it, or click the cover.

**Use headphones**: without them, the voices coming out of the speakers can be picked up by the mic.

URL options:
- `?demo`: stops after the short demo cut, at "Your Building Idea".
- `?op=1`: operator view, with the transcript and latency.

### Environment

Everything goes in the root `.env`. One Cartesia key covers every voice; each voice only needs its ID.

```
CARTESIA_API_KEY=
ANTHROPIC_API_KEY=
NARRATOR_VOICE_ID=
FIRST_PIG_VOICE_ID=
SECOND_PIG_VOICE_ID=
WOLF_VOICE_ID=
FOXY_VOICE_ID=          # optional, defaults to the narrator
```

The web app connects to `ws://localhost:3000/ws` by default. To point it at a deployed server, set `NEXT_PUBLIC_STORY_SERVER`.

## Deploy

The server and the web app are deployed separately:
- **Story server**: deploy to Railway, or any host that runs Bun. It uses the `bun run server.ts` start command, reads `PORT`, and needs the env vars above.
- **Web app**: deploy `web/` to Vercel, with `NEXT_PUBLIC_STORY_SERVER=wss://<your-server>/ws`.

[INTEGRATION.md](INTEGRATION.md) has the details and the known open issues.

## Troubleshooting

- **`bun: command not found` in a new terminal**: add Bun to your shell profile, then open a new terminal:
  `export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"`
- **No audio, and the story can't hear you**: check your Cartesia credits. A `402 quota_exceeded` response stops both speech and listening.
- **A word won't light up**: restart `bun run server.ts` after any change to `reader.ts`, and use headphones.

## Known limitations

- **English only.** Ink 2 is English-only at present.
- **One story.** The scene graph in `story.ts` is hand-authored. Generalising to
  any picture book is the real open problem, not a packaging exercise.
- **Untested with actual children.** The design follows the dialogic-reading
  literature (see [ABOUT.md](ABOUT.md)), but everything we believe about how a
  seven-year-old behaves with this is an assumption until it is watched.
- **Noisy rooms are hard.** Recognition degrades, and a child misheard twice
  gives up faster than an adult would.
- **Network dependent.** Both APIs are remote; there is no offline mode.
- **It cannot see the book.** If the child describes the page wrong, the story
  goes along with it.
- **Shared voices.** The pig voices are instant clones living on one team
  member's Cartesia account; another key needs its own voice IDs in `.env`.
- **Demo voice casting.** The cloned pig voices come from royalty-free Pixabay
  samples, which is fine for a hackathon build. A product shipped to families
  would cast and contract child voice talent, with consent on the record.

## More docs

- [ABOUT.md](ABOUT.md): the idea, the research it follows, and why it is voice-first.
- [HANDOFF.md](HANDOFF.md): design notes on the read-along and the script.
- [INTEGRATION.md](INTEGRATION.md): how the frontend and server connect, and how to deploy them.
- [web/README.md](web/README.md): notes for the frontend.

The Three Little Pigs is a public-domain story.
