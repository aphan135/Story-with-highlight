# TaleTail — Story Quest

**Small voice. Big adventure.** A read-along picture book in which the child reads part of the story out loud and talks with the characters.

Built at Cal Hacks 13.0 for the Cartesia track.

**Deployed on:** https://story-with-highlight.vercel.app/

The child plays the youngest of the Three Little Pigs. A narrator and three characters speak, each in their own voice. When it is the child's turn, a line appears in a speech bubble and each word lights up as the child reads it correctly. If the child gets stuck on a word, the narrator says it and has the child repeat it. Between scenes, the pigs ask the child open questions ("What would you build with?" "Why did it stay standing?") and reply to what the child actually said.

## How it works

| Piece | What it does |
|---|---|
| **Cartesia Ink** (speech-to-text) | Hears the child, streaming 16 kHz PCM over a WebSocket |
| **Cartesia Sonic** (text-to-speech) | Speaks four voices: narrator, first pig, second pig and wolf, plus an optional voice for Foxy |
| **Claude** (`@anthropic-ai/sdk`) | Replies to free answers that the templates don't cover, and answers Foxy questions. It has a short timeout and a scripted fallback. |
| `server.ts` | Bun server that runs the script, holds the mic and audio session, and handles stuck-word coaching and barge-in |
| `web/` | Next.js app built from the TaleTail Figma: the illustrated pages, speech bubbles and word highlighting |
| `index.html` | A plain fallback client served by the Bun server itself |

### The story
- **`story.ts`** holds the fixed script as a list of steps (`scene`, `screen`, `say`, `read`, `ask`, `demoStop`). The first pig asks the follow-up questions, the second pig gives the explanations, and the wolf just says his lines.
- **`reader.ts`** checks the read-aloud lines word by word. It allows for homophones, contractions ("I will" for "I'll") and dropped endings ("work" for "worked"). After 5 seconds without progress, the narrator coaches the stuck word until the child says it back.
- **`questions.ts`** classifies the child's free answers (material, reason, unsure…) and picks a reply from templates. It falls back to Claude only when no template fits.
- **`foxy.ts`**: the child can say "hey Foxy" at any time to ask a question. Foxy answers from the story so far without spoiling what comes next, and goes away when the child says "I'm done, Foxy".

## Run it locally

You need [Bun](https://bun.com) (`curl -fsSL https://bun.sh/install | bash`).

```bash
bun install
cp .env.example .env        # then fill it in (see below)
bun run server.ts           # story server on http://localhost:3000

cd web && bun install && bun run dev   # app on http://localhost:3001
```

Open http://localhost:3001 and allow the microphone. **Use headphones**: without them, the voices coming out of the speakers can be picked up by the mic.

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

## More docs

- [ABOUT.md](ABOUT.md): the idea and why it is voice-first.
- [HANDOFF.md](HANDOFF.md): design notes on the read-along and the script.
- [INTEGRATION.md](INTEGRATION.md): how the frontend and server connect, and how to deploy them.
- [web/README.md](web/README.md): notes for the frontend.

The Three Little Pigs is a public-domain story.
