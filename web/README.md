# TaleTail web

The child-facing app, built from the TaleTail Figma file. Frontend only: it
talks to `../server.ts` over a WebSocket. See [../INTEGRATION.md](../INTEGRATION.md).

```bash
bun run server.ts            # repo root, port 3000 (needs the root .env)
cd web && bun run dev        # http://localhost:3001  (?demo, ?op=1)
```

Verify with `bunx tsc --noEmit` and `bun run build`.
