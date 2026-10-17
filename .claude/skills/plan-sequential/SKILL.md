---
name: plan-sequential
description: Internal format spec for sequential phased plans. Loaded on demand by `write-prd` and `execute-prd`; not user-invoked.
---

# plan-sequential — Output format spec

This skill is a **format library**, not an entry point. The `write-prd` skill
reads this file when the user (and Claude) chose `shape: sequential` in Phase
1.7. The specialist agent in Phase 2 follows this spec to produce the draft.

---

## File location

Single file at `plans/<state>/<plan-slug>.md` (final), where `<state>` is
`pending`, `in-progress` or `completed`. During Phase 2/3 it's at
`plans/pending/<plan-slug>.draft.md`; Phase 4 of `write-prd` renames it to
`plans/pending/<plan-slug>.md`, and `/execute-prd` moves it between state
folders (the `**Status:**` line and the folder always match).

Slug is kebab-case, descriptive: `add-search-feature`,
`migrate-storage-layer`, `refactor-payment-flow`.

---

## Plan document structure

Every sequential plan file must follow this structure:

```markdown
# Plan: [Title]

**Created:** [date]
**Branch:** [suggested branch name]
**Status:** pending | in-progress (started YYYY-MM-DD) | completed (YYYY-MM-DD)

## Context

Why this change is being made — the problem, what prompted it, intended outcome.

## Risk: [low | medium | high | ultra-high]

Overall risk assessment for the entire plan.

## Dependencies & Risks

- Known risks or things that could go wrong
- External dependencies
- Order-sensitive operations

## Phases

### Phase 0: Create worktree

**This phase is always first. No exceptions.**

Create a git worktree for this plan's branch. `/execute-prd` does this
automatically, without confirmation.

**Steps:**

- [ ] Run `git worktree add ../<branch-folder> -b <branch> <base-ref>`
- [ ] Verify worktree is active and on the correct branch (`git worktree list`)

---

### Phase 1: [Short description]

**Risk:** [low | medium | high | ultra-high]
**Mode:** afk | hil  <!-- afk = subagent executes autonomously (default). hil ONLY when an agent truly cannot do it: a design decision the plan leaves open, a deploy or external system Claude can't reach, a manual check nothing automated can cover. Consumed by /execute-prd. -->
**Type:** backend | frontend | typescript | security | docs | ux | config | test | mixed  <!-- routes execution to a specialist subagent via /execute-prd. Default: mixed (general-purpose) when no specialist clearly fits. -->
**Model:** haiku | sonnet | opus  <!-- cost-aware model routing for /execute-prd's Agent-tool calls. Default: sonnet. See write-prd SKILL.md Phase 2 "Mode + Type + Model tagging" for the rubric. -->
**Success criteria:** [What "done" looks like for this phase — must be a user-visible / QA-exercisable outcome (e.g., "user can submit form X and see result Y"), not a layer-built statement (e.g., "schema fields added", "API route exists"). See "Phase shape" rule.]
**Commit message:** `[conventional commit message]`

**File changes:**
| Action | File | What changes |
|---|---|---|
| modify | `path/to/file.ts` | description of changes |
| create | `path/to/new-file.ts` | description of contents |
| delete | `path/to/old-file.ts` | why it's removed |

**Steps:**

- [ ] Step 1
- [ ] Step 2
- [ ] ...

**Tests:**

| Action | Kind | File | What it covers |
|---|---|---|---|
| create | e2e | `e2e/<feature>.spec.ts` | scenario: [user steps] → [expected result]; `@covers` [globs] |
| create | unit | `src/<module>.test.ts` | [small pure function]: input cases |
| run | e2e-regression | `e2e/<other-feature>.spec.ts` | already exists; its `@covers` matches files this phase changes |

Testing follows CLAUDE.md `## Testing`: **end-to-end first**. Every success criterion maps to at least one `e2e` scenario (steps + expected result). `unit` only for small pure functions. List every existing spec whose `@covers` matches a file this phase changes as `e2e-regression`; if a changed file is cross-cutting or covered by no spec, write `run | e2e-regression | full suite`.

If this phase has no testable behavior, replace the table with: `No automated tests — justified because: [reason]`. Acceptable reasons: pure config registration with explicit validation coverage, pure README/docs change, pure scaffolding with no behavior. "It's hard to test" is **not** an acceptable reason. Affected `e2e-regression` specs still run.

**Verification:**

- [ ] This phase's e2e + unit tests pass, and every affected e2e spec passes: `pnpm test:e2e <specs>`, `pnpm test:unit`
- [ ] `pnpm check` passes
- [ ] [Any additional verification — expected output, manual check that supplements tests]

