---
id: capture/passive-capture-invariants
type: constraint
summary: Content script only reads the DOM and calls sendMessage (no fetch, click, scroll, events, DOM writes, localhost); all X selectors live in selectors.ts
tags: [ban-risk, content-script, passivity, selectors, untrusted-input]
paths: [apps/extension/src/content/**, apps/extension/src/background/sw.ts, apps/extension/src/panel/posts-view.ts]
related: [tooling/lean-v1-scaffold]
status: active
updated: 2026-10-17
---

# Passive capture invariants

**Constraint:** Ban-risk minimization is the hard requirement. The content script
(`apps/extension/src/content/`) may only read the DOM the user already loaded and hand posts to the
service worker via `chrome.runtime.sendMessage`. It must never call `fetch`/XHR, click, scroll,
dispatch events, create/append/modify nodes or attributes, or talk to localhost. Only the service
worker (host permission `http://127.0.0.1/*`) POSTs to the server.

**Check:** grep `apps/extension/src/content/` (excluding tests) for `fetch(`, `XMLHttpRequest`,
`.click(`, `scroll`, `dispatchEvent`, `appendChild`, `setAttribute`, `innerHTML`: must be empty.
Run it every phase that touches the extension.

**One selector module:** every X selector lives in `content/selectors.ts`. X's DOM is volatile;
parsers (`parse-article`, `parse-metrics`) are pure over an `Element` and unit-tested on fixture
HTML, so a DOM change means editing `selectors.ts` plus the fixture only. Outer-article fields are
read via `ownMatch` so quoted posts never leak their author/text into the outer post.

**Untrusted input:** captured text is hostile. The SW re-validates each post with the shared zod
schema (statusId digits, handle `[A-Za-z0-9_]{1,15}`, text <= 4000) before sending; the server
validates again (1 MB cap, batch <= 100) and logs statusIds only; the panel renders with
`textContent` only and rebuilds "Open on X" links from validated handle + statusId.

**Extension imports `@xc/shared/types`, never `@xc/shared`:** the index re-exports `config.ts`,
which uses Node APIs and would break extension typecheck and bundling.

**Live-verified (Spanish UI, `lang="es"`):** promoted = outer article has no `time` element (shows an
"Ad"/"Anuncio" label); `placementTracking` also wraps normal video players, never use it. Metrics
come from the localized `[role="group"][aria-label]`, parsed by keyword (EN + ES), order-independent,
omitted parts = 0.

**Unverified selectors:** no quote or reply samples were seen live. Quote = nested `div[role="link"]`
containing both `User-Name` and `time` (link cards lack them). Reply = header text (<= 300 chars,
outside and not containing `tweetText`) starting with "Replying to" / "En respuesta a" (UI may be
localized further); its `@handles` (read via `textContent`, deduped, max 10) become `replyTo`, because
X strips the leading `@target` from reply text. Re-check when samples appear.

**The user's handle never reaches the page:** the content script captures every reply target; matching
against `config.handle` happens server-side (prefilter).
