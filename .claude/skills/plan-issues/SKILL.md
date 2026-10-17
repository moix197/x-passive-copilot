---
name: plan-issues
description: Internal format spec for kanban-DAG plans. Loaded on demand by `write-prd` and `execute-prd`; not user-invoked.
---

# plan-issues — Output format spec

This skill is a **format library**, not an entry point. It serves two
audiences:

1. **The Phase 2 specialist in `write-prd`** — produces the initial DAG of cards
   per this spec.
2. **Card-execution sessions** — opened by the orchestrator inside the plan
   worktree, each picks one Ready card and executes it. They read this file to
   know how to pick, mark, work, and commit.

Both audiences must follow the same spec so the board state stays coherent
across multiple parallel sessions.

---

## Directory layout

A plan in issues format lives at `plans/<state>/<plan-slug>/` (a directory, not
a file), where `<state>` is `pending`, `in-progress` or `completed` (written to
`pending/` by `write-prd`, moved by `/execute-prd`):

```
plans/<state>/<plan-slug>/
  README.md          # context, scope, why-this-feature, how to execute
  BOARD.md           # the kanban index — Ready / In Progress / Blocked / Done / Failed
  cards/
    C00.md           # always: "Create worktree" (first card, no deps)
    C01.md
    C02.md
    ...
```

Slug is kebab-case, descriptive: `add-search-feature`, `migrate-storage-layer`,
`refactor-payment-flow`.

There is no `.draft` directory — Phase 2 of `write-prd` writes directly into
`plans/pending/<plan-slug>/`, Phase 3 revises in place, Phase 4 confirms structure.

---

## README.md

Top-level plan context. Required sections:

```markdown
# Plan: <Title>

**Created:** <date>
**Branch:** <branch suggested for the worktree>
**Status:** pending | in-progress (started YYYY-MM-DD) | completed (YYYY-MM-DD)

## Context

Why this change is being made — the problem, what prompted it, intended outcome.

## Scope

- What's in scope
- What's explicitly out of scope

## How to execute

Two options — pick one:

**Option A — `/execute-prd <slug>` (subagent-dispatched, recommended).**
Run `/execute-prd <slug>` from the main checkout. It runs autonomously:
creates the worktree, reads BOARD.md, computes the Ready set, dispatches up to
N specialist subagents in parallel (default `--concurrency 3`) for `mode: afk`
cards, runs the review gate on each (fix every finding until green with zero
blocking findings and zero nits), and starts the next batch on its own. At the
end it runs Final Verification, syncs `.ai/`, and stops for merge approval.
Stops early at `mode: hil` cards or a card that can't be made clean. See
[`.claude/skills/execute-prd/SKILL.md`](../execute-prd/SKILL.md).

**Option B — manual parallel sessions.**
The orchestrator opens N Claude Code sessions in the plan worktree
(`cd <worktree path>`), one per card to run in parallel. Each session reads
[BOARD.md](BOARD.md), picks one Ready card, and follows the session-pickup
protocol in `.claude/skills/plan-issues/SKILL.md`. After each card commits,
the orchestrator reviews the diff via the `code-reviewer` agent; the same
zero-findings gate applies.

Either way: repeat until BOARD.md shows all cards Done. Final Verification
covers the whole change end-to-end; merging always waits for explicit approval.

## Documentation

| Change        | Documentation location                         |
| ------------- | ---------------------------------------------- |
| <description> | `<path/to/README.md>` |

Documentation is added as a step within each relevant card, not as a separate
card.

## Knowledge Base Impact

Identify the `.ai/` knowledge-base changes this plan requires. Decision-oriented
only — capture *why*, constraints, and the map; never restate code.

| Entry id (`<domain>/<slug>`) | Action    | Type     | What it captures                |
| ---------------------------- | --------- | -------- | ------------------------------- |
| `<domain>/<new-slug>`        | add       | decision | the why + rejected alternatives |
| `<domain>/<existing-slug>`   | edit      | map      | new module → path               |
| `<domain>/<existing-slug>`   | supersede | decision | replaced by `<domain>/<new-slug>` |
| `<domain>/<existing-slug>`   | retire    | gotcha   | subject removed by this change  |

Action is `add | edit | supersede | retire`; Type is the entry's frontmatter
`type`. Indexes are generated — never list them. If this plan introduces no new
concept, module, flow, or decision, write
`_None — no knowledge-base impact._`. Keeping `.ai/` current is part of "done" —
`execute-prd` syncs it at closeout via the `sync-knowledge` skill, which owns the
rules.
```

