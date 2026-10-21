---
id: pipeline/manual-flag
type: decision
summary: "+ Flag" on x.com sets posts.manual_flag_at; reads as mustFlag manual, skips prefilter and age limits, re-triaged for a draft only if it has none
tags: [flagged, manual, triage, prefilter, quota, inline, drafts]
paths: [apps/server/src/posts.ts, apps/server/src/db.ts, apps/server/src/router.ts, apps/server/src/app.ts, apps/server/src/triage/triage.ts, apps/server/src/triage/triage-store.ts, apps/server/src/triage/prefilter.ts, apps/server/src/triage/prompts.ts, shared/src/types.ts, apps/extension/src/content/inline/inline-pills.ts, apps/extension/src/content/inline/inline-drafts.ts, apps/extension/src/background/inline-relay.ts, apps/extension/src/server-api.ts, e2e/fakes/opencode.mjs, e2e/manual-flag.spec.ts]
related: [capture/inline-drafts, pipeline/triage-flow, pipeline/model-quota, pipeline/copy-keeps-to-reply]
status: active
updated: 2026-10-20
---

# Manual flag

**Decision:** `POST /v1/posts/:id/flag` (triage service `flag`) sets `posts.manual_flag_at`
(`COALESCE`, so repeats change nothing). The mark lives on the post, not the triage row, so no later
verdict can unflag it: `rowMustFlag` reads it as `mustFlag: 'manual'`, `FLAGGED_WHERE` includes it, and
`isWithinAgeLimit` is always true for `manual`. Triage skips the prefilter for it (`verdictFor`:
no age or engagement rule) and sends it with note `"manual"`; the prompt says such posts are
reply-worthy and always get a `roughDraft`. Panel tag: `manual`; same Copy / Mark replied flow.

**Draft generation:** reuses the triage path, so model fallbacks and the quota pause apply. A post
that already has a draft (rough or Claude) is only marked (`200 {state: 'drafted'}`, no model call).
Otherwise any draftless verdict (skipped, unworthy, error) is deleted (`clearTriage`) and triage is
drained at once (`202 {state: 'queued', resumesAt?}`). 404 unknown id, 409 own post, 503 no triage model.

**Inline:** `GET /v1/posts/to-reply` also returns `replied` and `flaggable` ids (captured, not own,
not replied, not in To reply) and `triagePausedUntil`, from `lookupInlineStates`, which reuses
`listToReplyByIds` (the Flagged feed's rules) so the pill and the panel never disagree. The x.com
pill shows "+ Flag" (dashed, low contrast) on flaggable posts; clicking shows "Drafting…" until the
post is triaged, or "Paused · resumes <time>" during a quota pause; then Ready. A post not captured
yet gets no pill until a later lookup finds it.

**Rejected:** a separate `manual` triage row source (a re-triage would overwrite it); generating the
draft with Claude polish (bypasses the triage quota and fallbacks the user asked for); an Unflag
action (not needed yet; Mark replied removes it from To reply).
