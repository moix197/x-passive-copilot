---
id: pipeline/copy-keeps-to-reply
type: decision
summary: Copy records posts.copied_at and opens or focuses the post's x.com tab but never marks replied; only Mark replied moves a card; no reply auto-detect
tags: [copy, replied, flagged, tabs, permissions, panel]
paths: [apps/server/src/posts.ts, apps/server/src/router.ts, apps/server/src/db.ts, apps/extension/src/panel/flagged-view.ts, apps/extension/src/panel/x-tab.ts, apps/extension/src/panel/panel.ts, apps/extension/src/server-api.ts, apps/extension/manifest.json, e2e/flagged-feeds.spec.ts]
related: [pipeline/triage-flow, pipeline/polish-flow]
status: active
updated: 2026-10-20
---

# Copy keeps the post in To reply

**Decision:** Copy on any flagged draft (First draft or Claude version) does three things: copies
the text (plus the existing `copy` feedback), `POST /v1/posts/:id/copied` (sets nullable
`posts.copied_at`, latest copy wins, 404 unknown id; exposed as `StoredPost.copiedAt`), and
`focusOrOpenPostTab` (`panel/x-tab.ts`): `chrome.tabs.query` for `https://x.com/*/status/<id>*`,
filtered by the pure `isPostTabUrl`, then `tabs.update(active)` + `windows.update(focused)`, else
`tabs.create`. The card stays in To reply with a "Copied ✓" badge (`copiedBadge`, shown from
`copiedAt` or a session set so a stale poll cannot hide it). Only Mark replied / Move back change
`replied_at`, so replied posts keep their prune and age-limit exemption unchanged.

**Why:** moving the card on Copy made the tweet hard to find again before the reply was posted.

**Permissions:** `host_permissions` gained `https://x.com/*` (needed to query tabs by URL and read
`tab.url`). Chosen over `tabs` because the content script already covers x.com, so no new install
warning; it is never used to fetch x.com.

**Rejected:** auto-marking replied when capture sees the user's own reply. `parse-article` only
knows a reply's `replyTo` handles ("Replying to @a"), not the parent status id, and X's article DOM
has no reliable in-reply-to id; matching by author alone would mark the wrong post.

**Constraints it creates:** e2e runs with `--host-resolver-rules=MAP x.com ~NOTFOUND` (harness):
tabs the extension opens are not routed by Playwright, so they must fail offline; specs read tab
URLs via `chrome.tabs` in the service worker and `bringToFront` the panel tab afterwards (hidden
tabs pause polling and Playwright's stability checks).