---

## BOARD.md

The kanban index. Sections always in this order: Stats, Ready, In Progress,
Blocked, Done, Failed.

```markdown
# Board: <plan-slug>

**Worktree:** <path>
**Branch:** <branch>
**Status:** pending | in-progress (started YYYY-MM-DD) | completed (YYYY-MM-DD)

## Stats

- Ready: <n> · In Progress: <n> · Blocked: <n> · Done: <n> · Failed: <n>

## Ready

- [C03](cards/C03.md) — Add /api/users CRUD route

## In Progress

- [C04](cards/C04.md) — Wire user profile page (session: <session-id>)

## Blocked

- [C05](cards/C05.md) — Add E2E test (deps: C03, C04)
- [C06](cards/C06.md) — Update users README section (deps: C03, C04, C05)

## Done

- [x] [C00](cards/C00.md) — Create worktree (commit: a3f421b)
- [x] [C01](cards/C01.md) — Set up permissions (commit: 9d2e1a4)

## Failed

- [C09](cards/C09.md) — Add migration script (notes: see card body)
```

When a card transitions, the session updates **both** the card's frontmatter
**and** the BOARD.md columns in the same edit. Stats are recomputed.

If `Ready`, `In Progress`, `Blocked`, `Done`, or `Failed` is empty, write `_(none)_` under the heading. Don't omit the section.

---

## Card file schema

Every card lives at `plans/<state>/<plan-slug>/cards/<id>.md`. YAML frontmatter +
markdown body.

### Frontmatter (required)

```yaml
---
id: C03
title: Add /api/users CRUD route
status: ready          # ready | in-progress | done | blocked | failed
mode: afk              # afk | hil — afk = subagent does it (default); hil = only what an agent truly can't do
type: backend          # backend | frontend | typescript | security | docs | ux | config | test | mixed
model: sonnet          # haiku | sonnet | opus — cost-aware model routing for /execute-prd. Default: sonnet.
depends_on: [C01]
touches:
  - src/users/users.controller.ts
  - src/users/users.controller.test.ts
session: null          # filled by session that picks card; null otherwise
commit: null           # filled with SHA when card lands; null otherwise
---
```

Field rules:

- `id` — `C00`..`Cnn`, two digits minimum, monotonically assigned at plan-write
  time. `C00` is reserved for "Create worktree".
- `status` — exactly one of: `ready`, `in-progress`, `done`, `blocked`, `failed`.
  At plan-write time every card except `C00` starts as `blocked` if it has
  unmet `depends_on`, otherwise `ready`. `C00` always starts `ready`.
- `mode` — `afk` or `hil`. **`afk`** (default) = a subagent can implement this
  autonomously; `/execute-prd` includes it in parallel batches. **`hil`**
  (human-in-the-loop) = the orchestrator must do it manually; `/execute-prd`
  stops at this card and waits. Use `hil` **only** when an agent truly cannot
  do it: design decisions left open, deploy steps, external systems Claude
  can't reach, a manual check nothing automated can cover. The
  final-verification card is `afk` — `/execute-prd` runs it, then stops for
  merge approval.
- `type` — work type for specialist routing under `/execute-prd`. One of
  `backend`, `frontend`, `typescript`, `security`, `docs`, `ux`, `config`,
  `test`, `mixed`. Maps to a subagent: `backend` → `backend-architect`,
  `frontend` → `nextjs-frontend-architect`, `typescript` → `typescript-expert`,
  `security` → `api-security-auditor`, `docs` → `api-documenter`, `ux` →
  `ux-design-architect`; `config`/`test`/`mixed`/unset fall back to
  `general-purpose`. See [`.claude/skills/execute-prd/SKILL.md`](../execute-prd/SKILL.md).
