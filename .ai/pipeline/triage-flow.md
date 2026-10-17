---
id: pipeline/triage-flow
type: decision
summary: Posts are prefiltered then triaged in batches via opencode/DeepSeek: stdin-only prompts, deny-all sandbox, in-memory retry; verified on opencode 1.19.3
tags: [triage, opencode, deepseek, prefilter, subprocess, untrusted-input]
paths: [apps/server/src/env-file.ts, apps/server/src/llm/opencode-env.ts, apps/server/src/triage/**, apps/server/src/posts.ts, apps/server/src/doctor.ts, apps/extension/src/panel/flagged-view.ts, apps/server/src/llm/**, apps/server/src/sandbox.ts, fixtures/opencode-run.jsonl]
related: [capture/passive-capture-invariants, tooling/lean-v1-scaffold]
status: active
updated: 2026-10-17
---

# Triage flow

**Decision:** after ingest, untriaged posts pass the pure `prefilter` (older than `triage.maxAgeHours`
or below `triage.minEngagement` -> stored as `skip_reason`, never sent to the LLM; mention of `handle`
or `watchlist` author -> `must_flag`, exempt from the engagement floor but NOT from age: mentions
use `triage.mentionMaxAgeHours` (72), watchlist posts `maxAgeHours` (24); unknown `postedAt` = fresh). Candidates go to opencode (`models.triage`) in
batches of `triage.batchSize` (15), run immediately at >= 15 pending or 30s after the first pending
post. Serial (in-memory flag), 3 attempts with exponential backoff (60s on rate-limit text). Restart
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
added to the Flagged list at read time (`listFlaggedPosts` + `mustFlagFor`, scan of the newest 500
untriaged posts) with a synthetic triage (`score: null`, no error) the panel labels "triage pending".
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
