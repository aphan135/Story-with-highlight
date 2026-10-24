# Integration — how the pieces connect

Two parts, deployed separately:

```
web/ (Next.js, Vercel)  ──mic PCM16 16k──▶  server.ts (Bun, Railway)  ──▶ Cartesia Ink / Sonic
   TaleTail Figma UI    ◀──scene, line,──     runs story.ts step by step     (+ Claude for
                           read, audio…        reader.ts, questions.ts        unmatched answers)
```

- `server.ts` owns the story, the voices and every API key. Nothing secret is
  in `web/`.
- `web/` is a static frontend. `web/lib/storySocket.ts` is a port of the client
  in `index.html`: same messages, same audio handling. `index.html` still works
  as the plain fallback at `http://localhost:3000`.

## Run locally

```bash
bun install                      # repo root
cp .env.example .env             # CARTESIA_API_KEY, NARRATOR/FIRST_PIG/SECOND_PIG/WOLF_VOICE_ID (+ ANTHROPIC_API_KEY)
bun run server.ts                # http://localhost:3000
cd web && bun install && bun run dev    # http://localhost:3001
```

- `?demo` stops at the script's `demoStop`, same as `index.html`.
- `?op=1` opens the operator panel (status, scene, latency, what Ink hears,
  transcript, restart).

## The protocol `web/` depends on (owned by server.ts)

server → page: `scene {title, art, caption}`, `screen`, `line {id, speaker,
line, question}`, `read {words}`, `progress {word}`, `stuck {word}`,
`readDone`, `end {demo}`, `partial`, `latency`, `audio`, `audio_done`,
`stop_audio`. page → server: binary mic audio, and `{type: "played", id}` once
a line has finished playing.

If you change or add a message in `server.ts`, mirror it in
`web/lib/storySocket.ts` (types) and `web/lib/useStory.ts` (state).

## If you work on the story (`story.ts`, `questions.ts`, `reader.ts`)

- **Scene art** is chosen by scene title in `ART` in `web/app/StoryScreen.tsx`
  ("A House of Your Own", "Two Houses Fall", "Your Building Idea"). Renaming a
  scene means updating that map; new scenes fall back to the conversation art.
- **Speakers → bubbles**: `firstPig` speaks from the eldest pig (left),
  `secondPig` from the middle pig (centre), `wolf` from the left; `narrator`
  lines go in the text bar. New speakers need a spot in `SPOT`.

## If you work on the UI

- Built from the TaleTail Figma file (`UI`, key `1UQ5Z6urZiTHCjBU1Zun8n`).
  Flow in `web/app/App.tsx`: Home → grown-up voice setup → voice check (live
  mic waveform) → microphone help if blocked → Bookshelf → story.
- `web/app/Onboarding.tsx` (pre-story screens) and `web/app/StoryScreen.tsx`
  (story page) take props only. `web/app/TaleTail.module.css` writes every
  length as Figma px × `var(--u)` on the 1194 × 834 frame, so values copy
  straight from Figma. Tokens (`--sq-*`) are in `web/app/globals.css`.
- Figma exports live in `web/public/figma/`. The read-aloud word highlight
  colour (`--sq-mark`) comes from `index.html`; Figma doesn't define one yet.
- Not wired yet: choosing a story by voice ("Say 'The Three Little Pigs'");
  clicking the cover starts it.

## Deploy

- **Story server → Railway.** Repo root, start command `bun run server.ts`,
  networking target port 3000. Env vars: the same as `.env`. Railway gives a
  public `https://…` URL; the WebSocket is `wss://<that host>/ws`.
- **Web → Vercel.** Root Directory `web`. Env var
  `NEXT_PUBLIC_STORY_SERVER=wss://<railway host>/ws`.
- **Open issue in `server.ts`:** the Cartesia key is sent as `api_key=` in the
  Ink/Sonic URLs, and Bun prints that URL in WebSocket errors, so the key ends
  up in the logs. Send it as a header instead (Bun's `new WebSocket(url, {
  headers })`) before deploying.
- **Open issue:** anyone who can reach the server's `/ws` can start a session
  on our Cartesia credit. Add a shared token check before sharing the URL.
