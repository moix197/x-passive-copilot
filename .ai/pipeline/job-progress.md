---
id: pipeline/job-progress
type: decision
summary: Idea and polish jobs record real steps in a server-memory registry (GET /v1/jobs?id=); panel and x.com popover poll it 1s and render one shared step-list box
tags: [progress, polling, ideas, polish, regenerate, model-pool, retry, quota, panel, inline]
paths: [apps/server/src/jobs.ts, apps/server/src/digest/progress.ts, apps/server/src/digest/single-idea.ts, apps/server/src/polish/polish.ts, apps/server/src/router.ts, apps/server/src/app.ts, apps/extension/src/panel/job-progress.ts, apps/extension/src/panel/digest-progress.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/content/inline/compose-card.ts, apps/extension/src/content/inline/post-idea.ts, apps/extension/src/content/inline/inline-card.ts, apps/extension/src/content/inline/relay.ts, apps/extension/src/background/inline-relay.ts, apps/extension/src/background/compose-relay.ts, shared/src/types.ts, e2e/generation-progress.spec.ts, e2e/fakes/**]
related: [pipeline/job-reattach, pipeline/digest-progress, pipeline/polish-flow, pipeline/model-quota, capture/compose-ideas, capture/manual-ideas, capture/inline-drafts]
status: active
updated: 2026-10-21
---

# Generation job progress (ideas, polish, regenerate)

**Decision:** `createJobRegistry` (`apps/server/src/jobs.ts`, in memory, lost on restart like digest
progress) holds jobs by id. A step is appended when new; a known id becomes current again (later
steps reset), and staying on the current step keeps its detail (a model switch). `finish` keeps the
first outcome; `close()` in a `finally` fails a job that threw. `slow` = running > `JOB_SLOW_MS`
(90s). Each job carries kind, key, target and result; retention, the list route and reattach are in
`pipeline/job-reattach`. `GET /v1/jobs?id=` (zod `JobIdSchema`) -> 200 `JobEntry` or 404.

**Ids:** ideas use a client-made `idea-<uuid>` sent as `jobId` in `POST /v1/ideas/generate` (the POST
stays synchronous; the client polls in parallel). Polish/regenerate use `polishJobId(draftKey)` =
`polish-<statusId>` (shared), started inside `createPolishService.start`, so auto-polish is tracked too.

**Steps come from the real code paths, never timers:**
- Idea: router `Queued` -> single-idea `Building context ...` -> `Asking <model> (attempt k)` via
  `runModelReported` (shared with the digest: model-pool `onModel`/`onSwitch` give "Quota reached on A,
  switching to B"; the `withRetry` wait gives "<model> under high demand, retrying in Ns") -> `Checking
  the idea` (parse) -> `Saving the idea`. The router ends the job with the same text as the HTTP error
  (`ideaReply`), plus `resumesAt` on a quota pause.
- Polish: `Queued` -> `Polishing with Claude (<models.final>[, attempt k])` (Regenerate: `Writing a new
  version with Claude`) -> `Checking guard (length, product mention, othering)` -> on violations
  `Regenerating after guard flag (<rules>) with Claude` (ids `model-2`/`guard-2`) -> `Saving the new
  version`; failure reason = `errorClass` (e.g. `cli failed`).

**Client:** `panel/job-progress.ts` `watchJobProgress` (also bundled into the content script; the
popover's shadow root already carries panel.css) renders the digest box styles with `renderStep` from
`digest-progress.ts`: title, elapsed, steps, then `Done` / `Failed: <reason>` / `Quota paused until
<time>` with Retry, or "<title>: taking longer than usual" with Cancel. One poll loop per job id
(the panel rebuilds cards every 3s; boxes share it); a box expecting a running job never reuses a
finished watch (the polish id repeats). 5 misses before any view stop the loop. Content script polls
through the worker (`job-progress` message). Idea cards `settle()` with the reply, then repaint the
server's final view. Inline Ready card: running box while polishing/regenerating, failed box (hidden
once the server forgot it) with Retry; panel Flagged shows the running box, keeping its own failure
notes.

**Rejected:** fake client timers (would lie about retries); server-side cancel (needs an abort path
through model pool, opencode and claude subprocesses): Cancel only stops waiting, the job finishes in
the background (its idea is still saved).

**Constraints it creates:** e2e observes steps with fake holds (`claude-hold.txt`, `digest-mode.txt`
hold) and scripted failures (`claude-fail.txt` = N, `digest-busy.txt` = N high-demand answers). Steps
are capped at `MAX_JOB_STEPS` (12).
