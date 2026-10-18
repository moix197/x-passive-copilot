---
id: pipeline/voice-and-digest
type: decision
summary: Own posts (author == handle) feed a voice profile and style examples injected into triage/polish prompts; a digest runs every N new non-own posts
tags: [voice, feedback, examples, digest, ideas]
paths: [apps/server/src/text/**, apps/server/src/voice/**, apps/server/src/digest/**, apps/server/src/digest/idea-tone.ts, apps/server/src/triage/prompts.ts, apps/server/src/polish/polish.ts]
related: [pipeline/triage-flow, pipeline/polish-flow, pipeline/digest-product-context, security/llm-subprocess-sandbox]
status: active
updated: 2026-10-18
---

# Voice profile, feedback examples and digest

**Decision:** `posts.is_own` is set server-side at ingest (author handle == `config.handle`,
case-insensitive); the prefilter skips own posts so they are never triaged. Voice: once
`voice.minSamples` own posts exist the triage model (opencode) writes a profile, regenerated every 10
new own samples; failures keep the old profile and back off 10 minutes. `selectExamples` (pure) picks
<= 8 positives (feedback first, then most-engaged own posts of 20-280 chars, deduped) and <= 3
negatives. Both go into the triage and polish prompts via `renderStyle` as delimited untrusted data.
Feedback (`POST /v1/drafts/:id/feedback`) upserts one `examples` row per draft (latest wins); edited
text is guard-checked first (422 on violations, shown under the editor) and an accepted edit
replaces the selected version's text (`saveEditedText`), so it is what the panel shows and copies; copy/👍 of a draft that breaks the guard stores no
example. Counts are monotonic `meta` counters (`ingest:non_own`, `ingest:own`), bumped per new insert
and seeded from live rows on first open, because the 30-day prune shrinks `posts`; own posts are
exempt from the prune (voice samples). Digest: bucket = floor(ingest:non_own / everyNPosts); the bucket is stored
in `meta` before the model runs so a bucket never fires twice; unknown statusIds are dropped; failure
keeps the previous digest and sets `digest:failed`. Rough-draft feedback uses key `rough-<statusId>` (text from `triage.rough_draft`, guard source = the post). Idea polish reuses the polish service with a
`idea-<digestId>-<n>` draft key and an empty guard source (any URL/@mention is a violation).

**Style notes:** the owner's own rules live in the singleton `style_notes` table (db, not a file:
`loadStyle(db)` already reads the db, writes are atomic, `CREATE IF NOT EXISTS` is the migration).
`GET|POST /v1/style-notes {notes<=2000}`; the Voice tab textarea sits outside the polled region so
polling never wipes edits. `renderStyleBlocks` puts them in a `<user-style-rules>` block (`<`
escaped) labelled as trusted owner rules that never override output format or hard rules, ahead of the
untrusted voice/examples. **Em dashes:** prompts forbid U+2014 and `text/dashes.ts` `replaceDashes`
is applied where model text enters (triage reason/roughDraft in `parseTriageReply`, polish reply
before `checkReply`, digest `clip`).

**Why:** the user's own posts are the best style signal and cost nothing extra to capture; reusing
triage/polish/guard keeps the sandbox and hard rules identical for new LLM calls.

**Constraints it creates:** model outputs for voice/digest are wrapped as a one-element JSON array so
`extractJson` is reused. `is_own` is not backfilled when `handle` changes. Digest product context is gathered per run (see
pipeline/digest-product-context); `finalize-system.md` still says "reply" for idea polish.
