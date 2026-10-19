---
id: pipeline/digest-progress
type: decision
summary: Digest runs record steps in server memory; GET /v1/digest returns them as `progress`; the panel shows a step list, polling 1s while active
tags: [digest, progress, polling, panel, model-pool, retry]
paths: [apps/server/src/digest/progress.ts, apps/server/src/digest/digest.ts, apps/server/src/llm/model-pool.ts, apps/server/src/voice/voice.ts, apps/extension/src/panel/digest-progress.ts, apps/extension/src/panel/digest-section.ts, apps/extension/src/panel/posts-view.ts, apps/extension/src/panel/voice-tab.ts, shared/src/types.ts, e2e/digest-generate.spec.ts]
related: [pipeline/voice-and-digest, pipeline/model-quota, pipeline/digest-product-context]
status: active
updated: 2026-10-19
---

# Digest run progress

**Decision:** `createDigestService` owns one in-memory `createDigestProgress` tracker (not persisted).
`runBucket` / `runNow` call `start()`; `generate` advances fixed steps `collect` ("Collecting recent
posts (N)") -> `context` ("Reading <product> context (announcements, README, commits)") -> `model`
-> `save`, and `finish` records `{ok, ideas}` or `{ok:false, reason: describeModelFailure(kind)}`.
`close()` in the `finally` fails a run that threw, so it never looks stuck. `view()` adds
`elapsedMs` and returns null once a finished run is older than `FINISHED_VISIBLE_MS` (6s), so the
panel needs no timer to hide it. `DigestView.progress` carries it (nullable).

**Model step:** `RunModel`/`ModelPool.run` take an optional `ModelObserver` (`onModel`, `onSwitch`).
`createModelReporter` turns these into the label "Asking <model> (attempt k)" (provider prefix
stripped; k = `withRetry` attempt) and a detail line "Quota reached on A, switching to B" / "no model
left"; the digest wraps `withRetry`'s `wait` so a retry shows "<model> busy|timed out|..., retrying
in Ns". Triage and voice ignore the observer.

**Panel:** `digest-progress.ts` renders a compact box under Generate (done ✓, current spinner,
pending •, failed ✕, elapsed seconds; title "Generating ideas", then "Done — N ideas" or
"Failed: <reason>"). `pollWhileVisible` now chains `setTimeout` with an `intervalMs()` callback;
the digest tab polls every 1s while a run is requested, running, or its outcome is on screen, else 3s.

**Why:** a run can take minutes (context gathering, retries, model fallback); a bare
"Generating..." gave no clue what it waited on. In-memory state is enough: progress is only
meaningful while the server process that runs the digest is alive.

**Constraints it creates:** e2e observes steps via the fake opencode `digest-mode.txt = hold`;
tests that write `quota-models.txt` first wait for triage to finish (batch of 1), or a triage call
would mark the model exhausted before the digest sees the switch.