**Phase review:**

- [ ] All Steps and Verification checkboxes above ticked in the plan file (mark implementation-done _before_ review — reviewer should see an up-to-date plan)
- [ ] Changes committed: `[commit message]`
- [ ] Code review **green with zero blocking findings and zero nits** — every finding fixed and re-reviewed (fix rounds: <n>)
- [ ] Any changes made in response to the review reflected back into this plan file (steps, file table, success criteria, tests table, or assumptions)
- [ ] Tests for this phase written and passing (see Tests subsection above) — or no-tests justification accepted
- [ ] Documentation updated (see Documentation section)
- [ ] Phase marked complete

---

### Phase 2: [Short description]

[same structure as above]

---

### Phase N: Final Verification

**This phase runs after all other phases are complete.**
**Mode:** afk  <!-- agent-run by /execute-prd closeout: full test suite + end-to-end opus review, then it stops for merge approval. -->
**Model:** opus  <!-- Final-Verification units are always opus (per the rubric). -->

**Overall success criteria:**

- [What "done" looks like for the entire plan — the end-state the user should be able to see, test, and confirm]

**Steps:**

- [ ] Every preceding phase's Steps/Verification/Phase review checkboxes are ticked in the plan file
- [ ] `pnpm check` and the **full** e2e suite (`pnpm test:e2e`) pass
- [ ] End-to-end code review (opus) **green with zero blocking findings and zero nits** — cross-unit regressions and CLAUDE.md invariants checked
- [ ] Any changes made in response to the final review reflected back into this plan file
- [ ] Overall success criteria met
- [ ] `.ai/` knowledge base synced in the worktree; `node .ai/_tools/build-index.mjs --check` passes (or no KB impact)
- [ ] Orchestrator (user) explicitly approved the merge

## Documentation

Map each change to where its documentation belongs:

| Change        | Documentation location                         |
| ------------- | ---------------------------------------------- |
| [description] | `<path/to/README.md>` |

Documentation is added as a step within each relevant phase, not as a separate phase.

## Knowledge Base Impact

Identify the `.ai/` knowledge-base changes this plan requires. Decision-oriented only — capture *why*, constraints, and the map; never restate code.

| Entry id (`<domain>/<slug>`) | Action    | Type     | What it captures                |
| ---------------------------- | --------- | -------- | ------------------------------- |
| `<domain>/<new-slug>`        | add       | decision | the why + rejected alternatives |
| `<domain>/<existing-slug>`   | edit      | map      | new module → path               |
| `<domain>/<existing-slug>`   | supersede | decision | replaced by `<domain>/<new-slug>` |
| `<domain>/<existing-slug>`   | retire    | gotcha   | subject removed by this change  |

Action is `add | edit | supersede | retire`; Type is the entry's frontmatter `type`. Indexes are generated — never list them. If this plan introduces no new concept, module, flow, or decision, write `_None — no knowledge-base impact._`. Keeping `.ai/` current is part of "done" — `execute-prd` syncs it at closeout via the `sync-knowledge` skill, which owns the rules.

## Tests

Map each behavior introduced by this plan to the test that proves it (CLAUDE.md `## Testing`: end-to-end first).

| Phase   | Kind           | Behavior / scenario                  | Test file                     |
| ------- | -------------- | ------------------------------------ | ----------------------------- |
| Phase 1 | e2e            | [user steps → expected result]       | `e2e/<feature>.spec.ts`       |
| Phase 1 | unit           | [small pure function]                | `src/<module>.test.ts`        |
| Phase 2 | e2e-regression | [existing flow touched by this plan] | `e2e/<other-feature>.spec.ts` |

If a phase has no testable behavior, list it here with the same justification used in the phase body. Manual-only verification is **not** acceptable when testable behavior exists.

Tests are written as a step within each relevant phase, not as a separate phase.

## Human Summary

<!-- This section is for humans only — Claude should write it but not use it for execution. -->

Plain-language overview of the entire plan:

