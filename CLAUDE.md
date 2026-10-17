# CLAUDE.md — Project Context for Claude Code

## Communication

- When reporting information to me, be extremely concise and sacrifice grammar for sake of concision.

## Tooling

- **Package manager is pnpm** (default; change per project). Always use `pnpm` (not npm or yarn) for installing, running scripts, and managing dependencies.

## Subagents

- **Always delegate subtasks to subagents.** Any subtask — research, codebase exploration, file searches, multi-step investigation, or self-contained implementation work — must run in a subagent (via the Task/Agent tool), not inline in the main context. This keeps the main context clean and focused on coordination and decisions.
- **Main context coordinates, subagents do the legwork.** Reserve the main thread for synthesizing subagent results and making decisions; push the exploratory and verbose work down into subagents.
- **One subagent per discrete subtask.** Scope each subagent narrowly and have it return only the conclusion or artifact needed, not the raw intermediate output.

## Project Knowledge Base

- **The `.ai/` directory is the source of truth for project knowledge.** Any new feature, architectural change, pattern, dependency, or important decision must update the relevant `.ai/` documentation before considering the work complete.
- **When working on changes, always consult the knowledge base first** and keep it synchronized with the current codebase.
- **Read narrowly; entries are atomic, indexes are generated.** Read `.ai/index.md` → the relevant `<domain>/index.md` → only the entries whose summary/tags/paths match the task; never bulk-read a domain. One file = one entry (format: `.ai/README.md`). Indexes are regenerated with `node .ai/_tools/build-index.mjs` — never hand-edited.

## Coding principles

- **Keep entry points thin.** Business logic lives in dedicated layers (services, helpers, hooks) — not inside routes, page components, or top-level entry points.
- **Reuse before reinvent.** Check existing helpers, utilities, and components before writing new code. Duplicating logic that already exists somewhere in the codebase is always wrong.
- **Inspect a similar existing implementation before introducing a new pattern.** Match what's already there.
- **When unsure, prefer consistency with the existing codebase over introducing new patterns or abstractions.**
- **Small focused functions.** Functions should do one thing. If a function exceeds ~30 lines, it's doing too much — break it into smaller named functions that describe what they do.
- **Separation of concerns.** Don't mix data fetching, transformation, validation, and side effects in the same function. Each step should be independently readable and ideally reusable.
- **Name functions after what they do, not how they do it.** `getActiveUser()`, not `processData()`. If you can't name it clearly, the function is probably doing too much.
- **Generic / reusable components accept callbacks only** — no business logic, no redirects, no DOM manipulation baked in.
- **Prefer minimal changes over large refactors.** Make the smallest change that solves the problem; don't tidy up surrounding code that wasn't part of the task.
- **Preserve existing behavior** unless explicitly asked to change it.

## Architecture

- **Modular by packages.** Organize the codebase as discrete packages, each owning a single, well-defined responsibility. Prefer splitting along clear boundaries (domain, feature, or layer) over a single monolithic tree.
- **Clear package boundaries.** Each package exposes a deliberate public API; keep internals private. Depend on a package's published surface, not its internal files.
- **No circular dependencies between packages.** Dependencies flow in one direction. If two packages need each other, extract the shared piece into its own package.
- **New code belongs in the package that owns its concern.** Place logic where its responsibility lives; create a new package when a responsibility doesn't fit any existing one.

- **Build our own before installing.** Prefer building our own solution over pulling in an external package. Reach for a dependency only when building it ourselves is clearly impractical (e.g. cryptography, deep protocol/spec implementations) — and when you do, justify why.
- **Minimize the dependency footprint.** Fewer external packages means less surface to maintain, audit, and break. Before adding a dependency, confirm nothing in our own packages already covers it.

## Change strategy

When implementing a feature:

1. **Prefer extending existing patterns over adding custom one-off logic.**
2. **Reuse existing helpers** before creating new ones.
3. **Reuse existing components** before creating new ones.
4. **Follow patterns already used in similar features.**
5. **Make minimal changes** rather than large refactors.
6. **Preserve existing behavior** unless explicitly asked to change it.
7. **Update documentation** alongside code changes — relevant READMEs should reflect new behavior, exported APIs, and notable additions.

## Testing

**Commands** (fill in per project; `execute-prd` and the plans use these names):

- `pnpm test:e2e [spec…]` — builds, then runs the end-to-end suite (or only the given specs).
- `pnpm test:unit` — unit tests (vitest).
- `pnpm check` — typecheck + unit tests + build: the single gate (no lint in v1).

**Strategy: end-to-end first.**

- **Every feature is proven by end-to-end tests** that drive it the way a user does (Playwright by default for web — an accepted exception to "build our own before installing"). Backend-only work is tested at the HTTP/API level against the running app.
- **Unit tests only for small pure functions** (parsing, formatting, calculations) where many input cases matter. No unit tests that mock half the system to test wiring.
- **Every bug fix gets a regression test** that fails before the fix and passes after — end-to-end if the bug was user-visible.

**Coverage map — every e2e spec declares what it covers.** Each spec file starts with a `@covers` comment listing globs of the source it exercises: the feature's own code **plus the shared modules its flow goes through** (e.g. `// @covers src/features/swap/**, src/wallet/**`). Update it whenever the flow changes.

**Affected e2e tests always run.** Any change runs:

1. the e2e specs for the feature being built, **and**
2. every e2e spec whose `@covers` matches a changed file (`git diff --name-only <base>..HEAD`). Touching shared code — e.g. updating the wallet connection while building a feature that uses it — runs the wallet-connection specs and every other spec that covers it.
3. **The full e2e suite** when a changed file is covered by no spec, is cross-cutting (app shell, routing, auth, config, shared UI primitives, dependencies or lockfile), or when unsure.

**Reliable e2e tests:**

- Each test creates its own data and state; no test depends on another or on run order.
- Select elements by role, label or test id — never by CSS structure or text that changes.
- Wait on conditions, never fixed sleeps.
- Fake only third-party services, at the network boundary; our own code runs for real.
- A flaky test is a bug: fix it, never mask it with retries.
- UI changes are also checked in a real browser when browser tools are available.

## Style

- DRY: don't repeat logic; extract once it's used in more than one place with intent to reuse.
- Modularize as needed — split files and functions when responsibilities are mixing, not preemptively.
- No speculative abstractions — wait for the second or third use case before generalizing.
- No dead code, no commented-out code blocks left "just in case."
- No comments that restate what the code does; only comment the non-obvious _why_.
