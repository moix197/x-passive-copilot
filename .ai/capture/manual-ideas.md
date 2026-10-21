---
id: capture/manual-ideas
type: decision
summary: User-picked idea sources: X Quote composer -> quote idea for the embedded post (no chips); "Post idea" on a tweet -> inspired idea; stored post preferred
tags: [content-script, inline, compose, quote, inspired, ideas, selectors, untrusted-input, ban-risk]
paths: [apps/extension/src/content/idea-source.ts, apps/extension/src/content/selectors.ts, apps/extension/src/content/inline/post-idea.ts, apps/extension/src/content/inline/compose-card.ts, apps/extension/src/content/inline/compose-ideas.ts, apps/extension/src/content/inline/inline-drafts.ts, apps/extension/src/content/inline/inline-pills.ts, apps/extension/src/content/inline/inline-card.ts, apps/extension/src/background/compose-relay.ts, apps/server/src/digest/picked-source.ts, apps/server/src/digest/single-idea.ts, apps/server/src/digest/digest.ts, shared/src/types.ts, e2e/manual-ideas.spec.ts, e2e/x-timeline.ts]
related: [pipeline/idea-kinds, capture/compose-ideas, capture/inline-drafts, capture/passive-capture-invariants]
status: active
updated: 2026-10-21
---

# Ideas for a post the user picked

**Decision:** besides the automatic source ranking (pipeline/idea-kinds, unchanged), the user can pick the
exact post an idea is for. The picked post (`IdeaSourceInput` `{statusId|null, authorHandle, text<=1000}`)
goes content script -> SW (`ComposeIdeasMessage.source`) -> `POST /v1/ideas/generate {kind, source}`;
a source is only valid with kind `inspired` or `quote` (else 400). It replaces the auto-selection: the
prompt's `<source-posts>` holds only that post (still the untrusted block) and the idea's `source` is it,
whatever the model cites.

**Quote composer:** the user clicks Quote on X; X opens the Post modal with the post embedded. On pill
click, `readQuotedPost(toolbar)` reads, read-only, inside `toolbar.closest(SEL.quoteComposer)` (`[role=dialog]`)
the `SEL.quotedCard` (`div[role=link]:has(tweetText)`): handle from the `User-Name` span reading `@handle`
(not the concatenated text: name/handle/time are adjacent spans), text from `tweetText`, status id from a
status link only if the card has one (usually none). Selectors are live-unverified. Then the popover shows
`Quoting @author: excerpt` (`compose-quoting`) instead of the kind chips, and Generate always asks for
`quote` with that source. Other composers keep the chips.

**Post idea (per tweet):** inside the Ready popover card, a "Post idea" section under the draft; for
+ Flag / Drafting… / Replied pills, a small icon-only sparkle button (`inline-post-idea`, aria-label
"Post idea") beside the pill opens the same section in a popover (key `idea:<statusId>`). Chosen as least
cluttered: no new pill text, one icon. The section is cached per status id (max 50), so re-renders keep
the result. It sends kind `inspired` with the article's parsed post (`readArticleSource`) and shows the
idea with kind tag, source line, Open post and Copy. Saved as a digest row, so the Digest tab lists it.

**Server resolution (`picked-source.ts`):** the captured post by status id, else by author (NOCASE) +
exact text (the quote card has no id; capture reads the same `tweetText`), giving the stored text and
an Open post link; otherwise the DOM text with `statusId`/`url` null (`IdeaSourceSchema` allows null;
the UI hides Open post, quote dedupe skips it).

**Constraints it creates:** nothing on X is clicked or typed; the user pastes. The fixture's
`__openQuoteModal()` (option `quoted`) mimics the card; X's layers are fixed-position in the fixture so
clicking the modal pill needs no scroll (a scroll closes popovers).
