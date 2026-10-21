---
id: pipeline/job-reattach
type: decision
summary: Idea jobs lock per target key; a repeat request gets 202 {job} to follow, popovers reattach via GET /v1/jobs; 50 jobs/24h in memory; panel Activity tab
tags: [jobs, progress, reattach, lock, single-flight, ideas, polish, digest, activity, panel, inline, restart]
paths: [apps/server/src/jobs.ts, apps/server/src/router.ts, apps/server/src/digest/single-idea.ts, apps/server/src/digest/progress.ts, apps/server/src/digest/digest.ts, apps/server/src/polish/polish.ts, apps/extension/src/panel/activity-tab.ts, apps/extension/src/panel/job-retry.ts, apps/extension/src/panel/job-progress.ts, apps/extension/src/panel/panel.ts, apps/extension/src/content/inline/idea-job.ts, apps/extension/src/content/inline/post-idea.ts, apps/extension/src/content/inline/compose-card.ts, apps/extension/src/content/inline/relay.ts, apps/extension/src/background/inline-relay.ts, apps/extension/src/background/compose-relay.ts, shared/src/types.ts, e2e/job-reattach.spec.ts]
related: [pipeline/job-progress, pipeline/model-quota, capture/compose-ideas, capture/manual-ideas, capture/inline-drafts]
status: active
updated: 2026-10-21
---

# Job reattach, per-target idea lock, Activity tab

**Problem it fixes:** reloading x.com during "Post idea" lost the popover's job, and asking again hit the
single-idea lock, which the router had already recorded as a new job failed at "Queued" ("An idea is
already being generated").

**Lock decision: per target, not global.** Key = `ideaJobKey(source, kind)` (shared): `post-idea:<statusId>`,
`quote-idea:<statusId>`, else `compose` (mixed rotation, picked kinds, a quote with no status id). Two posts'
ideas run side by side. Quota does not need a global lock: the model pool is shared, so a quota mark made by
one call is seen by the next attempt of the other (fallback switch), and a full pause still refuses up front
(`paused` + `resumesAt`). The compose box keeps one lock because Mix picks the next kind from saved kinds; two
at once would pick the same kind. Polish keeps its per-draft `inFlight`; digest keeps its own single lock.

**Reattach, never fail:** the router checks `jobs.running(key)` *before* starting a job and answers
`202 {job: JobEntry}`; `POST .../polish` answers `{state, job}` (also on `already`). A request without
`jobId` still gets a server-made `idea-<uuid>` so it is listed. Client: `content/inline/idea-job.ts`
`followIdeaJob` (own or attached job; `onFinish` shows the job's `result.idea` when polling sees the end
first) and `finishIdeaRequest` (202 -> follow that job). On open, Post idea asks `latestJobFor(key)`
(`job-list` worker message): running -> follow, finished ok -> show its idea; compose `refresh` follows a
running `compose`/quote job (finished ideas are already in its list). The Ready popover and Flagged cards
already reattach from the draft's `polishing` status.

**Retention:** `JobRegistry` in memory, newest last; finished jobs pruned after 24h (`FINISHED_KEEP_MS`) and
beyond `MAX_LISTED_JOBS` (50), oldest finished first; running jobs are never dropped. Digest runs are mirrored
as `digest-<ts>` jobs (`listedDigestProgress`). Nothing survives a restart: a watch that saw a running job
and then gets 404 (not "unreachable": the worker answers `{error}` then) paints `Failed: server restarted`;
a generate reply of `SERVER_OFFLINE` is ignored while the job is known, so that outcome wins.

**Activity tab** (`panel/activity-tab.ts`): polls `GET /v1/jobs` 1s; Running then Recent, each card = label
(`jobLabel`) + the shared step box (seeded with `initial`, no poll when finished) + result with Copy + Open
post (post targets) + Retry (`job-retry.ts` replays the request from `kind`, `ideaKind`, `target`). Badge =
running count, refreshed every 3s by `panel.ts` whatever tab is open.

**Rejected:** global lock (one slow post blocks every other); persisting jobs in SQLite (asked: memory only).
