---
id: architecture/server-as-native-host
type: decision
summary: Server is a Chrome native-messaging host started by the panel toggle; per-launch in-memory token on every route, loopback only, exits when Chrome closes stdin
tags: [native-messaging, token, auth, lifecycle, loopback, windows]
paths: [apps/server/src/main.ts, apps/server/src/env-file.ts, apps/server/src/native.ts, apps/server/src/auth.ts, apps/server/src/app.ts, apps/server/src/doctor.ts, scripts/setup-host.mjs, apps/extension/src/background/native-link.ts]
related: [security/llm-subprocess-sandbox, tooling/lean-v1-scaffold]
status: active
updated: 2026-10-17
---

# Server as native host

Startup (`main.ts`) first calls `loadRepoEnv` so `<repo root>/.env` (e.g. `GEMINI_API_KEY`) is in
`process.env` for the host launched via `run-host.bat`; see pipeline/triage-flow.

**Decision:** `server.mjs --native` is launched by Chrome (`connectNative`) when the user flips the
panel toggle. It binds 127.0.0.1 on an ephemeral port, makes `randomBytes(32)` as the token, and
sends both only in the framed `ready` message (4-byte LE length, JSON). Every HTTP route, health
included, needs `Authorization: Bearer <token>` (constant-time compare). When stdin ends (toggle
off, Chrome closed, SW died) the host closes HTTP and DB, kills CLI child trees, drops
`<home>/server.lock` and exits. Nothing but framed messages may reach stdout; logs go to
`<home>/logs/server.log`. The lock is created with `wx` and the pid written through that fd; an
empty/unparsable lock younger than 5s counts as held (a starter mid-write). On a host `error`
message the panel shows that message; the `pnpm setup:host` hint only appears on a silent disconnect.

**Why:** Nothing runs unless Chrome wants it (no always-on service, no autostart), the token never
touches disk or a page, and a stray local process or web page cannot read or poison captures.

**Rejected:** An always-on Windows service or startup task (runs unattended, needs a fixed
port/secret on disk); fixed token in storage; Host/Origin checks (deferred in v1).

**Constraints:** Host manifest `allowed_origins` holds only our extension id, derived from the
public `key` in `manifest.json` (private key discarded). `pnpm setup:host` registers HKCU via
`reg.exe` (shell:false) and must be rerun if the repo moves. The extension keeps token/port in
`storage.session` (not readable by content scripts) and `desiredOnline` in `storage.local`; without
a token the service worker drops captures. `--dev` refuses to start without `XC_DEV_TOKEN`.
