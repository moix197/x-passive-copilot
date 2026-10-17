---
name: execute-prd
description: Execute a plan from `plans/pending/` or `plans/in-progress/` (sequential file or issues BOARD.md). Triggers on "/execute-prd", "execute the plan", "run the plan".
---

# execute-prd Skill

Reads a finalized plan and executes it **autonomously** by dispatching
specialized subagents per unit, all the way to a merge-ready branch. The
orchestrator (the user) is pulled in only when:

- a unit is `hil` (genuinely needs a human),
- a unit can't be made clean within the fix-round limit (see Review gate),
- a unit needs to touch files outside its declared scope,
- **the finished branch is ready to merge** — the skill never merges without
  explicit approval.

**Hard rule — the review gate.** A unit (phase or card) is done only when the
code-reviewer returns **green with zero blocking findings and zero nits**.
Every finding, nits included, is fixed and re-reviewed before the next phase
or batch starts. No exceptions, no "accept with follow-up".

The main context stays small because subagents commit their own work; the main
thread sees only ≤150-word implementation reports and ≤200-word review
reports.

---

## Preflight

Before starting any execution loop, the skill performs these checks **in
order**. Bail with a clear instruction if any fails.

1. **Resolve plan path.** Argument is `<plan-slug>` (kebab-case, no extension). Resolve relative to the current working directory's `plans/`. Look in `plans/in-progress/` first (resume an interrupted plan), then `plans/pending/`.
    - If `plans/<state>/<slug>.md` exists → shape is **sequential**.
    - Else if `plans/<state>/<slug>/BOARD.md` exists → shape is **issues**.
    - Else if it exists only under `plans/completed/` → abort: "Plan `<slug>` is already completed."
    - Else → abort: "No plan found at `plans/in-progress/` or `plans/pending/` (`<slug>.md` or `<slug>/BOARD.md`). Run `/write-prd` first."
    - Record `<state-dir>` (`in-progress` or `pending`) where it was found.
    - Capture the **absolute** plan path (sequential: file; issues: directory). Subagents will receive these via prompt — they read plans by absolute path because the main thread's CWD is not the worktree.

2. **Read the plan's declared branch and base ref.** From sequential `**Branch:**` line near the top of `plans/<state-dir>/<slug>.md`, or `**Branch:**` line in `plans/<state-dir>/<slug>/BOARD.md`. The base ref defaults to the repo's default branch unless the plan specifies otherwise.

3. **Parse flags.** Supported flags:
    - `--concurrency <N>` — issues only. Default 3, hard cap 4. Sequential ignores this (always 1).
    - `--step` — manual mode: after each unit passes the review gate, report and wait for the orchestrator before advancing (the old approval-gate behavior).
    - `--once` — run exactly one batch (issues) or one phase (sequential), then exit. Lets the orchestrator `/clear` between batches to reset context.
    - `--afk-only` — issues only. Skip `mode: hil` cards entirely; process only afk Ready cards in batches. When all afk-Ready cards have completed (Done) or are blocked behind hil deps, exit cleanly with a "hil-pending" report listing the remaining hil cards. Sequential plans ignore this flag (phases are strictly ordered, so a hil phase always blocks subsequent ones regardless).
    - `--card <id>` — issues only. Run only the named card if it's Ready; abort if not.
    - `--phase <n>` — sequential only. Run only that phase if it's the next pending; abort if not.

After preflight, run **Phase 0 / Card C00 — Worktree creation** (next section), then branch into the matching execution loop.

---

## Phase 0 / Card C00 — Worktree creation (always runs first)

