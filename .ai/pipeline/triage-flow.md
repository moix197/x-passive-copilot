---
id: pipeline/triage-flow
type: decision
summary: Posts are prefiltered then triaged in batches via opencode/DeepSeek: stdin-only prompts, deny-all sandbox, in-memory retry; verified on opencode 1.19.3
tags: [triage, opencode, deepseek, prefilter, subprocess, untrusted-input]
paths: [apps/server/src/env-file.ts, apps/server/src/llm/opencode-env.ts, apps/server/src/triage/**, apps/server/src/posts.ts, apps/server/src/doctor.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/panel/flagged-feeds.ts, apps/server/src/llm/**, apps/server/src/sandbox.ts, fixtures/opencode-run.jsonl]
related: [capture/passive-capture-invariants, tooling/lean-v1-scaffold, pipeline/model-quota, pipeline/copy-keeps-to-reply]
status: active
updated: 2026-10-20
---

# Triage flow

**Decision:** after ingest, untriaged posts pass the pure `prefilter` (older than `triage.maxAgeHours`
or below `triage.minEngagement` -> stored as `skip_reason`, never sent to the LLM; mention of `handle`
or `watchlist` author -> `must_flag`, exempt from the engagement floor but NOT from age: mentions
use `triage.mentionMaxAgeHours` (72), watchlist posts `maxAgeHours` (24); unknown `postedAt` = fresh). Candidates go to opencode (`models.triage`) in
batches of `triage.batchSize` (15), run immediately at >= 15 pending or 30s after the first pending
post. Serial (in-memory flag), 3 attempts with backoff, never on quota/rate errors (model fallback + pause: pipeline/model-quota). Restart
just re-picks untriaged rows (no queue table). Failed batches store a coarse `error` class
(`timeout`, `rate limit`, `malformed output`, `cli failed`), never raw CLI output.

**Why:** tweet text is hostile. Prompt goes over stdin only (never argv); `shell:false`; npm `.cmd`
shims resolved to `[node, script.js]` (`resolve-cli.ts`); 120s timeout kills the tree with
`taskkill /T /F`; 2 MB stdout cap; tweets are JSON (`<` escaped) inside `<posts>` with an
"untrusted data" instruction; opencode runs in `<home>/sandbox/opencode` whose `opencode.json`
(rewritten before each run) denies all tools; output is zod-parsed per item, unknown/duplicate ids
dropped, invalid items -> "triage error".

**Provider:** triage now targets Gemini's free API via opencode's built-in `google` provider
(`models.triage: google/gemini-3.8-flash`) because opencode's free tier rejects requests server-side.
`GEMINI_API_KEY` comes from `<repo root>/.env`, loaded at startup by `env-file.ts`
(`process.loadEnvFile`, existing env wins, missing file fine; root = nearest `pnpm-workspace.yaml`
above `src/` or `dist/`). Doctor: `google/*` -> opencode ok iff key set, else fix points at `.env`.

**Rejected:** persistent job queue (v1 trade-off); `shell:true` for shims; letting the model see
tools.

**Constraints it creates:** logs carry statusIds, error classes and a `safeReason` (<= 200 chars of
CLI/provider error text: exit code + stderr, or opencode's `error` event name/message); never prompt
or model text. Stored `triage.error` stays the coarse class. Flagged hides stored must-flag rows past their age limit (`isWithinAgeLimit`, by `posted_at`). Must-flag posts with no triage row are
merged into the Flagged list at read time (`listFlaggedPosts` + `mustFlagFor`) with a synthetic triage (`score: null`, no error) the panel labels "triage pending". Flagged has two sub-feeds (`feed=to_reply|replied`, response carries `counts`). To reply = unreplied eligible posts, newest flagged first (score is not a sort key): `manual_flag_at`, else `triage.triaged_at`, else (still pending) `captured_at`, ties newest `seq`. Eligibility: a merely reply-worthy row (no must-flag, no manual flag) needs `triage.score >= triage.minFlagScore` (default 80, `isBelowScoreFloor` in `posts.ts`, applied at read time so old stored rows drop out too; pending/must-flag/manual always show); every row (reply-worthy too, not only must-flag) hides once past `maxAgeHours` (24h; mentions `mentionMaxAgeHours` 3 days; manual never), so inline pills share it. The age filter runs while paging the SQL (batches of 200) over ALL eligible rows, then sorts in memory and slices to `limit`, so stale rows cannot crowd out fresh ones. "Load more" (both feeds, `flagged-feeds.ts`): the panel starts at `limit=100` and adds 100 per click, and every poll re-requests the whole loaded window (flagged cap 1000) so refresh never drops loaded pages; the button hides when `counts` (always totals) <= loaded; open editors stay pinned by `flagged-view.ts`. Replied = `posts.replied_at IS NOT NULL` ordered `replied_at DESC`, exempt from the age limits and from the 30-day prune (`prunePosts` skips them). `replied_at` is a nullable `posts` column (added via `ADDED_COLUMNS`); `POST /v1/posts/:id/replied {replied}` sets/clears it (`setReplied` keeps the first time on repeat marks; 404 unknown id). The panel marks a post replied only via the Mark replied / Move back buttons (Copy does not: see pipeline/copy-keeps-to-reply), moves the card optimistically (`flagged-feeds.ts`) and refetches until no move overlapped the poll.
Live model quirks absorbed by the parser: missing `roughDraft` = `""`; a bad array followed by a
"corrected" one falls back to the last `[{`. `models.triage` empty
disables triage (posts stay pending). `context.md` (<= 8 KB, `<home>/context.md`) is read per batch.
`mention` = text contains `@handle` OR `replyTo` (captured reply targets) contains `handle`,
case-insensitive.

**opencode sandbox config:** `tools` has `"*": false` plus explicit denies, `permission` has
`"*": "deny"` plus explicit per-tool denies, `mcp: {}`. Global MCP servers merge in from the user's
config, so `"*": false` (which also matches MCP tool names) is the real guard. Wildcards work.
**Exception, `read`:** opencode's free-tier gateway returns 403 `FreeTierError` ("can only be used
from within OpenCode") when the request's tool list lacks `read`, and a fully denied permission drops
the tool. So `tools.read: true` and `permission.read = {"*": "deny", "xc-no-such-file.never": "allow"}`:
the tool is offered but every read is denied. Probed live: list/read inside and outside the sandbox
all denied, no shell tool offered.

**Verified (opencode 1.19.3, `opencode/deepseek-v4.1-flash-free`, no login):** stdin prompt is read.
Events: `step_start`, `text` (`part.text`), `tool_use` (`part.tool`, `part.state.status`),
`step_finish` (`part.reason`: `tool-calls` or `stop`), `error` (exit 1). Parser keeps only the last
step's text and fails closed on any `completed` tool_use. opencode exits 1 on error events, so
`runOpencode` uses `runCli({ allowNonZeroExit })` to read the event's message. Doctor: `0 credentials`
is ok when `models.triage` matches `opencode/*-free`. `fixtures/opencode-run.jsonl` is a real
recording. npm shim resolves to `node_modules/opencode-ai/bin/opencode.exe` (spawned directly).

**Retry a failed triage:** `POST /v1/posts/:id/retriage` (token auth, 404 unknown, 409 when the post has no
`error` row or would now be skipped, e.g. past its age limit: the error row is kept and the message says why,
503 without `models.triage`, 202 `queued` with `resumesAt` while paused). `TriageService.retriage` deletes only
the error row (`clearTriageError`), then `drain(true)` + `armTimer()`, so quota pause/fallback and the age
prefilter apply unchanged; must-flag posts show "triage pending" meanwhile. The Flagged first-draft area shows
a Retry button next to "triage error" (`flagged-view.ts`, refusal text kept per post across polls). No "Retry
all" control: it needs a bulk route and UI state for little gain.
