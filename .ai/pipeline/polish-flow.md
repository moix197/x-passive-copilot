---
id: pipeline/polish-flow
type: decision
summary: Polish guards each reply (one auto-retry); Regenerate appends guarded versions with a persisted pick; auto top picks use a per-day meta counter
tags: [polish, claude, guard, daily-cap, auto-polish, versions, regenerate]
paths: [apps/server/src/polish/**, apps/server/src/llm/claude.ts, apps/server/src/posts.ts, apps/server/src/db.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/panel/version-nav.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/posts-view.ts]
related: [security/llm-subprocess-sandbox, pipeline/triage-flow, pipeline/reply-tone]
status: active
updated: 2026-10-19
---

# Polish flow

**Decision:** `POST /v1/posts/:id/polish` returns 202 and runs `createPolishService.request`: an
in-memory in-flight set keyed by statusId plus a `drafts` row (`polishing`) make double clicks one
job. generate -> `checkReply` -> on violations regenerate once with them listed -> `ready` or
`needs_edit` (rule names stored). Failures store `error` (class only) and allow a manual retry.
Auto-polish is OFF by default (`autoPolish.enabled`, default false; Claude runs only on a user click). When enabled, after each triage batch `auto-polish` takes posts with score >= `autoPolish.threshold` and no draft,
best first, reserving a slot in `meta` (key `autoPolish:<local day>`); a failed job releases its
slot and stops the loop; a candidate already in flight is skipped (slot released) instead. `dailyCap: 0` disables auto; manual Polish ignores the cap.

**Versions:** every successful job appends a row to `draft_versions` (each one guarded, with the
same regenerate-once) and points `drafts.selected_version` at it; `drafts.text/status/violations`
always mirror the selected version, so feedback, edit and examples keep reading `drafts`.
Panel Edit: a row with any open editor (first draft and Claude version are tracked separately, so
closing one keeps the row pinned for the other) is reused across the 3s poll; entries for posts that
leave the list are dropped. `posts-view` reconciles rows in
place (never detaching a reused row), so focus, caret and scroll survive refreshes; Esc cancels,
Ctrl/Cmd+Enter saves.
`POST /v1/posts/:id/polish?regenerate=1` on a ready/needs_edit draft keeps the text visible
(`polishing` + text) and passes earlier versions to the prompt as "already written"; a failure
restores the status (ready/needs_edit from violations) and sets `error` instead of losing the text.
`POST /v1/drafts/:id/select {versionId}` copies a version into `drafts` (409 while polishing). Cap
`MAX_DRAFT_VERSIONS` (10, shared) -> state `limit`/409. Startup settles stale `polishing` rows that
have text and deletes the rest; `openDb` backfills pre-versions drafts as their first version. The
list query embeds versions via a `json_group_array` subquery (`VERSIONS_SUBQUERY`). Pruning drops
versions with their post, and idea drafts/versions (`idea-<digestId>-<i>`) whose digest row is gone.

**Dashes/notes:** each generated reply passes `replaceDashes` before the guard; the prompt also carries the
owner's `<user-style-rules>` (see pipeline/voice-and-digest). Post cards show a "View on X" link.

**Thumbs:** `PolishInfo.feedback` ('up'|'down'|null) is the draft's `examples` polarity, joined at list time. The
panel renders it as `aria-pressed` on 👍/👎 plus an inline "Saved as ..." note; a session map in panel.ts keeps
the pick if a poll was fetched before the save. Latest wins; copy/edit also write a positive example. The First draft (triage rough draft) has the same actions under draft key `rough-<statusId>` (`TriageInfo.feedback`, own `examples` row); its edit overwrites `triage.rough_draft`.

**Why:** Claude subscription limits are shared with interactive use, hence the cap. Rows over the
cap show a synthetic `cap_reached` status computed at list time (not stored).

**Constraints it creates:** startup deletes stale `polishing` rows (no persistent queue).
`models.final` and `spacehoodRepoPath` must be set or polish errors with a config message. Reply guard adds `product-mention` (pipeline/reply-tone).
