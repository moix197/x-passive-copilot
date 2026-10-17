---
id: pipeline/voice-and-digest
type: decision
summary: Own posts (author == handle) feed a voice profile and style examples injected into triage/polish prompts; a digest runs every N new non-own posts
tags: [voice, feedback, examples, digest, ideas]
paths: [apps/server/src/voice/**, apps/server/src/digest/**, apps/server/assets/spacehood-features.md, apps/server/src/triage/prompts.ts, apps/server/src/polish/polish.ts]
related: [pipeline/triage-flow, pipeline/polish-flow, security/llm-subprocess-sandbox]
status: active
updated: 2026-10-17
---

# Voice profile, feedback examples and digest

**Decision:** `posts.is_own` is set server-side at ingest (author handle == `config.handle`,
case-insensitive); the prefilter skips own posts so they are never triaged. Voice: once
`voice.minSamples` own posts exist the triage model (opencode) writes a profile, regenerated every 10
new own samples; failures keep the old profile and back off 10 minutes. `selectExamples` (pure) picks
<= 8 positives (feedback first, then most-engaged own posts of 20-280 chars, deduped) and <= 3
negatives. Both go into the triage and polish prompts via `renderStyle` as delimited untrusted data.
Feedback (`POST /v1/drafts/:id/feedback`) upserts one `examples` row per draft (latest wins); edited
text is guard-checked first. Digest: bucket = floor(nonOwnCount / everyNPosts); the bucket is stored
in `meta` before the model runs so a bucket never fires twice; unknown statusIds are dropped; failure
keeps the previous digest and sets `digest:failed`. Idea polish reuses the polish service with a
`idea-<digestId>-<n>` draft key and an empty guard source (any URL/@mention is a violation).

**Why:** the user's own posts are the best style signal and cost nothing extra to capture; reusing
triage/polish/guard keeps the sandbox and hard rules identical for new LLM calls.

**Constraints it creates:** model outputs for voice/digest are wrapped as a one-element JSON array so
`extractJson` is reused. `is_own` is not backfilled when `handle` changes. `spacehood-features.md` is a
placeholder the user must fill; `finalize-system.md` still says "reply" for idea polish.