- **What** we're building/changing and **why**
- How the phases connect — what each one accomplishes in simple terms
- What the end result looks like when everything is done
- Any important trade-offs or decisions made during planning
```

---

## Phase shape: vertical slices, not horizontal layers

Phases must be **vertical slices** — each one delivers a thin, end-to-end piece of the feature that the user (or QA) can exercise on its own. Never **horizontal layers** (Phase 1 = schema, Phase 2 = API, Phase 3 = UI) where nothing is testable until the last phase lands.

**Vertical (correct):**

- Phase 1 — one field works end-to-end: schema field + API route + minimal UI input + display. Testable: user enters the field, sees it stored, sees it back.
- Phase 2 — validation + error states. Testable: user sees error messages on bad input.
- Phase 3 — bulk import + advanced filters. Testable: user uploads a CSV.

**Horizontal (wrong):**

- Phase 1 — add all schema fields and migrations.
- Phase 2 — build all API routes.
- Phase 3 — build the full UI.

**The acid test for every phase:** "After this phase commits, what can the user (or QA) actually do that they couldn't before?" If the answer is "nothing observable," the phase is horizontal — combine it with the next, or push the layer-work down inside the first vertical slice that needs it.

**Allowed exceptions** (must be explicitly justified in the plan):

- Pure infrastructure prerequisites with zero user-facing surface (new package scaffold, worker process setup) — at most one thin phase before the first feature slice.
- Schema-only refactors with no behavior change.

---

## Execution conventions

- **Top-to-bottom**: phases run sequentially. Phase N+1 does not start until Phase N's review is **green with zero findings** and its checklist is complete.
- **One implementation commit per phase** (commit message from the phase's `Commit message` field), plus one fix commit per review round.
- **Two ways to execute** — pick one:
    - **`/execute-prd <slug>`** (subagent-dispatched, recommended). Runs autonomously: creates the worktree, dispatches the matching specialist per phase, runs the review gate (fix every finding until green with zero findings), advances on its own, runs Final Verification, syncs `.ai/`, then stops for merge approval. Stops early only on `Mode: hil` phases or when a phase can't be made clean. See [`.claude/skills/execute-prd/SKILL.md`](../execute-prd/SKILL.md).
    - **Manual** — orchestrator runs phases in the current session, ticks checkboxes by hand, runs reviewer handoff per phase via `/clear` + paste. The same zero-findings gate applies.
- **Reviewer handoff (manual path)**: see the "Reviewer Handoff Prompt" section in `write-prd` SKILL.md.
- **Never merge without the orchestrator's explicit approval.**
- **Tick checkboxes in the plan file** as you go — the file is the source of truth for progress. Reviewer should always read an up-to-date plan. Under `/execute-prd`, the main thread ticks them after each phase; subagents do not edit the plan file.
- **Reflect reviewer-driven changes back into the plan file in the same turn** as the code change. The plan must always reflect the actual implementation.

---

## Format-specific rules

1. **Phase 0 is always worktree creation** — every plan starts with a `git worktree add` step. No exceptions. No confirmation needed.
2. **Phases map to commits** — each phase = one implementation commit (plus review-fix commits). If a phase needs multiple implementation commits, split it.
3. **Phases are vertical slices** — see the section above. Two exceptions, both requiring justification: pure infra prereqs, or schema-only refactors.
4. **Tests are per-phase, end-to-end first, and enumerated** — every phase lists its `e2e` scenarios (one or more per success criterion), its `unit` tests for small pure functions, and every affected `e2e-regression` spec, in its `Tests` subsection AND in the top-level `Tests` mapping table.
5. **Documentation is per-phase** — each phase that changes package behavior includes a documentation step pointing to the relevant README.
6. **Mark progress in the document** — tick checkboxes after executing a phase, before moving on.
7. **Review gate is absolute** — a phase is done only on a green review with zero blocking findings and zero nits.
8. **Never merge without explicit approval** — commits on the plan branch are autonomous; merging into the base ref is not.

---

## Common pitfalls

- **Horizontal layering** — phases that map to architectural layers instead of feature slices. Nothing testable until the last phase lands.
- **Monolith phases** — if a phase touches more than 3–4 files, split it.
- **Unverifiable phases** — "update config" with no way to verify is incomplete. Add a test command.
- **Manual-only verification when testable behavior exists** — write the e2e scenario.
- **Feature proven only by unit tests** — every success criterion needs an e2e scenario.
- **Forgetting regression specs** — changing shared code (e.g. the wallet connection) without listing the specs whose `@covers` match it.
- **Missing documentation mapping** — every plan must map changes to README locations.
- **Missing tests mapping** — every plan must include the top-level `Tests` mapping table covering every phase with testable logic.
- **Skipping Phase 0** — never start implementation without creating the worktree first.
- **Skipping review, or advancing with open nits** — every phase is reviewed and every finding fixed before the next phase starts.
- **Over-tagging `hil`** — if an agent can do or verify it (tests, scripts, browser automation), it's `afk`.
