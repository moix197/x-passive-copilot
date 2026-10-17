---
id: tooling/testing-strategy
type: decision
summary: Features are proven end to end; unit tests only for small pure functions; every change runs the e2e specs whose @covers match its diff
tags: [testing, e2e, regression, agent-workflow]
paths: []
related: []
status: active
updated: 2026-10-16
---

# Testing strategy: end-to-end first, coverage-mapped regression

**Decision:** Every feature is proven by end-to-end tests that drive it the way
a user does. Unit tests are limited to small pure functions with many input
cases. Each e2e spec declares the source it exercises in a `@covers` header
(the feature's own code plus shared modules its flow goes through), and every
change runs its own specs plus every spec whose `@covers` matches a changed
file — the full suite when a change is cross-cutting or uncovered. Rules and
commands live in CLAUDE.md `## Testing`; `execute-prd` enforces them.

**Why:** Unit tests that mock collaborators kept passing while real flows
broke; they test wiring, not behavior. A user-level test fails exactly when a
user would. Shared code (e.g. a wallet connection used by many features) is
where regressions hide: editing it for one feature can break another, so the
tests of every feature that depends on it must run — `@covers` makes that
selection mechanical instead of a judgment call.

**Rejected:**
- Unit-heavy test pyramid: high count, low confidence, brittle to refactors.
- Running the full e2e suite on every unit: correct but too slow per unit; it
  runs once at Final Verification instead.
- A separate coverage-map file: drifts from the specs; the header lives with
  the test it describes.

**Constraints it creates:**
- Every new e2e spec starts with an accurate `@covers` line; changing a flow
  means updating it.
- Plans list e2e scenarios per success criterion and affected specs as
  `e2e-regression`; a missing scenario or un-run covering spec is a blocking
  review finding.
- Parallel plan cards never run e2e or builds concurrently in one worktree;
  one batch runner does it.

## Project setup

Add this project's specifics here (or as linked entries) once they exist:
e2e tool and config path, how test data is seeded and reset, how tests sign in,
which third-party services are faked and where.