The plan declares a branch (e.g., `feature/search`) and a base ref (e.g., the repo's default branch). This step ensures a worktree exists for that branch and captures its absolute path; all subsequent unit work happens inside that worktree, addressed via absolute paths from the main thread.

0. **Start the plan (before any worktree).** If `<state-dir>` is `pending`: on the current branch, run `git mv plans/pending/<slug>.md plans/in-progress/` (sequential) or `git mv plans/pending/<slug> plans/in-progress/` (issues), set the plan's `**Status:**` line (sequential: the plan file; issues: README.md and BOARD.md) to `in-progress (started YYYY-MM-DD)`, then commit only the plan files: `chore(plans): start <slug>`. No confirmation needed. Set `<state-dir>` to `in-progress`. The worktree below is created from this commit, so it inherits the in-progress plan. If `<state-dir>` is already `in-progress` (resume), skip this step.

1. **Detect existing worktree.** Run `git worktree list` (Bash, from main thread's CWD). If a worktree for the plan's branch already exists, capture its absolute path; skip to step 3.

2. **Create it — no confirmation needed.** Run:
    ```
    git worktree add ../<branch-folder> -b <plan-branch> <base-ref>
    ```
    On failure (branch already exists with a different base, base ref doesn't exist, etc.), report the git error verbatim and abort.

3. **Capture the worktree absolute path.** Run `git worktree list` again, parse the row matching the plan's branch, store the absolute path as `<worktree>` for use in all subsequent commands and subagent prompts.

4. **Verify the worktree is clean enough.** Run `git -C <worktree> status --porcelain`. If there are uncommitted changes that overlap with any pending unit's `touches`, abort: "Worktree has uncommitted changes that overlap with pending units. Commit or stash before executing." Unrelated uncommitted changes are fine.

5. **Phase 0 / C00 is implicit — no plan-file edit, no commit.** The worktree's existence (verified by `git worktree list`) IS the signal that Phase 0 / C00 is done. The Phase 0 / C00 section in the plan stays as documentation only; its checkboxes / frontmatter are not touched by `/execute-prd`.
    - For sequential: when looking for "the next pending phase," skip Phase 0 unconditionally — start the search at Phase 1.
    - For issues: when computing the Ready set, treat Card C00 as if it had `status: done` regardless of what its frontmatter says — exclude it from Ready and from the unmet-`depends_on` check (any card with `depends_on: [C00]` is treated as having that dep satisfied).

6. Proceed to the matching execution loop.

**Path handling for the rest of execution:**

- The main thread **never `cd`s** (Bash `cd` doesn't persist across tool calls). It addresses the worktree explicitly via:
    - **Git operations**: `git -C <worktree> <subcommand>` (e.g., `git -C <worktree> status`, `git -C <worktree> log -1`).
    - **File operations**: absolute paths (Read, Edit, Write tools accept absolute paths natively).
    - **Test/build commands**: `cd <worktree> && <test command>` in a single Bash call (cd persists for the chained command).
- **Subagent prompts** include `Working directory: <absolute path to worktree>` and explicit instructions to use the same patterns (`cd <worktree> && ...` for shell, absolute paths for file ops, `git -C <worktree> ...` for git).
- **Plan files live INSIDE the worktree** at `<worktree>/plans/<state-dir>/<slug>.md` (sequential) or `<worktree>/plans/<state-dir>/<slug>/` (issues) — `in-progress` during execution, `completed` after Closeout Step 2. Subagents read AND update them via worktree-internal absolute paths. Plan/BOARD/card updates are committed in the worktree alongside (or amended into) the corresponding code commit.

---

## Test runs (CLAUDE.md `## Testing`)

Every unit's tests are **its own e2e specs + every affected e2e spec + unit
tests + `pnpm check`**. Compute the affected specs from the unit's diff:

```
changed = git -C <worktree> diff --name-only <unit-base>..HEAD
affected = every e2e spec whose `@covers` globs match any changed file
if any changed file is cross-cutting (app shell, routing, auth, config,
   shared UI primitives, package.json / lockfile) or matches no spec's
   `@covers` → run the FULL e2e suite
```

Add the plan's listed `e2e-regression` specs too — the union, never the
intersection. Example: a unit builds a swap feature and edits the wallet
connection → it runs the swap specs **and** every spec covering the wallet
connection.

**Parallel batches (issues) never run e2e or builds concurrently** in the
shared worktree (ports, databases and build output would collide).
Implementation and fix subagents in a batch run only `pnpm test:unit` and the
typecheck. The main thread then dispatches **one** test-runner subagent
(`general-purpose`, `model: haiku`) that runs `pnpm check` once and the union
of every card's own + affected e2e specs, and replies with pass/fail per spec
and only the failing specs' error lines. A failure goes to the owning card(s)
— a spec maps to every card whose diff matches its `@covers` — as a
**blocking** finding for its Review gate.

---

## Review gate (hard rule, both shapes)

Runs after every successful implementation commit. The next phase / batch
never starts until every unit in flight has passed it.

```
gate(unit):
    round = 0
    loop:
        dispatch code-reviewer → findings (blocking + nits) + verdict
        if verdict == green AND blocking == 0 AND nits == 0 → PASS
        if round == 3 → STOP: report open findings, wait for orchestrator
        round += 1
        tier = one above the unit's current tier (cap opus; never lower)
        dispatch fix subagent at `tier` with EVERY open finding
        if fix subagent reports a finding needs a file outside `touches`
            → STOP: report, wait for orchestrator
        if fix subagent's tests fail → counts as the round; loop re-reviews
```

- **Green means clean.** A verdict of green with any nit still listed is not a
  pass. Yellow and red never pass.
- **Every finding is fixed** — blocking and nits alike. The fix subagent does
  not get to decide a nit is optional.
- **Fix rounds escalate** one model tier each round (`haiku` → `sonnet` →
  `opus`), capped at `opus`, never de-escalating. Record the final tier on the
  unit (see Escalation).
- **Limit: 3 fix rounds per unit.** If round 3's re-review still has findings,
  stop the whole loop and report them; the orchestrator decides.
- **Fix commits** are separate commits on the worktree branch:
  `fix(<scope>): address review round <k> [Phase <N>]` /
  `... [#C<id>]`. Each fix commit carries any plan-file updates the fix
  implies (sequential: main thread ticks/edits the plan; issues: the fix
  subagent updates the card body).
- **Reviewer stays the same agent type** (`code-reviewer`); its model follows
  the reviewer rule below on every round.

**Code-reviewer dispatch** — `subagent_type: code-reviewer`, `model: opus` if
the unit's model is `opus` (including after escalation) or the unit is
Final-Verification; otherwise `model: sonnet`.

```
Review <Phase N — name | Card C<id> — title> of plan <slug>. Round <k>.

Plan/card file: <abs path>
Branch: <branch>
Unit commits: <base-sha>..<head-sha>   (implementation commit + any fix commits)
Files changed: <list>
Focus areas: <copy from unit review section / card "Notes for QA">
Success / acceptance criteria: <copy from unit>
Previous round findings (round ≥1): <list, so you can verify each is resolved>

Read the plan/card file and the full unit diff before writing the review.

Rules for this review:
- List EVERY finding, classified `blocking` or `nit`, each with file:line.
- A nit must be concrete and actionable inside this unit's diff (naming,
  dead code, missing test case, unclear logic, CLAUDE.md style violation).
  Not taste that contradicts CLAUDE.md or the surrounding code's conventions.
- Testing (CLAUDE.md `## Testing`) — BLOCKING: a success criterion with no
  e2e scenario proving it; a changed file whose covering e2e specs were not
  run; a new spec with missing or wrong `@covers`; a spec that sleeps,
  depends on other tests, or fakes our own code. NIT: a unit test that mocks
  the code under test or tests wiring instead of a small pure function.
- Verify every previous-round finding is resolved; re-list any that are not.
- Verdict: `green` ONLY when there are zero blocking findings AND zero nits.
  Otherwise `yellow` (nits only) or `red` (any blocking).

Reply with (≤200 words):
- Findings: blocking | nits (file:line, one line each)
- Verdict: green | yellow | red
```

**Fix subagent dispatch** — same `subagent_type` as the unit's
implementation (from the specialist mapping), `model` = the escalated tier.

```
You are fixing review findings for <Phase N | Card C<id>> of plan <slug>, round <k>.

Working directory (worktree): <absolute path to worktree>
Plan/card file: <abs path>
CLAUDE.md: <worktree>/CLAUDE.md
Files in scope (touches): <list>

Path-handling rules: absolute paths for file ops; `cd <worktree> && ...` for
shell; `git -C <worktree> ...` for git.

Fix EVERY finding below — blocking and nits alike. None is optional.
<findings verbatim, file:line>

1. Fix each finding inside the files in scope. If a finding cannot be fixed
   without editing a file outside scope, STOP and report which one and why.
2. Run the unit's tests per execute-prd "Test runs": sequential → its own +
   affected e2e specs, `pnpm test:unit`, `pnpm check`; parallel batch →
   `pnpm test:unit` + typecheck only (the batch test runner runs the rest).
3. Commit: `git -C <worktree> add <changed paths> && git -C <worktree> commit -m "fix(<scope>): address review round <k> [<Phase N | #C<id>>]"`.
4. Reply (≤150 words): commit SHA, one line per finding (fixed / blocked +
   reason), tests run + result.
```

---

## Sequential execution loop

```
loop:
    read plan, find next pending phase
    if none → go to Closeout
    if phase.mode == hil → emit hil-stop report, wait for orchestrator
    else → dispatch implementation subagent
           wait for report (on failure → Failure handling)
           run Review gate until PASS (or STOP)
           tick checkboxes in plan file, commit them in the worktree
           emit one-line phase report
           if --step → wait for orchestrator; else continue immediately
    if --once → stop after one phase
```

**Finding the next pending phase**:

1. Read `<worktree>/plans/<state-dir>/<slug>.md`.
2. Skip Phase 0 unconditionally (worktree creation is implicit — handled by preflight; Phase 0's checkboxes never get ticked, by design).
3. Find the first phase (Phase 1 onward) whose final review checkbox (`- [ ] Phase marked complete`) is unticked.
4. If that phase is the Final-Verification phase, go to Closeout (it is run by the skill, not dispatched as an implementation unit).

**hil-stop report** (when `Mode: hil`):

```
Phase <N> — <name> is **hil** (human-in-the-loop).

Required action: <copy the phase's "Steps:" or hil instructions verbatim>

Files in scope: <copy from phase's File changes table>

When done, tick the phase's review checkboxes in plans/<state-dir>/<slug>.md and reply
to advance.
```

Then stop. Wait for orchestrator's next message before recomputing.

**Implementation subagent dispatch** (when `Mode: afk`):

Use the Agent tool. `subagent_type` from the unit's `Type` field via the
mapping in this skill's "Subagent → specialist mapping" section. `model` from
the unit's `**Model:**` field (`haiku`, `sonnet`, or `opus`); default `sonnet`
if the field is missing. Never pass `fable` or an older model.

Prompt template (fill bracketed fields, keep ≤500 words):

```
You are implementing Phase <N> of plan <slug>.

Working directory (worktree): <absolute path to worktree>
Plan file: <worktree>/plans/<state-dir>/<slug>.md
CLAUDE.md: <worktree>/CLAUDE.md

Path-handling rules (your shell session is NOT in the worktree):
- File ops (Read/Edit/Write): use absolute paths starting with the worktree path.
- Shell commands (tests, builds): prefix with `cd <worktree> && ...` in a single Bash call.
- Git commands: use `git -C <worktree> <subcommand>` form (e.g., `git -C <worktree> status`).

Your task: <copy the phase's success criteria and steps verbatim>

Files in scope (do not edit anything outside this list — paths are relative to the worktree root, but use absolute paths in tool calls):
<copy the phase's File changes table>

Tests to write and run (CLAUDE.md `## Testing` — end-to-end first):
<copy the phase's Tests table>
Affected e2e specs (computed by the main thread from `@covers`): <list | full suite>

Required workflow:
1. Read the plan file (absolute path above) and the phase's full body.
2. Read CLAUDE.md (absolute path above). Use any project-specific MCP tools
   listed there BEFORE reading config, model, or permission files directly.
3. Reuse existing helpers — check existing utility / shared packages in the
   repo before writing new utilities.
4. Implement per the phase's steps. Stay within the file list above; if you
   discover you need to touch a file outside it, STOP and report instead of
   editing.
5. Write the phase's e2e scenarios (each new spec starts with its `@covers`
   line) and any unit tests. Then run, via `cd <worktree> && ...`: this
   phase's e2e specs, the affected e2e specs above, plus any spec whose
   `@covers` matches a file you changed that isn't listed, `pnpm test:unit`,
   and `pnpm check`. If all pass, proceed; if any fail, STOP and report.
6. Commit with: `git -C <worktree> add <touches> && git -C <worktree> commit -m "<copy the phase's Commit message>"`.
7. Reply with (≤150 words):
   - Commit SHA (from `git -C <worktree> log -1 --format=%H`)
   - Files changed (paths only)
   - Tests run + result
   - Any concerns or things the orchestrator should know

Do NOT:
- Edit the plan file or check off any checkboxes (the main thread does that).
- Edit files outside the in-scope list.
- Skip project-specific MCP tools listed in CLAUDE.md.
- Add scope beyond the phase's success criteria.
- Add error handling or fallbacks for things that can't happen.
- Commit secrets or .env files.
- `cd` your shell session permanently (each Bash call starts fresh; chain `cd <worktree> && ...` in each call that needs the worktree CWD).
```

**After the review gate passes**:

- Tick the phase's checkboxes in the plan file (Steps, Verification, Phase review), reflect any review-driven changes into the plan body, and commit: `git -C <worktree> commit -m "chore(plan): complete phase <N> [<slug>]"`.
- Emit the one-line phase report (see Reporting format).
- Continue to the next phase immediately, unless `--step` (wait for orchestrator) or `--once` (stop).

---

## Issues execution loop

```
loop:
    read BOARD.md, scan cards/
    compute Ready set (per plan-issues predicate)
    partition into Ready-afk and Ready-hil
    if Ready-afk non-empty:
        take up to N (concurrency) afk cards
        dispatch N implementation subagents IN PARALLEL (single Agent message)
        await all (failures → Failure handling)
        run the batch test runner once (see Test runs); failures become
          blocking findings for the owning cards
        run the Review gate for every successful card IN PARALLEL
          (after each fix round, re-run the batch test runner before re-review)
          (each round: all reviewers in one message, then all fix subagents
           in one message — touches are disjoint, so fixes can't collide)
        await all gates PASS (any STOP → stop the loop, report)
        emit batch report
        if --step → wait for orchestrator; else continue immediately
    elif Ready-hil non-empty:
        if --afk-only:
            emit "hil-pending" report listing all remaining hil cards
            stop (orchestrator handles them later, then re-invokes without --afk-only)
        else:
            emit hil-stop report for first Ready-hil card
            wait for orchestrator
    else if only Final-Verification remains → go to Closeout
    else:
        "Only Failed/blocked-on-Failed cards remain." stop, report
    if --once → stop after one batch
```

**Computing Ready set**:

A card is **Ready** iff (per [`plan-issues`](../plan-issues/SKILL.md)):
1. `status: ready` in frontmatter
2. Every card in `depends_on` has `status: done`
3. No card with `status: in-progress` shares any path in `touches`

**C00 (worktree creation) is treated as always-done by `/execute-prd`** regardless of what its frontmatter says — exclude C00 from the Ready set, and treat any `depends_on: [C00, …]` as if C00 were already done. The worktree's existence (confirmed in preflight via `git worktree list`) is the source of truth, not the BOARD's view of C00. C00's frontmatter is never edited by `/execute-prd`.

The Final-Verification card is never dispatched as an implementation unit; it is run by Closeout.

The skill recomputes Ready before every batch, and only after every gate in the previous batch has passed.

**Selecting the batch**:

- Sort Ready-afk by: most downstream dependents (unblocks the most), then smallest id.
- Take up to `--concurrency` cards (default 3, hard cap 4).
- The hard cap exists to bound chat growth — never raise it without orchestrator awareness.

**Parallel implementation dispatch**:

Single Agent-tool message with N tool uses, each with `subagent_type` matching
that card's `type` field and `model` matching that card's `model` field
(`haiku`, `sonnet`, or `opus`; default `sonnet` if missing; never `fable` or
an older model).

Prompt template per card (≤400 words each):

```
You are implementing Card <id> of plan <slug>.

Working directory (worktree): <absolute path to worktree>
Plan README: <worktree>/plans/<state-dir>/<slug>/README.md
BOARD: <worktree>/plans/<state-dir>/<slug>/BOARD.md
Card file: <worktree>/plans/<state-dir>/<slug>/cards/<id>.md
Format spec (read this for the session-pickup protocol):
  <absolute path to .claude/skills/plan-issues/SKILL.md>
CLAUDE.md: <worktree>/CLAUDE.md

Path-handling rules (your shell session is NOT in the worktree):
- File ops (Read/Edit/Write): use absolute paths starting with the worktree path.
- Plan/BOARD/card files live INSIDE the worktree (paths above). Edit them via
  absolute paths, and commit the edits in the worktree along with your code.
- Shell commands (tests, builds): prefix with `cd <worktree> && ...` in a single
  Bash call.
- Git commands: use `git -C <worktree> <subcommand>` form. The same commit that
  carries your code changes (`touches`) also carries the card-frontmatter and
  BOARD.md updates — one implementation commit per card.

Required workflow (follows plan-issues "Session pickup protocol"):
1. Read the card file (absolute path) in full.
2. Mark this card in-progress: update its frontmatter (status: in-progress,
   session: <your session id, e.g., "execagent-<id>">), and update BOARD.md
   to move the card from Ready to In Progress with the session id annotation.
   These edits live in the worktree but stay UNCOMMITTED for now (they'll be
   amended into the success commit at step 7).
3. Use any project-specific MCP tools listed in CLAUDE.md BEFORE reading
   config, model, or permission files directly.
4. Reuse existing helpers — check existing utility / shared packages in the
   repo before writing new utilities.
5. Implement per the card's Acceptance criteria, editing files inside the
   worktree using absolute paths. Stay within `touches`; if you need to touch
   a file outside it, STOP and report instead of editing.
6. Write the card's e2e scenarios (each new spec starts with its `@covers`
   line) and any unit tests. Run ONLY `cd <worktree> && pnpm test:unit` and
   the typecheck — never e2e or builds (other cards run in parallel in this
   worktree; the main thread runs e2e for the whole batch afterwards).
   If any fail, STOP and report (do NOT commit on failure).
7. On success:
   a. Update card frontmatter (worktree path): status: done, session: null.
      Tick all Acceptance checkboxes. Leave `commit:` empty for now — fill it
      after the commit lands.
   b. Update BOARD.md (worktree path): move card from In Progress to Done;
      recompute Stats.
   c. Stage everything for this card — code (`touches`) + card file +
      BOARD.md: `git -C <worktree> add <each path in touches> <card file> <BOARD>`.
   d. Commit: `git -C <worktree> commit -m "<type>(<scope>): <title> [#<id>]"`.
   e. Capture the commit SHA: `git -C <worktree> log -1 --format=%H`.
   f. Amend the SHA into the card frontmatter: edit the card again to set
      `commit: <sha>`, then `git -C <worktree> add <card file> && git -C <worktree> commit --amend --no-edit`.
8. Reply with (≤100 words):
   - Commit SHA
   - One-sentence summary of the change
   - Tests run + result

On failure:
- Revert worktree edits inside `touches`: `git -C <worktree> checkout -- <each path in touches>`.
- Update card frontmatter (worktree path): status: failed, session: null,
  commit: null. Append a "Failure notes" section to the card body explaining
  what went wrong.
- Update BOARD.md (worktree path): move card from In Progress to Failed.
- Stage and commit the failure-state update only:
  `git -C <worktree> add <card file> <BOARD> && git -C <worktree> commit -m "chore(plan): mark <id> failed [#<id>]"`.
- Reply with: "FAILED. Card C<id>. Reason: <one sentence>."

Do NOT:
- Edit files outside `touches` (other than the card file and BOARD.md, which
  are explicitly part of this card's commit).
- Skip project-specific MCP tools listed in CLAUDE.md.
- Pick a different card than the one assigned.
```

A card's `status: done` from the implementation commit means "implemented";
the card counts toward unblocking dependents only after its review gate
passes. If a gate STOPs, set that card back to `status: failed` with the open
findings in "Failure notes" (commit it) before stopping the loop.

**hil-stop report** (default mode, when only Ready-hil cards remain):

```
Card <id> — <title> is **hil**.

Required action: <copy card's Scope + Notes for QA>

Files in scope: <copy touches>

When done, update the card frontmatter (status: done, commit: <sha if any>)
and BOARD.md (in <worktree>/plans/<state-dir>/<slug>/), commit those updates in the worktree,
then reply to advance.
```

**`--afk-only` exit report** (when `--afk-only` is set and only Ready-hil cards remain):

```
afk Ready set is exhausted. <K> hil card(s) remain:
- C<id1>: <title>
- C<id2>: <title>
- ...

Handle these manually inside the worktree (<absolute path>):
1. For each hil card: do the work, update its frontmatter (status: done,
   commit: <sha if any>) and BOARD.md, commit in the worktree.
2. When all hil cards are Done, re-invoke `/execute-prd <slug>` (without
   --afk-only) to run any remaining afk cards unblocked by the hil work,
   then run the closeout sequence.
```

The skill exits cleanly. No further action until the orchestrator re-invokes.

---

## Closeout: Final-Verification → complete plan → KB sync → merge approval → merge → cleanup → announce

Runs once every non-final unit is done. Sequential: the Final-Verification phase is the only unticked phase. Issues: every card is Done except Final-Verification.

### Step 1 — Final-Verification (agent-run)

1. **Full test suite.** Dispatch a `general-purpose` subagent (`model: haiku`)
   to run `pnpm check` and the **full** e2e suite (`pnpm test:e2e`) in the
   worktree and reply with pass/fail plus only the failing tests' names and
   error lines. On failure, dispatch a fix subagent
   (`model: opus`, scope = any file in the plan's diff `<base-ref>..<branch>`),
   then re-run. Two failed fix attempts → stop and report.
2. **End-to-end review.** Run the Review gate on the whole change, with
   `model: opus`: unit commits = `<base-ref>..<branch>`, files = the full diff,
   focus = cross-unit regressions, CLAUDE.md invariant violations, the plan's
   overall success criteria. Fix subagents are `opus`; scope = files already in
   the plan's diff. Same zero-findings rule, same 3-round limit.
3. Tick the Final-Verification checkboxes completed so far (all but the
   merge-approval box) and commit in the worktree:
   `chore(plan): final verification [<slug>]`.

### Step 2 — Move the plan to `completed/` (in the worktree, before approval)

Once Step 1 is green: in the worktree, `git -C <worktree> mv plans/in-progress/<slug>.md plans/completed/` (sequential) or `git -C <worktree> mv plans/in-progress/<slug> plans/completed/` (issues), and set the `**Status:**` line (same files as Phase 0) to `completed (YYYY-MM-DD)`. Commit it as its own commit, right before KB sync: `chore(plans): complete <slug>`. Set `<state-dir>` to `completed`.

### Step 3 — Sync the `.ai/` knowledge base (in the worktree, before approval)

So the knowledge-base changes are part of what the orchestrator approves.

- **Skip cleanly** if `.ai/` does not exist, or the plan's `## Knowledge Base
  Impact` section is `_None — no knowledge-base impact._`. Report "KB: no impact"
  and continue.
- Otherwise dispatch a subagent (`model: haiku`; `sonnet` if the impact table
  has `decision` entries needing judgment) that follows the `sync-knowledge`
  skill (`.claude/skills/sync-knowledge/SKILL.md`) **inside the worktree**,
  using the plan's `## Knowledge Base Impact` section as its checklist. That
  skill owns the procedure; `.ai/README.md` owns the format.
- Done only when `cd <worktree> && node .ai/_tools/build-index.mjs --check`
  passes. Commit: `docs(ai): sync knowledge base [<slug>]`.
- Collect the touched entry ids for the reports.

### Step 4 — Request merge approval (always stops here)

```
Plan <slug> is ready to merge.
Branch: <branch> (<N> commits) → <target>
Units: <count> — all reviews green, zero open findings (fix rounds: <total>)
Tests: <full-suite summary>
Knowledge base: <entry ids added/edited/superseded/retired | no impact>
Worktree: <absolute path>

Reply "merge" to merge, or describe changes you want first.
```

**Never merge without an explicit approval** ("merge", "approve", "yes,
merge"). Anything else is not approval:

- **Change requests** → treat each as a fix: dispatch a fix subagent
  (tier per the touched unit, `opus` if cross-unit), run it through the Review
  gate, re-run Step 1.1 (tests) and Step 3 if `.ai/` is affected, then re-issue
  this approval request.
- **"stop"** → exit, leaving branch and worktree in place.

### Step 5 — Merge

On approval:

1. Tick the merge-approval checkbox (the plan is already in `plans/completed/`
   with its `completed (<date>)` Status), commit in the worktree: `chore(plan): approved for merge [<slug>]`.
2. From the main checkout:
   ```
   git checkout <target>
   git merge <branch>
   ```
   `<target>` is the plan's declared base ref.

**On merge conflict** — emit this and exit (the skill never resolves
conflicts itself or switches branches manually):

```
Merge of <branch> into <target> hit conflicts. Resolve in the main checkout:
  # edit conflicting files
  git add <files>
  git commit
Or abort with `git merge --abort`.

When the merge succeeds, re-invoke `/execute-prd <slug>` to continue the
closeout (cleanup).
```

### Step 6 — Clean up worktree and branch (automatic)

Runs after a successful merge, with no confirmation, **only if all three
hold**:

1. The branch is fully merged: `git branch --merged <target>` lists `<branch>`.
2. Nothing is left behind in the worktree: `git -C <worktree> status --porcelain`
   is empty (no modified, staged or untracked files).
3. No stash entries reference the branch: `git stash list` has no entry
   `On <branch>:`.

Then:

```
git worktree remove <absolute path>
git branch -d <branch>
```

`-d` (not `-D`) refuses to delete an unmerged branch — a second safety net.
If any condition fails or either command errors, **keep both**, and report
exactly what was left behind (dirty paths, unmerged commits, stash entries).
Never force-remove.

### Step 7 — Offer to announce (optional)

```
Announce this plan? (y/N)  (default N)
```

On yes, invoke the `announce` skill (`.claude/skills/announce/SKILL.md`) with the
plan slug. It writes drafts only and never posts; do not reimplement it here. On
no or anything else, report "Announce: skipped" and continue.

### Final report

```
Plan <slug> complete.
Branch: <branch>  →  merged into <target> at commit <sha>
Worktree + branch: removed | kept (<reason>)
Knowledge base: <.ai/ entries synced | no impact>
Announce: <folder path | skipped>
```

Then exit.

---

## Failure handling

| Situation | Main-thread action |
|---|---|
| Implementation subagent reports failure (proper protocol) | Verify with `git -C <worktree> status` (clean) and `git -C <worktree> log -1` (no orphan commit). Retry **once** at one tier higher (see Escalation) with the failure reason in the prompt (issues: set the card back to `ready` first). Second failure → stop and report. |
| Implementation subagent crashes / times out | Run `git -C <worktree> status --porcelain`. For any path within the unit's `touches` showing as modified, run `git -C <worktree> checkout -- <path>`. Then same single escalated retry as above. |
| Subagent edited files outside `touches` | Abort hard. Run `git stash --include-untracked` then `git stash drop` to discard the polluting changes. Mark unit failed. Stop and report — this is a parallel-safety violation. |
| A unit needs files outside `touches` | Stop and report. The orchestrator expands the unit or splits it. |
| Review gate hits the 3-round limit | Stop and report the open findings. Do not revert (the commits are useful checkpoints). Orchestrator decides. |
| Plan aborted or failed mid-execution | The plan stays in `plans/in-progress/` (never moved back to pending or on to completed); re-invoking `/execute-prd <slug>` resumes it. |
| Two parallel subagents both claim the same card (race) | Should be impossible — main thread assigns cards from the Ready set in one batch. If observed, abort the loop and report. |

---

## Escalation

Re-dispatch one model tier up (`haiku` → `sonnet` → `opus`) on:

- every Review-gate fix round, and
- the single retry after an implementation failure.

Mechanics:

- Compute the next tier from the unit's *current* `Model`/`model` field (a unit
  already at `opus` stays at `opus`).
- Record the escalation in the plan unit: append
  `(escalated from <old tier>: <one-line reason>)` to the phase's `**Model:**`
  line (sequential) or the card's `model` frontmatter (issues) — e.g.
  `**Model:** opus (escalated from sonnet: review round 1 — missing error
  handling in RPC client)`.
- **Never de-escalate.** Once a unit is tagged at a tier, later re-dispatches
  for that unit never go lower.
- **Never use `fable`, and never an older model.** Escalation stays within
  `haiku | sonnet | opus`.

---

## Subagent → specialist mapping

| `type` field | `subagent_type` |
|---|---|
| `backend` | `backend-architect` |
| `frontend` | `nextjs-frontend-architect` |
| `typescript` | `typescript-expert` |
| `security` | `api-security-auditor` |
| `docs` | `api-documenter` |
| `ux` | `ux-design-architect` |
| `config` / `test` / `mixed` / unset / unknown | `general-purpose` |

For code review, always use `code-reviewer`. Fix subagents use the unit's own mapping.

---

## Context-budget discipline

The whole point of subagent dispatch is to keep the main thread small. Strict
caps protect that:

- **Implementation reply cap**: ≤150 words (sequential) / ≤100 words (issues
  cards, since the protocol is more constrained).
- **Code-review reply cap**: ≤200 words. **Fix reply cap**: ≤150 words.
- **Per-card chat footprint**: ~250–300 words per clean pass, plus ~350 per fix round.
- **`--once` flag** is the escape hatch: run one batch, exit, orchestrator
  `/clear`s, re-invokes for the next batch — full context reset between
  batches. Running autonomously, the skill keeps going; context
  auto-compaction is fine because all state lives in the plan files and git.

The main thread NEVER:
- Pastes diffs into chat (use `git log`/`git show` if the orchestrator asks).
- Echoes plan or card bodies (subagents read them from disk).
- Streams subagent intermediate output (only the final reply lands in chat).

---

## Reporting format (to the orchestrator)

Emitted after each unit / batch; execution continues without waiting unless
`--step`.

**Sequential**:

```
Phase <N> — <name>. Commits `<sha>`..`<sha>`. Review: green, 0 findings (<k> fix rounds). Tests: <summary>.
```

**Issues batch**:

```
Batch <K> ran <M> card(s) at concurrency <N>:
- C<id1>: <title>. Commits `<sha>`..`<sha>`. Review: green, 0 findings (<k> fix rounds).
- ...
Ready next: <count> cards. Blocked: <count>. Done: <done>/<total>.
```

**Stop reports** (gate limit, out-of-scope file, repeated failure) list the
unit, the open findings / reason in 1–5 lines, and the worktree path.

---

## Rules

1. **Auto-detect, don't ask** — shape comes from filesystem. No prompt for sequential vs issues.
2. **Phase 0 / C00 is implicit and unconfirmed** — `/execute-prd`'s first action is to ensure the worktree exists, creating it with `git worktree add` without asking. Phase 0 / C00 in the plan files is documentation only — never ticked, never edited, never committed as a marker. The worktree's existence (verified by `git worktree list`) IS the source of truth. The main thread addresses the worktree via `git -C <worktree>` and absolute paths, and tells subagents the same.
3. **One implementation commit per unit**, plus one fix commit per review round and plan-bookkeeping commits.
4. **`hil` stops the loop** — never dispatch a subagent for a `hil` unit. Report and wait. With `--afk-only` (issues), exit cleanly with a hil-pending report instead of waiting.
5. **Concurrency cap is a hard limit** — default 3, max 4. Override only via flag, never silently.
6. **The review gate is absolute** — every implementation commit is reviewed; the unit passes only on green with zero blocking findings and zero nits; every finding is fixed; the next phase / batch never starts before every gate in flight has passed. Max 3 fix rounds, then stop.
7. **Autonomous by default** — passed units advance without asking. `--step` restores a per-unit approval gate.
8. **Subagents commit their own work** — the main thread never runs `git commit` on subagent output; it commits only plan bookkeeping (checkbox ticks, status). This is what keeps context small.
9. **Touches violations are hard aborts** — a subagent that edits outside `touches` corrupts parallel safety. Stash-drop the changes, mark failed, report.
10. **Plan files live in the worktree** — `<worktree>/plans/<state-dir>/<slug>...`, committed there.
    10a. **Plan status line and folder always match** — pending → in-progress (committed on the current branch before the worktree is created) → completed (in the worktree, before merge approval).
11. **Model choice belongs to the dispatch, not the session.** The orchestrator runs on whatever model the user's session uses and never asks the user to switch. It picks the cheapest qualified model for every subagent: the unit's `Model` tag for implementation, the reviewer rule for code-reviewer, escalation for fixes. It never implements units inline.
12. **Never merge without explicit approval** — closeout always stops at the merge-approval request. After a successful merge, the worktree and branch are removed automatically only when fully merged and nothing is left behind; otherwise kept and reported. Never force-remove.
13. **Follow CLAUDE.md** — every dispatched subagent prompt cites CLAUDE.md and any project-specific MCP tools listed there. Non-negotiable.

---

## Common pitfalls

- **Advancing on a yellow or "green with nits" review** — not a pass. Fix, re-review, repeat.
- **Letting a fix subagent skip nits** — every finding is in scope for the fix round.
- **Skipping Phase 0 / C00** — never start unit work without ensuring a worktree exists for the plan's branch.
- **Forgetting `git -C <worktree>` in the main thread** — running `git status` in the main thread checks the main checkout, not the worktree. Same for subagent prompts.
- **Telling subagents to `cd <worktree>` permanently** — Bash `cd` in a subagent is just as transient as in the main thread. Each Bash call needs its own `cd <worktree> && ...` chain (or `git -C <worktree>` for git commands).
- **Allowing concurrency > 4** — bounds the main context.
- **Letting subagents tick checkboxes in sequential plans** — main thread owns sequential checkboxes; subagents own issues frontmatter + BOARD.md.
- **Merging on anything but an explicit approval** — a "looks good" about one detail, or silence, is not approval to merge.
- **Removing a worktree with leftovers** — check merged + clean + no stash first; `-d`, never `-D` or `--force`.
- **Recomputing Ready while a batch is mid-flight** — only recompute after ALL parallel subagents and gates in the batch return.
- **Pasting subagent intermediate output** — only the final capped replies belong in main context.
- **Letting the worktree drift** — re-check `git -C <worktree> status` between units (no pending unit's `touches` overlap with uncommitted paths).