- `model` — `haiku`, `sonnet`, or `opus` (never `fable`, never an older
  model). Cost-aware routing for `/execute-prd`'s Agent-tool calls on this
  card. Default `sonnet`. `haiku` for docs/`.ai`/config/mechanical/test-only
  cards; `opus` for distributed/concurrent/serverless state, security-sensitive
  decisions, cross-package architecture, or anything the card leaves partly
  open — the Final-Verification card is always `opus`. Full rubric in
  `write-prd` SKILL.md Phase 2 "Mode + Type + Model tagging".
  `/execute-prd` escalates this one tier per review-fix round and on an
  implementation retry (never de-escalates); see
  [`.claude/skills/execute-prd/SKILL.md`](../execute-prd/SKILL.md).
- `depends_on` — list of card ids that must reach `done` before this card can
  become Ready. Empty list means no dependencies.
- `touches` — list of file paths (relative to repo root) the card will edit or
  create. Used by the Ready predicate to prevent two parallel sessions from
  editing the same file. **Be honest and complete here** — undeclared touches
  cause cross-session conflicts. Test files count.
- `session` — filled with the executing session's id (any short identifier the
  session emits) when a card moves to `in-progress`. Cleared if the card moves
  back to `ready` or to `failed`.
- `commit` — filled with the commit SHA when the card moves to `done`.

### Body (required sections)

