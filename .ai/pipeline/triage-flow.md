---
id: pipeline/triage-flow
type: decision
summary: Posts are prefiltered then triaged in batches via opencode/DeepSeek: stdin-only prompts, deny-all sandbox, in-memory retry; event parser unverified
tags: [triage, opencode, deepseek, prefilter, subprocess, untrusted-input]
paths: [apps/server/src/triage/**, apps/server/src/llm/**, apps/server/src/sandbox.ts, fixtures/opencode-run.jsonl]
related: [capture/passive-capture-invariants, tooling/lean-v1-scaffold]
status: active
updated: 2026-10-17
---

# Triage flow

**Decision:** after ingest, untriaged posts pass the pure `prefilter` (older than `triage.maxAgeHours`
or below `triage.minEngagement` -> stored as `skip_reason`, never sent to the LLM; mention of `handle`
or `watchlist` author -> `must_flag`, never skipped). Candidates go to opencode (`models.triage`) in
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

**Rejected:** persistent job queue (v1 trade-off); `shell:true` for shims; letting the model see
tools.

**Constraints it creates:** logs carry statusIds and error classes only. `models.triage` empty
disables triage (posts stay pending). `context.md` (<= 8 KB, `<home>/context.md`) is read per batch.
Reply-to-handle is not detectable (captured posts carry only `isReply`), so `mention` = text contains
`@handle`.

**UNVERIFIED:** opencode was not installed when written. The event parser (`type: text` events with
`part.text`, final `step_finish` with `part.reason != tool-calls`), the stdin prompt handling and the
sandbox keys follow the documented format from memory; `fixtures/opencode-run.jsonl` is a synthetic
sample, not a recording. Re-record with a real `opencode run --format json` and re-verify.
