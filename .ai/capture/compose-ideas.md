---
id: capture/compose-ideas
type: decision
summary: Violet "Ideas" pill in X's compose toolbar opens the popover with recent ideas; "Generate idea" adds one via POST /v1/ideas/generate, saved as a digest row
tags: [content-script, inline, compose, shadow-dom, ideas, digest, ban-risk, quota]
paths: [apps/extension/src/content/inline/compose-ideas.ts, apps/extension/src/content/inline/compose-card.ts, apps/extension/src/content/inline/inline-popover.ts, apps/extension/src/content/inline/own-nodes.ts, apps/extension/src/content/selectors.ts, apps/extension/src/content/inline/relay.ts, apps/extension/src/background/compose-relay.ts, apps/extension/src/drafts/idea-list.ts, apps/server/src/digest/single-idea.ts, apps/server/src/digest/digest.ts, apps/server/src/router.ts, shared/src/types.ts, e2e/compose-ideas.spec.ts, e2e/x-timeline.ts]
related: [capture/inline-drafts, capture/passive-capture-invariants, pipeline/voice-and-digest, pipeline/model-quota]
status: active
updated: 2026-10-21
---

# Post ideas in X's compose box

**Decision:** every X compose toolbar (`SEL.composerToolbar` `[data-testid="toolBar"]`, in the Post
modal and the home "What's happening?" composer) gets one `<xc-compose>` host (open shadow root,
`isolate`d, built by the shared `shadowHost`) appended to its icon list (`SEL.composerTools`
`ScrollSnap-List`, else the toolbar). It holds a pill in the Ready style (sparkle + "Ideas"). The
pill opens the existing body-level popover (`inline-popover.ts`, key `compose-ideas`) with one card
shared by all pills: "Generate idea", a status line, then the ideas newest first, each with its
feature and Copy (clipboard only). No thumbs: raw ideas have no feedback; polished ideas are rated
in the panel. We never type into the compose box, click X's buttons or post: the user pastes.

**Why a body-level observer:** the Post modal renders in X's layers, outside the primary column
the capture observer watches. `watchComposers` observes `document.body` and syncs **synchronously**
per mutation batch (cheap: one `querySelectorAll`), so a re-rendered toolbar gets its pill back
before any timer, including the inline-drafts sync that closes popovers whose anchor is gone.
Own insertions are ignored (`isOwnNode` covers `xc-compose` too). A re-attached pill takes over the
open popover only if the old pill is detached (`adoptDetachedCard`), since two pills share the key.

**Server:** `POST /v1/ideas/generate` -> `single-idea.ts`. `buildSingleIdeaPrompt` shares the
digest prompt's source rules, `<previous-ideas>` (last 15 ideas), `ideaToneRules`, em dash ban and
product context. Only the task line and output shape ("exactly 1 idea", no trends) differ.
It uses the same model pool (`models.triage` + fallbacks, quota pause) and `withRetry`. Answers:
200 `{idea}`, 409 while one runs (own flag, not the digest's), 503 no model / paused
`{resumesAt}`, 502 failed (`resumesAt` when the pool paused). It does not set `digest:failed`, so
the Digest banner only describes digests. No manual throttle: each click is one model call.

**Storage:** each idea is its own `digests` row (`trends '[]'`, one idea, unique negative bucket
below every existing one), so the panel Digest tab, idea polish (`idea-<row>-0`) and "Show earlier
ideas" work unchanged. `readDigestView` takes trends from the newest row that has any, so a
single idea never blanks the trends. Rejected: a separate ideas table (the Digest tab would need a
second source and the polish/feedback ids would not apply).

**Extension path:** content `askComposeIdeas('list' | 'generate')` -> SW `compose-relay.ts`
(`ComposeIdeasMessage` / `ComposeIdeasReply`): list = `GET /v1/digest` flattened by `viewIdeas`;
the card merges with `mergeIdeas` (by id, newest row first, max 30), so a list that lands after
a generate never drops the new idea. A paused reply shows "Paused · resumes <time>" (`draftingLabel`).

**Constraints it creates:** composer selectors are live-unverified. The fixture composer
(`openTimeline(..., { composer: true })`) counts clicks, keys and Post clicks inside the compose
box and must stay at 0.
