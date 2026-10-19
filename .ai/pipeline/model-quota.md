---
id: pipeline/model-quota
type: decision
summary: Gemini quota errors are never retried; the model pool marks the model exhausted in meta, falls back via models.triageFallbacks, else pauses triage/digest
tags: [gemini, quota, rate-limit, fallback, retry, pause, opencode]
paths: [apps/server/src/llm/model-pool.ts, apps/server/src/llm/quota.ts, apps/server/src/triage/retry.ts, apps/server/src/triage/triage.ts, apps/server/src/digest/digest.ts, apps/server/src/meta.ts, apps/server/src/doctor.ts, apps/extension/src/panel/digest-notice.ts, apps/extension/src/panel/digest-section.ts, e2e/model-quota.spec.ts]
related: [pipeline/triage-flow, pipeline/voice-and-digest, security/llm-subprocess-sandbox]
status: active
updated: 2026-10-19
---

# Model quota: classify, fall back, pause

**Decision:** every opencode call (triage, digest, voice) goes through `createModelPool` (`llm/model-pool.ts`)
over `[models.triage, ...models.triageFallbacks]`. Failures are classified by `classifyFailure`
(`triage/retry.ts`): `quota` ("exceeded your current quota", RESOURCE_EXHAUSTED), `rate` (429 / rate limit),
`busy` ("high demand", overloaded, 503), `unavailable` ("no longer available to new users", model not found),
`timeout`, `malformed`, `cli`, plus our own `paused`. `withRetry` never retries quota/rate/paused/unavailable
(a retry spends the same quota); `busy` retries with 10s/20s backoff, the rest 2s/4s.

**Exhaustion:** on quota/rate the pool stores `quota-until:<model>` (+ `quota-daily:<model>`: 0 short, 1 daily,
2 retired) in `meta` and tries the next model in the same call. Reset (`llm/quota.ts`, pure): "per day" in
the text, a quota error with no "retry in Ns" hint, or a repeat right after a short cooldown -> next midnight
America/Los_Angeles (Gemini free quotas reset then; DST-correct via Intl); otherwise now + N s (60s for a bare
429). Retired models are skipped for 30 days. A success clears the keys. All exhausted -> `paused: ...` error
until the earliest reset.

**Pause:** triage leaves the batch untriaged (no `error` row), stops draining and re-arms its timer for the
reset (replacing a pending 30s flush timer); the backlog is re-prefiltered then, so posts past their age limit
are skipped. Automatic digest skips while paused and releases its bucket when a run hits the pause; manual run
answers 503 `{error, resumesAt}`. Doctor adds a live (uncached) `model-quota` check: "Gemini quota reached for
X until HH:MM, using Y" (ok) or "... paused until HH:MM" (problem).

**Why:** on 2026-10-19 the free tier ran out mid-day; the old 3 attempts x 60s rate-limit sleeps burned more
quota and held the manual digest request open for minutes. Each Gemini model has its own free quota, so a
fallback list keeps triage running. Persisting in `meta` stops restarts from hammering the API.

**Constraints:** opencode itself retries 429/503 up to 5 times (honouring retry-after) with no switch to turn
it off (opencode 1.19.3 binary strings), so one failing run can still cost several provider requests. The
opencode error detail is kept to 1000 chars so the "retry in Ns" hint survives; logs still cap at 200.
Fake CLI: `quota-models.txt` / `quota-message.txt` / `opencode-calls.txt` next to `e2e/fakes/opencode.mjs`.
