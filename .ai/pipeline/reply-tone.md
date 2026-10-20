---
id: pipeline/reply-tone
type: decision
summary: Replies to others are short humble peer takes, no pitch, no othering, no invented facts; shared replyToneRules, voice-only sandbox, reply guards
tags: [reply, tone, promotion, triage, polish, guard, sandbox, length, othering, facts]
paths: [apps/server/src/triage/reply-tone.ts, apps/server/src/triage/prompts.ts, apps/server/src/polish/polish.ts, apps/server/src/polish/guard.ts, apps/server/src/sandbox.ts, apps/server/assets/finalize-system.md, apps/server/src/digest/idea-tone.ts, apps/server/src/voice/feedback.ts]
related: [pipeline/voice-and-digest, pipeline/polish-flow, security/llm-subprocess-sandbox]
status: active
updated: 2026-10-20
---

# Reply tone: a knowledgeable peer, never a pitch

**Decision:** replies to other people's posts (triage `roughDraft` and Claude polish/regenerate)
answer what that post is about with an insight, take, question or experience from someone deep in
Robinhood Chain / LONG / crypto / trading / building. They never mention `config.product.name`,
"our platform/tool" or link to it, unless the post asks about the product or explicitly asks for
tools where it is directly relevant (then one low-key mention, no CTA). Rules + one good / one bad
example live once in `triage/reply-tone.ts` (`replyToneRules(product)`), injected into the triage
prompt ("Rules for roughDraft:") and the reply polish task block. Own posts keep
`digest/idea-tone.ts` (build in public, no sales/CTA).

**Why:** replies kept selling the product. Sources: `finalize-system.md` told Claude to read
`.ai/product/index.md` on every polish, Claude ran with cwd = product repo (its `CLAUDE.md` and docs
load/readable), and neither prompt forbade promotion.

**How:** `finalize-system.md` is generic (reply or standalone post) and lets Claude read only the
files the input lists after "Files you may read:". Replies list `voice.md`; ideas list
`.claude/skills/announce/voice.md` + `.ai/product/index.md`. Reply polish runs with cwd
`<home>/sandbox/claude-reply` (`ensureClaudeReplySandbox`), into which only the repo's
`.claude/skills/announce/voice.md` is copied as `voice.md` before each run (removed if gone), so
`Read(./**)` cannot reach product docs and the repo `CLAUDE.md` is not loaded. Ideas keep cwd = repo.
A missing repo still falls through to runClaude's config error.

**Guard:** `productMention` (`polish/guard.ts`) adds violation `product-mention` when a polished reply
names the product and the post does not (word-bounded, case-insensitive). It runs only for post
subjects in polish (one regenerate, then `needs_edit`), not in `checkReply`, so edits/feedback and
ideas are unaffected and triage rough-draft warnings do not carry it (posts.ts has no config).

**Short, humble, kind, on topic, no invented facts (2026-10-20):** user feedback: replies were
essays, cocky, called people "tourists", dragged in regulators and stated market data the post never
gave ("liquidity is up right now"). `replyToneRules` adds SHORT (1-2 sentences, about
`REPLY_TARGET_LENGTH` = 200 chars), HUMBLE, KIND (no labels like tourists/normies/paper hands, no
call-outs), ON TOPIC (no macro/regulatory tangents) and NO INVENTED FACTS (opinion or question
instead); its good example is a question (the old one stated volume facts). Triage `roughDraft` max
is 200 chars. `finalize-system.md` hard rules and `ideaToneRules` (KIND AND HUMBLE, NO INVENTED FACTS)
echo this. Root causes in user data: liked rough drafts saying "tourists" were fed back as positive
style examples, and style notes asked for "polarizing opinions with a touch of sarcasm".

**More guards:** `checkReply` rule `othering` (tourists, normies, paper hands, jeets, ngmi) applies
wherever checkReply does (polish, rough-draft warnings, feedback 422). `wordyReply` flags `wordy` for
post replies of 201-280 chars, polish only, like `product-mention`. `listFeedbackExamples` drops
stored positives that fail `checkReply` (text as its own source), so rows saved before a rule existed
stop teaching it.

**User facts live in user data, not code:** naming ("the LONG ecosystem" / "LONG eco", never an
exchange) and positioning (Spacehub = analytics layer of the LONG eco, tracks LONG tokens only, not
Robinhood Chain) are in `<home>/context.md` (triage only) and the style notes (triage and polish).
The learned `voice` profile is regenerated from own posts, so it is not hand-edited.
