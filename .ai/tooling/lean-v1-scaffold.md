---
id: tooling/lean-v1-scaffold
type: decision
summary: v1 is a lean pnpm workspace (server, extension, shared) run with tsx and bundled with esbuild; lint, check-deps and per-feature e2e are deliberately deferred
tags: [scaffold, v1, pnpm, esbuild, tsx]
paths: [scripts/build.mjs, shared/src/**, apps/**]
related: [tooling/testing-strategy]
status: active
updated: 2026-10-17
---

# Lean v1 scaffold

**Decision:** Three workspace members only: `apps/server` (node:http, run by tsx in dev, bundled to
`apps/server/dist/server.mjs` for the native host), `apps/extension` (esbuild bundles to `apps/extension/dist`),
`shared` (zod schemas, `Result`, `loadConfig`). Gate is `pnpm check` = typecheck + unit tests +
build. No lint.

**Why:** Personal-use v1 where working software, low token cost and short dev time beat
architectural and test rigor. The user chose this explicitly over CLAUDE.md defaults.

**Rejected:** Many `packages/*` with a dependency checker; biome/eslint; e2e-per-feature with
`@covers` maps and per-phase review; copying hermes core/config (cheaper to write small
equivalents).

**Deferred:** `check-deps` script, Host/Origin/DNS-rebinding checks, persistent job queue (in-memory
retry), claude-haiku fallback, idle-RSS measurement, exhaustive edge-case tests, Chromium-registry
native-host e2e, passivity e2e spec (grep + manual check instead), per-package READMEs, migration
rigor, Telegram, multi-user.

**Constraints it creates:** Kept regardless of leanness: passivity invariants, untrusted-tweet
containment, 127.0.0.1 bind + token, hard-rule guard. Revisit the deferred list before any
multi-user or public release.
