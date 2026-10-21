---
id: pipeline/idea-kinds
type: decision
summary: Ideas have a kind (spacehub, eco, inspired, quote); Mix never repeats a kind, spacehub <=1 in 3; inspired/quote cite fresh captured posts, quoted once
tags: [digest, ideas, kinds, rotation, quote, inspired, source-posts, untrusted-input, tone]
paths: [apps/server/src/digest/idea-kind.ts, apps/server/src/digest/source-posts.ts, apps/server/src/digest/digest.ts, apps/server/src/digest/single-idea.ts, apps/server/src/polish/polish.ts, apps/server/src/db.ts, apps/server/src/router.ts, shared/src/types.ts, apps/extension/src/panel/idea-meta.ts, apps/extension/src/panel/digest-section.ts, apps/extension/src/content/inline/compose-card.ts, e2e/idea-kinds.spec.ts, e2e/fakes/opencode.mjs]
related: [pipeline/voice-and-digest, capture/compose-ideas, pipeline/digest-product-context, pipeline/reply-tone]
status: active
updated: 2026-10-21
---

# Idea kinds

**Decision:** every idea has `kind` (`IDEA_KINDS`): `spacehub` (build in public, the old behavior),
`eco` (LONG ecosystem / Robinhood Chain / crypto / trading take, never about the product), `inspired`
(an original post on a theme from captured posts; `sourceIds` + primary `source`), `quote` (a
quote-post comment for one captured post; `source` = `{statusId, url, authorHandle, excerpt}`,
`url` only `https://x.com/<handle>/status/<id>`, `IDEA_SOURCE_URL`). Users wanted most ideas not
tied to Spacehub, and ideas built from posts they saw.

**Kinds are planned by the server, not left to the model.** `pickNextKind(newestFirst, hasSources)`
(pure): never the last kind; spacehub only if absent from the last 2; inspired/quote only with
source posts; least recently used wins, ties in order spacehub, eco, inspired, quote; nothing left ->
eco (never a second spacehub). History = `recentIdeaKinds` (last 15 digest rows, newest first, the
last idea of a row counts as its newest). A full digest uses `planDigestKinds` (the rotation 3x)
and the prompt says `Write the ideas with exactly these kinds, in this order: [...]`. The model's
own `kind` label wins in a digest (planned kind fills a missing one), then `capIdeaKinds` drops
every spacehub after the first and repeat quotes of one post. A single idea always takes the asked
or rotated kind (the model's label is ignored). Explicit `kind` bypasses the rotation but still
counts in its history.

**Source posts** (`source-posts.ts`): non-own, non-reply posts (last 200 by seq) within
`triage.maxAgeHours` (captured time when posted time is unknown), never a post a saved quote idea
already cites (`quotedStatusIds`, JSON1 over `digests.ideas`), non-empty text. Ranked by triage
score (untriaged = 50) + engagement bonus (log, max 20) + 15 for crypto/LONG/eco/Robinhood/trading
words; top `MAX_SOURCE_POSTS` = 6 as `{statusId, author, excerpt}` (200 chars, one line, no em
dash) in an untrusted `<source-posts>` block with an ignore-instructions rule. An inspired/quote
idea citing no offered id is dropped (digest) or malformed (single, retried). Asking for
inspired/quote with no source -> `no_source` -> 422.

**Tone:** `ideaToneRules` unchanged plus `kindRules` (never copy source wording, eco never names the
product, "the LONG ecosystem"/"LONG eco"). Polish adds `polishKindNote`, marks the idea's source as
untrusted, uses the source (excerpt + @author) as guard source, and flags `product-mention` for every
kind but spacehub.

**Storage / migration:** ideas stay JSON in `digests.ideas` (`StoredIdeaSchema`, defaults kind
spacehub). `openDb` -> `backfillIdeaKinds` writes `kind: 'spacehub'` into rows saved before kinds.

**UI:** `ideaMeta` (panel `idea-meta.ts`, shared by the Digest tab and the compose popover): kind tag
(`idea-kind`), then for sourced ideas `@author: excerpt` + "Open post" (`target=_blank`, the user
clicks Quote on X themselves; nothing is automated on X).

**Rejected:** letting the model pick kinds freely (it drifts back to the product); a separate ideas
table (see capture/compose-ideas).

**Constraints it creates:** the fake opencode answers with the first planned kind citing the first
source id; `digest-ideas.json` next to it overrides the ideas array.