```markdown
## Scope

2–4 sentences describing what this card delivers end-to-end.

## Files to touch

- `path/to/file.ts` — what changes here, which existing helper to reuse
- ...

## Reuse first

- Existing helpers / patterns / similar implementations (with file:line refs).
  Drives the session to use existing utility / shared packages in the repo
  before writing new code.

## Acceptance criteria

- [ ] Concrete behavior 1 — e2e scenario: <user steps> → <expected result> (`e2e/<feature>.spec.ts`, `@covers` <globs>)
- [ ] Concrete behavior 2 — e2e scenario: …
- [ ] Unit tests for small pure functions only, if any: `<file>`
- [ ] Affected e2e specs pass (every spec whose `@covers` matches a file in `touches`; full suite if a touched file is cross-cutting or uncovered): `<spec list | full suite>`
- [ ] `pnpm check` passes
- [ ] Documentation updated: `<path/to/README.md>`
- [ ] Commit message references this card id (e.g., `feat(api): add users CRUD [#C03]`)

## Out of scope

What explicitly NOT to touch in this card. Pushes scope creep into a separate
card.

## Notes for QA

What the orchestrator should look at specifically when reviewing this card
(security implications, edge cases the card author noticed, etc.).
```

Testing follows CLAUDE.md `## Testing`: **end-to-end first** — every behavior
criterion is proven by an e2e scenario; unit tests only for small pure
functions; affected e2e specs (by `@covers`) always run. New or edited spec
files go in `touches`; specs that only run do not.

If a card has no testable behavior, the `Acceptance criteria` block must include a
justification line: `No automated tests — justified because: <reason>`.
Acceptable reasons match the sequential format spec: pure config registration
with explicit validation coverage, pure README/docs change, pure scaffolding
with no behavior. "It's hard to test" is **not** acceptable. Affected e2e specs
still run.

---

## Ready predicate

A card is **Ready** iff **all** of the following hold:

1. `status: ready` (literally — sessions only consider cards with this exact
   status; cards with `blocked`, `in-progress`, `done`, or `failed` are not
   candidates).
2. Every card listed in `depends_on` has `status: done`.
3. No card with `status: in-progress` shares any path in `touches` with this
   card.

Condition 3 is the parallel-safety guarantee: two Ready sessions in the same
worktree will never edit the same file. Hot files (e.g., `package.json`, root
`README.md`, shared registries) become natural serialization points — this is
correct behavior, not a bug. If a hot file is causing too much serialization,
the planner can split the card so only the part that touches the hot file
serializes.

When a session picks up a card, it must mark it `in-progress` in **both** the
card frontmatter and BOARD.md before doing any other work. This makes the
overlap rule effective immediately for any other session computing Ready.

---

## Session pickup protocol

A card-execution session is opened by the orchestrator with `cd <plan-worktree>`
and a prompt like "execute card C03 from `plans/<state>/<plan-slug>/`" (or "pick a
Ready card from `plans/<state>/<plan-slug>/`"). The session follows this protocol
**in order**:

1. **Read the board.** Read `plans/<state>/<plan-slug>/BOARD.md` and (if a specific
   card was requested) `plans/<state>/<plan-slug>/cards/<id>.md`. If a specific card
   was requested but its computed status is not Ready (per the Ready
   predicate), abort with a message explaining why (e.g., "C05 is Blocked:
   waiting on C03").
2. **Pick (if free choice).** If no specific card was requested, scan all
   cards, compute the Ready set, pick one. Prefer cards with the most
   downstream dependents (unblocks the most work). Tie-break by smallest id.
3. **Claim it.** In a single edit pass:
   - Update the card's frontmatter: `status: in-progress`, `session: <id>`.
   - Update BOARD.md: move the card from `Ready` to `In Progress`; recompute
     Stats.
   - Do not commit this update yet — see "Commit discipline" below.
4. **Read scope.** Read the card body in full. Apply all `write-prd` quality
   standards: reuse-first via any project-specific MCP tools listed in
   CLAUDE.md, tests, docs, validation.
5. **Do the work.** Edit files listed in `touches`. **If you discover the card
   needs to touch a file not in `touches`, stop and report**: either expand the
   card (with orchestrator approval) or split into a follow-up card. Quietly
   editing untouched files breaks the parallel-safety guarantee.
6. **Verify.** Run the tests / commands listed in Acceptance criteria. Tick
   the Acceptance checkboxes in the card body.
7. **On success — commit and finalize:**
   - Stage only the files in `touches` plus the card file and BOARD.md.
   - Commit with a conventional message ending in `[#<card-id>]`. Example:
     `feat(api): add users CRUD [#C03]`.
   - Update the card's frontmatter: `status: done`, `commit: <sha>`,
     `session: null`.
   - Update BOARD.md: move card from `In Progress` to `Done`; recompute Stats.
   - Amend the commit to include the frontmatter/BOARD.md update **only if** it
     is the same commit; otherwise create a follow-up board-update commit
     scoped to this card. Default: amend (cleaner history).
   - Emit the reviewer-handoff prompt as the final message of the session (see
     `write-prd` SKILL.md "Reviewer Handoff Prompt" section). The card counts as
     finished only once its review is green with zero blocking findings and
     zero nits; fix every finding in follow-up commits
     (`fix(<scope>): address review round <k> [#<card-id>]`).
8. **On failure:**
   - Run `git checkout -- <touches>` to revert the card's file edits.
   - Update the card's frontmatter: `status: failed`, `session: null`,
     `commit: null`. Append a "Failure notes" section to the card body
     explaining what went wrong (the test that failed, the missing dependency,
     the unexpected file conflict).
   - Update BOARD.md: move card from `In Progress` to `Failed`; recompute
     Stats.
   - Commit only the card and BOARD.md updates (not the reverted files).
   - Report to the orchestrator. (`/execute-prd` retries once at a higher
     model tier; manual sessions do not retry automatically.)

---

## Commit discipline

- **One implementation commit per Done card.** The card frontmatter + BOARD.md
  update are amended into the same commit. Review-fix rounds add one
  `fix(...) ... [#<card-id>]` commit each.
- **Failed cards** produce a board-only commit (card status → failed, BOARD.md
  updated) so other sessions see the new state. The reverted file changes do
  **not** appear in any commit.
- **Claim updates** (status: ready → in-progress) are uncommitted local state.
  Other sessions read them via filesystem (the session shares the worktree).
  This is fine because all sessions share the same git worktree, hence the
  same working copy.
- **Card id appears in the commit message.** Format:
  `<type>(<scope>): <title> [#<card-id>]`. Examples:
  - `feat(api): add users CRUD [#C03]`
  - `test(auth): add permission fixtures [#C07]`
  - `docs(users): document user permissions [#C08]`

---

## Phase shape: vertical slices, not horizontal layers (cards)

Same rule as sequential plans, applied to cards.

Each card must be a **vertical slice**: a thin end-to-end piece that the user
or QA can exercise on its own. Never a horizontal layer (Card 1 = schema,
Card 2 = API, Card 3 = UI) where nothing is testable until the last card
lands.

**Vertical (correct):**

- C01 — one role + one CRUD endpoint + minimal feature page; user can
  log in and see/create one item.
- C02 — pagination + filters on the feature page.
- C03 — bulk-import CSV.

**Horizontal (wrong):**

- C01 — one role + permissions.
- C02 — all API routes.
- C03 — full UI.

**The acid test for every card:** "After this card commits, what can the user
or QA actually do that they couldn't before?" If the answer is "nothing
observable," the card is horizontal — combine it with the card it enables, or
push the layer-work down inside the first vertical slice that needs it.

**Allowed exceptions** (must be justified in the card body):

- Pure infrastructure prerequisites with zero user-facing surface (new package
  scaffold, worker process setup) — at most one thin card before the first
  feature card.
- Schema-only refactors with no behavior change.
- `C00` (worktree creation) — always present, always justified by being the
  precondition for any other card.

---

## Format-specific rules

1. **`C00` is always "Create worktree"** — first card, no `depends_on`,
   `touches: []`. Body instructs the executor to create the plan's worktree
   via `git worktree add ../<branch-folder> -b <branch> <base-ref>`, without
   confirmation. Every subsequent
   card depends transitively on C00 (no need to list it explicitly in
   `depends_on` — sessions assume the worktree exists; if they're in it, C00
   is Done).
2. **Cards are vertical slices** — see the section above. Two exceptions
   require justification: pure infra prereqs, or schema-only refactors.
3. **`touches` is honest and complete** — undeclared touches break the
   parallel-safety guarantee. Test files count. Config registration files
   count.
4. **One implementation commit per Done card** (plus review-fix commits) — card id in every commit message.
5. **Review gate after every card** — green with zero blocking findings and
   zero nits; every finding fixed and re-reviewed. Dependents don't start
   until it passes.
6. **End-to-end first** — each behavior criterion has an e2e scenario; unit
   tests only for small pure functions; every card lists its affected e2e
   specs (by `@covers`, or the full suite for cross-cutting / uncovered files).
7. **Documentation is per-card** — each card that changes package behavior
   includes a documentation step pointing to the relevant README.
8. **Failures stop the area** — a card that still fails after one escalated
   retry, or can't pass the review gate in 3 fix rounds, stops the loop for
   the orchestrator to triage.
9. **Final verification card** — the last card in every plan is `Cnn — Final
   Verification`, `mode: afk`, **always `model: opus`**, depends on all other
   cards (transitively). `/execute-prd` runs it at closeout: full test suite,
   end-to-end opus review under the zero-findings gate, `.ai/` sync — then
   stops for merge approval.
10. **Never merge without explicit approval** — commits on the plan branch are
   autonomous; merging into the base ref is not.

---

## Common pitfalls

- **Lying about `touches`** — declaring fewer files than the card actually
  edits breaks parallel safety. Two sessions can then race on the same file.
- **Horizontal layering** — cards that map to architectural layers instead of
  feature slices. Same anti-pattern as horizontal sequential phases.
- **Cards that depend on too many things** — if a card has `depends_on:
  [C01, C02, C03, C04, C05]`, it's likely a "build everything then integrate"
  card, which is itself horizontal. Push integration concerns into the cards
  that produce the parts.
- **Hot-file bottlenecks** — if `package.json` or a shared registry shows up
  in most cards' `touches`, parallelism collapses. Either accept the
  serialization (correct behavior) or split the cards so only one tiny card
  touches the hot file (e.g., a single "register" card that depends on the
  implementation cards).
- **Skipping `git checkout -- <touches>` on failure** — leaves a polluted
  worktree that other sessions will trip on. Always revert on failure.
- **Mixing two cards in one commit** — breaks the one-commit-per-card audit
  trail. If you find yourself wanting to bundle, split the cards or merge
  them in the plan first.
- **Editing files outside `touches`** — if you discover you need to, stop and
  expand the card with orchestrator approval. Don't quietly edit; you'll race
  another session.
- **Working on cards in the wrong worktree** — sessions must be opened in the
  plan's worktree, not the main checkout. The plan worktree is the unit of
  isolation.
