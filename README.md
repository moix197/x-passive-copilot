# X passive copilot

Chrome side-panel copilot for x.com. It only reads posts you already loaded, sends them to a local
server, and helps you find posts worth replying to. You copy and post by hand.

## Prerequisites

- Windows, Node 22, pnpm
- Chrome (load the extension unpacked)

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | Bundles the extension into `apps/extension/dist` (esbuild) |
| `pnpm typecheck` | `tsc` over server, extension, shared |
| `pnpm test:unit` | vitest (passes with no tests) |
| `pnpm test:e2e [spec]` | Build, then Playwright |
| `pnpm dev:server` | Runs the server with tsx on `127.0.0.1:7457` (`--dev --port N --home DIR`) |
| `pnpm check` | typecheck + test:unit + build |

## First run

1. `pnpm install`
2. `pnpm build`
3. Chrome -> `chrome://extensions` -> Developer mode -> Load unpacked -> `apps/extension/dist`
4. `pnpm dev:server`, then `curl 127.0.0.1:7457/v1/health`
5. Click the extension icon to open the side panel.

## Capture usage

With `pnpm dev:server` running, browse https://x.com normally: posts you scroll past are captured
and listed newest first in the side panel (polls every 3s while open). Posts are stored in
`<home>/posts.db` (30-day prune). The extension targets `http://127.0.0.1:7457` by default; to use
another server set it from the service worker DevTools console:
`chrome.storage.local.set({ serverUrl: 'http://127.0.0.1:PORT' })`.

Config lives in `<home>/config.json` (default home `~/.x-passive-copilot`); missing file means defaults.

## v1 trade-offs

This is an internal, personal-use v1 that optimizes for speed and cost. It intentionally deviates
from CLAUDE.md:

- **Few packages:** `apps/server`, `apps/extension`, `shared/` (types + zod schemas + small
  helpers). No `packages/*` split, no dependency-direction checker.
- **Light tests:** unit tests for pure parsers/guard/prefilter; one Playwright smoke test. Not
  e2e-per-feature; no `@covers` maps; no e2e-regression runs per phase. No lint.
- **No per-phase code review.** One review of the whole change at the end.
- **Deferred (not built in v1):** `check-deps` script, Host/Origin/DNS-rebinding checks, persistent
  job queue (simple in-memory retry instead), claude-haiku fallback chain, idle-RSS measurement,
  exhaustive edge-case tests, Chromium-registry native-host e2e (manual check instead), passivity
  e2e spec (replaced by grep check + manual live check), per-package READMEs, forward/backward
  migration rigor, Telegram, multi-user.
- **Kept:** passivity invariants, untrusted-tweet containment (stdin only, `shell:false`,
  zod-parsed output, `textContent` rendering), 127.0.0.1 bind + per-launch token, hard-rule guard.

## Triage: context.md, watchlist, config

Posts are prefiltered, then triaged against `<home>/context.md` (what you build and want to reply
to; first 8 KB are used) by an LLM through [opencode](https://opencode.ai). Setup:
`pnpm add -g opencode-ai`, `opencode auth login`, then in `<home>/config.json`:

```json
{
  "handle": "yourhandle",
  "watchlist": ["someauthor"],
  "models": { "triage": "opencode/<model-id>" },
  "triage": { "batchSize": 15, "maxAgeHours": 24, "minEngagement": 3 }
}
```

- `models.triage` is required (provider/model id as shown by `opencode models`); empty = triage off.
- Posts older than `maxAgeHours` or with likes+reposts+replies below `minEngagement` show
  "skipped: <reason>" in the All tab and are never sent to the LLM.
- Posts whose text mentions `@handle` and posts by `watchlist` authors are always flagged
  (tagged `mention` / `watchlist`), even if scored low.
- The **Flagged** tab lists reply-worthy posts by score with reason, rough draft and a Copy button.
- A batch runs at 15 pending posts or 30s after the first pending one. Malformed model output marks
  those posts "triage error"; the server keeps running.
- opencode runs in `<home>/sandbox/opencode` with all tools denied; prompts go over stdin only.
- The opencode event parser is built from the documented format and not yet verified against a live
  install.
