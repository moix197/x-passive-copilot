---
id: pipeline/polish-flow
type: decision
summary: Polish runs claude once per post, guards the reply, regenerates once; auto top picks reserve slots in a per-local-day meta counter
tags: [polish, claude, guard, daily-cap, auto-polish]
paths: [apps/server/src/polish/**, apps/server/src/llm/claude.ts, apps/server/src/posts.ts]
related: [security/llm-subprocess-sandbox, pipeline/triage-flow]
status: active
updated: 2026-10-17
---

# Polish flow

**Decision:** `POST /v1/posts/:id/polish` returns 202 and runs `createPolishService.request`: an
in-memory in-flight set keyed by statusId plus a `drafts` row (`polishing`) make double clicks one
job. generate -> `checkReply` -> on violations regenerate once with them listed -> `ready` or
`needs_edit` (rule names stored). Failures store `error` (class only) and allow a manual retry.
After each triage batch `auto-polish` takes posts with score >= `autoPolish.threshold` and no draft,
best first, reserving a slot in `meta` (key `autoPolish:<local day>`); a failed job releases its
slot and stops the loop; a candidate already in flight is skipped (slot released) instead. `dailyCap: 0` disables auto; manual Polish ignores the cap.

**Why:** Claude subscription limits are shared with interactive use, hence the cap. Rows over the
cap show a synthetic `cap_reached` status computed at list time (not stored).

**Constraints it creates:** startup deletes stale `polishing` rows (no persistent queue).
`models.final` and `spacehoodRepoPath` must be set or polish errors with a config message.
