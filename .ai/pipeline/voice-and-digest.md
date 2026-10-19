---
id: pipeline/voice-and-digest
type: decision
summary: Own posts (author == handle) feed a voice profile and style examples injected into triage/polish prompts; a digest runs every N new non-own posts
tags: [voice, feedback, examples, digest, ideas]
paths: [apps/extension/src/panel/digest-section.ts, apps/server/src/text/**, apps/server/src/voice/**, apps/server/src/digest/**, apps/server/src/digest/idea-tone.ts, apps/server/src/triage/prompts.ts, apps/server/src/polish/polish.ts]
related: [pipeline/triage-flow, pipeline/polish-flow, pipeline/digest-product-context, pipeline/reply-tone, security/llm-subprocess-sandbox, pipeline/model-quota]
status: active
updated: 2026-10-19
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
keeps the previous digest and sets `digest:failed`. Manual run: `POST /v1/digest/run` (`runNow`) shares the `running` flag with the automatic run (busy -> 409), saves with a unique negative bucket (never touches `digest:bucket`), needs >= 3 recent non-own posts (422), is throttled by `digest.manualMinIntervalSec` (429 + Retry-After, in-memory), answers 503 `{resumesAt}` while the model pool is paused, and on failure returns 502 (plain-words cause) keeping the previous digest. Every failure (automatic or manual) sets `digest:failed` plus `digest:failed-kind` (index into `MODEL_FAILURE_KINDS`), `-at`, `-resumes-at`; `GET /v1/digest` returns them as `failure` with `running` (the shared flag). The panel banner says why (`describeModelFailure`) and when the shown digest succeeded; the Generate button is disabled while `running` is true on any poll, so a tab switch or a lost request never leaves it idle mid-run; its fetch aborts after 8 min (server worst case ~6 min). Rough-draft feedback uses key `rough-<statusId>` (text from `triage.rough_draft`, guard source = the post). Idea polish reuses the polish service with a
`idea-<digestId>-<n>` draft key and an empty guard source (any URL/@mention is a violation).

**Style notes:** the owner's own rules live in the singleton `style_notes` table (db, not a file:
`loadStyle(db)` already reads the db, writes are atomic, `CREATE IF NOT EXISTS` is the migration).
`GET|POST /v1/style-notes {notes<=2000}`; the Voice tab textarea sits outside the polled region so
polling never wipes edits. `renderStyleBlocks` puts them in a `<user-style-rules>` block (`<`
escaped) labelled as trusted owner rules that never override output format or hard rules, ahead of the
untrusted voice/examples. **Em dashes:** prompts forbid U+2014 and `text/dashes.ts` `replaceDashes`
is applied where model text enters (triage reason/roughDraft in `parseTriageReply`, polish reply
before `checkReply`, digest `clip`). Only horizontal spaces around a dash are consumed (a dash at a line
edge is dropped, the line break kept); a dash between digits becomes `-`.

**Why:** the user's own posts are the best style signal and cost nothing extra to capture; reusing
triage/polish/guard keeps the sandbox and hard rules identical for new LLM calls.

**Constraints it creates:** model outputs for voice/digest are wrapped as a one-element JSON array so
`extractJson` is reused. `is_own` is not backfilled when `handle` changes. Digest product context is gathered per run (see
pipeline/digest-product-context). Reply tone (no product pitch) is pipeline/reply-tone.

**Fresh ideas, not repeats:** the digest prompt carries the idea texts of the last 5 digests in a
`<previous-ideas>` untrusted block with an instruction to cover clearly different topics (without it the
model re-suggested the same 3 themes every run, which looked like the panel not updating; the panel and
`GET /v1/digest` were correct: latest row by `id`). The Digest view shows "Generated <time>" so staleness is visible.
