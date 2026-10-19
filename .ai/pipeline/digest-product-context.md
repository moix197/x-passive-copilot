---
id: pipeline/digest-product-context
type: decision
summary: Digest product context is gathered fresh each run, read-only, from the announcements folder and product repo, as untrusted data in an 8 KB budget
tags: [digest, product-context, announcements, tracker, git-log, untrusted-input, tone]
paths: [apps/server/src/digest/product-context.ts, apps/server/src/digest/idea-tone.ts, apps/server/src/digest/digest.ts, shared/src/config.ts, e2e/digest-context.spec.ts]
related: [pipeline/voice-and-digest, security/llm-subprocess-sandbox]
status: active
updated: 2026-10-19
---

# Digest product context

**Decision:** no committed feature list (the old `assets/spacehood-features.md` is gone). Each
digest run calls `gatherProductContext(config)` once (before `withRetry`) and puts the result in a
`<product-context>` block; the product name comes from `product.name` (default `Spacehub`), never
hard-coded in prompts. Sources, in budget priority order (total `MAX_CONTEXT_BYTES` = 8 KB, the
last section that overflows is clipped, the rest dropped):

1. `README.md` of `spacehoodRepoPath`, 1 KB.
2. `announcementsPath`: `brief.md` of the 5 newest `YYYY-MM-DD_<slug>` folders (sorted by the
   folder-name date, newest first), 1.2 KB each, tagged with the `tracker.csv` row matched by its
   `folder` column (`discord=..., x=..., video=...; notes: ...`, notes 160 chars). Only `brief.md`
   and `tracker.csv` are read: no drafts, no media.
3. `git log -n15 --no-merges --format=%cs %s` in the repo via `resolveCli('git')` + `runCli`
   (argv, `shell:false`, 5s timeout, `GIT_CEILING_DIRECTORIES` = repo parent so it never reads a
   parent repo, `GIT_OPTIONAL_LOCKS=0`). Missing git / not a repo -> no commits, no error.

**Safety:** `readContainedFile` realpaths root and file and refuses anything outside the root
(symlink or `..`), non-files and files > 256 KB; any error -> ''. Gathered text has `<` and `"`
escaped so it cannot close the delimiters; the prompt labels it untrusted, facts-only.

**Tone:** `ideaToneRules(product)` (build-in-public/educational, no CTA/pitch/hype) is shared by the
digest prompt and the idea polish task block (`polish.ts`), so both stay in sync. Audience is
crypto traders and the LONG / Robinhood Chain community on X, not developers: ideas are framed as what
users can now see/do/learn, ecosystem insight, or building-in-public stories; engineering jargon
(timeouts, sync, telemetry, APIs, DB, caching, infra) is banned unless translated into a visible
effect, and purely internal changes are skipped. The digest prompt tells the model announcements are
user-facing (preferred source) and commit subjects are "INTERNAL SIGNALS": translate to user impact
or ignore.

**Constraints it creates:** `tracker.csv` parsing is a minimal CSV (quoted commas and `""`, no
quoted newlines). Doctor reports `announcementsPath` as `missing` (red dot, "Optional:" fix) when
unset; the panel has no softer status for optional paths.
