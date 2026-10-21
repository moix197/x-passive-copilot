---
id: capture/inline-drafts
type: decision
summary: x.com action-bar shadow-DOM pills: Ready (To reply) opens a fixed popover card, else Drafting…/Replied/+ Flag; own nodes ignored; events never leak
tags: [content-script, inline, shadow-dom, mutation-observer, ban-risk, drafts, service-worker]
paths: [apps/extension/src/content/**, apps/extension/src/background/inline-relay.ts, apps/extension/src/background/sw.ts, apps/extension/src/drafts/**, apps/extension/src/server-api.ts, apps/extension/src/panel/draft-actions.ts, apps/extension/src/panel/panel.css, apps/extension/src/css.d.ts, apps/server/src/posts.ts, apps/server/src/router.ts, shared/src/types.ts, scripts/build.mjs, e2e/inline-drafts.spec.ts, e2e/manual-flag.spec.ts, e2e/x-timeline.ts]
related: [capture/passive-capture-invariants, pipeline/copy-keeps-to-reply, pipeline/polish-flow, pipeline/manual-flag]
status: active
updated: 2026-10-20
---

# Inline drafts on x.com

**Decision:** for each visible article whose post is in To reply (same rules as the Flagged list,
`listToReplyByIds`) and has a current draft (`drafts/current-draft.ts`: selected Claude version,
else the First draft, shared with the panel), the content script appends one `<xc-draft>` host (open shadow root) holding a compact violet
"Ready" pill (sparkle icon; "Drafting…" while polishing/regenerating) at the end of the article's
action bar (last `SEL.actionBar` `[role="group"]`; falls back to the article's end), so it reads as
part of the post. Clicking it opens the card in a separate body-level `<xc-draft-pop>` host
(`inline-popover.ts`): `position: fixed` (X's overflow:hidden / transformed virtualized rows cannot
clip or offset it), 360px, max-height 420 with scroll, below the pill or flipped above, clamped to the
viewport, so the tweet layout never shifts. One popover at a time; it closes on outside mousedown,
Escape, a second pill click, and **any page scroll** (chosen over following the anchor: X virtualizes
the timeline so the anchor can unmount mid-scroll); resize repositions. The card has the draft text,
Copy, Polish (First draft) or Regenerate (Claude version, under the version cap) and thumbs. It reuses
the panel's `renderDraftActions`, `polishButton`, `copiedBadge` and all of `panel.css`
(`:root, :host` tokens), bundled as text (esbuild `.css` text loader) into a `<style>` in each shadow
root. There is no Edit inline (`onEdit` is optional and omitted): typing on X's page is avoided.

**Other pill states** (`inline-pills.ts`, same host slot, a host of another kind is replaced):
a To-reply post still waiting for triage -> "Drafting…" (or "Paused · resumes <time>" while the
quota pause holds, from the lookup's `triagePausedUntil`); a replied post -> muted "Replied" (chosen
over nothing, so a handled post is not offered + Flag); any other captured, non-own post ->
"+ Flag" in the Ready violet (pipeline/manual-flag). Own and not-yet-captured posts get no pill. Only posts in the
Flagged set ever get Ready: the server filters with `listToReplyByIds`, the Flagged feed's own rules.

**Server path:** content -> `chrome.runtime.sendMessage` -> service worker (`inline-relay.ts`, zod
`InlineDraftsMessage` / `InlineActionMessage`) -> shared `server-api.ts` (also used by the panel).
`GET /v1/posts/to-reply?ids=a,b` (<= `MAX_INLINE_IDS` 100 unique digit ids, else 400) returns
unreplied, eligible flagged posts plus `replied` / `flaggable` ids and `triagePausedUntil`. Offline (no token) the worker answers `posts: []` without a request.
Copy = clipboard write in the page + `copy` feedback + `POST /v1/posts/:id/copied`; no tab opens.

**Batching:** `draft-cache.ts` (pure, unit-tested) keeps one answer per id; a sync asks, in one
request, only for visible ids never asked or older than 15s (2s while polishing, immediately after
an action). One timer, "earliest request wins" (a burst of mutations syncs at most every 400ms;
never below 250ms apart), no lookups while the tab is hidden; failed lookups keep the shown cards.

**Re-renders:** the capture `MutationObserver` on the primary column also schedules the inline sync;
records that only insert our host are ignored (`isOwnInsertion`), so no loop, while a removal of our
host still wakes it. Each sync finds articles again, re-attaches a host missing from a replaced
article, drops host copies without a shadow root (a cloned article) and re-renders a card only when
its draft signature changed. If a popover is open when X re-renders its article, the new pill adopts
the open card; a popover whose pill is gone is closed at the end of the sync. A host that is not in
the current action bar is moved there (our own node only).

**Isolation:** the pill and popover hosts stop propagation of click, pointer, mouse, touch and key events, so X's
article click (open post) and keyboard shortcuts (l = like, etc.) never see our clicks or keys.
Never write into X's compose box, click X's buttons or post.

**Rejected:** a settings on/off switch (no settings mechanism exists; only the capture power toggle,
and offline already hides the cards); `web_accessible_resources` for the CSS (lets X probe for the
extension); closed shadow root (Playwright cannot reach it; draft text is not secret from X).
