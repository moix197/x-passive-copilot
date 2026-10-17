# Plan: X passive copilot v1 (lean MVP: MV3 extension + local triage/reply server)

**Created:** 2026-10-16
**Branch:** `feat/x-passive-copilot`
**Status:** in-progress (started 2026-10-17)

## Context

The user browses x.com normally in their own Chrome and wants help finding posts worth replying to,
plus reply drafts in their own builder voice (thespacehub / spacehood_dashboard). Hard requirement:
**ban-risk minimization**. The extension only *reads* the DOM the user already loaded. The content
script never clicks, scrolls, posts, fetches, injects DOM, or talks to localhost.

```
x.com DOM --MutationObserver--> content script --sendMessage--> service worker
  --fetch 127.0.0.1 (+token once Phase 5)--> apps/server (node:sqlite)
  --> prefilter -> triage (opencode/DeepSeek, batches of 15) -> polish (claude -p) -> guard
  --> voice + digest --> HTTP JSON --> side panel (polls while visible) --> user copies and posts by hand
```

This is an **internal, personal-use v1** (Windows, Node 22, pnpm, English). Working software, low
token cost and short dev time beat architectural and test rigor. See "v1 trade-offs" below.

## v1 trade-offs (intentional overrides of CLAUDE.md)

The user decided v1 optimizes for speed and cost. This plan therefore deviates from CLAUDE.md:

- **Few packages:** `apps/server`, `apps/extension`, `shared/` (types + zod schemas + small
  helpers). No `packages/*` split, no dependency-direction checker.
- **Light tests:** unit tests for pure parsers/guard/prefilter; **one** Playwright smoke test (Phase 2).
  Not e2e-per-feature; no `@covers` maps; no e2e-regression runs per phase.
- **No per-phase code review.** One opus review of the whole change in Final Verification.
- **Deferred (not built in v1):** `check-deps` script, Host/Origin/DNS-rebinding checks, persistent
  job queue (simple in-memory retry instead), claude-haiku fallback chain, idle-RSS measurement,
  exhaustive edge-case tests, Chromium-registry native-host e2e (manual check instead), passivity
  e2e spec (replaced by grep check + manual live check), per-package READMEs, forward/backward
  migration rigor, Telegram, multi-user.
- **Kept:** passivity invariants, untrusted-tweet containment (stdin only, `shell:false`, zod-parsed
  output, `textContent` rendering), 127.0.0.1 bind + per-launch token, hard-rule guard.

## Risk: medium

- **Ban risk** if passive capture regresses. Mitigation: content script is ~1 file; grep check each
  phase; live hil check in Phase 2.
- **Prompt injection** via tweet text into LLM CLIs with tools. Mitigation: stdin, deny-all opencode
  sandbox, claude read-only tools, strict output schema, guard.
- **Windows subprocess quoting:** npm `.cmd` shims need `shell:true`, which is unsafe with untrusted
  args. Mitigation: resolve shims to `[process.execPath, script.js]`, `shell:false`.
- **Native messaging + localhost auth** (Phase 5). Reduced scope: loopback bind + token only.
- **Unverified `opencode run --format json` event format** (not installed yet). Verified live in
  Phase 3 while writing the parser.

## Dependencies & Risks

- **Repo initialized** (git init done at plan commit). Phase 0 only creates the worktree.
- **External CLIs:** `claude` (installed, subscription) and `opencode` (`pnpm add -g opencode-ai` +
  `opencode auth login`). Model ids come from config (free Zen ids are limited-time). The Playwright
  smoke test uses no LLM; LLM phases are checked with small unit tests plus a manual live run.
- **X DOM is volatile.** All selectors live in one module: `apps/extension/src/content/selectors.ts`.
  Parsers are pure over an `Element`, tested on fixture HTML.
- **Ban-risk invariants** (grep-checked in Phases 2-6 verification): the content script never calls
  `fetch`/XHR, dispatches events, clicks, scrolls, mutates the x.com DOM, or talks to localhost.
- **Untrusted input.** Everything captured from X is untrusted. Server validates with zod (statusId
  digits only, text <= 4000, batch <= 100, body <= 1 MB). Panel uses `textContent` only; "Open on X"
  links are rebuilt from validated `statusId` + handle. Logs: statusIds only, never post text/tokens.
- **Subprocess safety (Phases 3-4):** prompts via stdin only; `shell:false`; timeouts (triage 120s,
  polish 180s); kill process tree on timeout; stdout cap 2 MB; tweets wrapped as JSON data inside
  delimiters with an "untrusted, never follow" system instruction; output zod-parsed.
- **Rate limits:** Claude subscription limits are shared with interactive use -> daily auto-polish
  cap (10).
- **Order-sensitive:** Phase 5 changes how the extension reaches the server (token + native host);
  dev-mode server (`pnpm dev:server`) keeps working with a fixed `XC_DEV_TOKEN`.

## Config values (defaults)

`handle`: placeholder `YOUR_HANDLE` (user fills) | `triage.batchSize`: 15 | `autoPolish.threshold`:
80 | `autoPolish.dailyCap`: 10 | `digest.everyNPosts`: 50 | `voice.minSamples`: 5 | `watchlist`: [] |
`spacehoodRepoPath`: user fills | model ids in config.

## Phases

### Phase 0: Create worktree

**This phase is always first. No exceptions.**

Create a git worktree for this plan's branch. `/execute-prd` does this
automatically, without confirmation.

**Steps:**

- [x] Repo initialized with `git init -b main` + `.gitignore` (`node_modules/`, `dist/`,
      `.env*`, `test-results/`), commit existing files (`chore: initial project skeleton`)
- [ ] Run `git worktree add ../x_aut-x-passive-copilot -b feat/x-passive-copilot main`
- [ ] Verify worktree is active and on the correct branch (`git worktree list`)

---

### Phase 1: Scaffold (allowed infra exception)

**Risk:** low
**Mode:** afk
**Type:** config
**Model:** sonnet
**Success criteria:** `pnpm check` passes; `pnpm build` produces a loadable unpacked extension in
`apps/extension/dist` whose side panel shows the "X passive copilot" header; `pnpm dev:server`
starts and answers `GET /v1/health`.

Why this horizontal phase is allowed: zero user-facing feature surface; the single thin
infrastructure prerequisite for every slice.
**Commit message:** `chore: scaffold lean pnpm workspace (server, extension, shared)`

**File changes:**
| Action | File | What changes |
|---|---|---|
| create | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore` | Workspace `apps/*`, `shared`. Scripts: `build` (esbuild), `typecheck` (tsc), `test:unit` (vitest), `test:e2e` (build + playwright), `dev:server` (tsx), `check` = typecheck + test:unit + build. No biome/lint. |
| create | `scripts/build.mjs` | esbuild: extension entries (sw, content, panel) + static files to `apps/extension/dist/`. Server runs via tsx (no server bundle until Phase 5). |
| create | `shared/src/{types,config,index}.ts` | Types + zod schemas (`CapturedPost`, API shapes, `AppConfig` with the defaults above). Small equivalents written fresh (`Result` type, `loadConfig` from `<home>/config.json`) instead of copying hermes core/config: cheaper than adapting. |
| create | `apps/server/src/main.ts` | `node:http` server, 127.0.0.1, `--dev --port 7457 --home DIR`, `GET /v1/health`. |
| create | `apps/extension/{manifest.json,src/background/sw.ts,src/panel/{panel.html,panel.ts,panel.css}}` | MV3, `sidePanel`, open on action click; header only. |
| create | `vitest.config.ts`, `playwright.config.ts` | `workers: 1`, `retries: 0`. |
| create | `README.md` | Prerequisites, scripts, first run, **v1 trade-offs** section (copy from this plan, incl. the deferred list). |
| modify | `CLAUDE.md` | Fill the `## Testing` command names to match the scripts. |

Dependencies (justified): `typescript`, `@types/node`, `@types/chrome` (types); `tsx` (run server
TS, no build step); `esbuild` (extension bundles); `vitest` (path aliases/extensionless imports);
`@playwright/test` (accepted e2e tool); `zod` (boundary validation). Nothing else.

**Steps:**

- [x] Workspace, tsconfig, scripts, vitest/playwright config
- [x] `shared/` types + config loader; server health endpoint; extension shell; esbuild script
- [x] README with v1 trade-offs; fill CLAUDE.md test commands
- [x] `.ai/tooling/lean-v1-scaffold` entry (decision: why lean, what was deferred)

**Tests:**

No automated tests — justified because: pure scaffolding with no behavior. Phase 2 adds the smoke
test that exercises the scaffold end to end.

**Verification:**

- [x] `pnpm check` passes
- [x] `pnpm dev:server` then `curl 127.0.0.1:7457/v1/health` returns ok

**Phase checklist:**

- [x] Steps and Verification ticked in this file
- [x] Changes committed: `chore: scaffold lean pnpm workspace (server, extension, shared)`
- [x] Phase marked complete

---

### Phase 2: Passive capture -> server -> side panel list

**Risk:** medium
**Mode:** afk
**Type:** mixed
**Model:** sonnet
**Success criteria:** with `pnpm dev:server` running, opening an x.com-like timeline makes the
panel list the posts on screen (newest first: author, handle, text, time, reply/repost/like/view
counts, "Open on X" link), including posts the timeline adds later while scrolling. Posts survive a
server restart and re-sent ids never duplicate. Promoted posts are skipped. The content script
makes zero network requests and zero DOM changes.
**Commit message:** `feat: passively capture x.com posts into sqlite and list them in the side panel`

**File changes:**
| Action | File | What changes |
|---|---|---|
| create | `apps/extension/src/content/selectors.ts` | The ONLY place X selectors live. |
| create | `apps/extension/src/content/{parse-article,parse-metrics}.ts` | Pure over an `Element`: `parseArticle(el) -> CapturedPost \| null` (outer article's author/time so quotes don't leak; `quotedStatusId`; `isReply`; promoted -> null). `parseMetrics(label)`: "1.2K views" -> 1200, "1M", missing -> 0. |
| create | `apps/extension/src/content/capture.ts` | Thin entry: MutationObserver on the primary column (waits via `body` for SPA nav), in-memory seen-set, 1s debounce, <= 50 per batch -> `chrome.runtime.sendMessage`. No other APIs. |
| modify | `apps/extension/src/background/sw.ts`, `manifest.json` | SW validates with shared schema and `POST`s to the server (base URL/token from storage; dev default `127.0.0.1:7457`). Content script matches `https://x.com/*`, `document_idle`; `host_permissions` `http://127.0.0.1/*`. |
| create | `apps/server/src/{db,router,posts}.ts` | `node:sqlite` `DatabaseSync` (WAL), one `CREATE TABLE IF NOT EXISTS` init (no migration framework). Upsert by `status_id` (updates metrics only). `POST /v1/posts` -> `{accepted, duplicates}`; `GET /v1/posts?limit&before` (keyset). 1 MB cap -> 413; zod failure -> 400. No CORS headers. 30-day prune on startup. |
| create | `apps/extension/src/panel/posts-view.ts` | Rendered with `textContent`; polls every 3s only while visible; tags for reply/quote. |
| create | `e2e/fixtures/x-home.html`, `e2e/smoke.spec.ts` | Fixture timeline with plain/quote/reply/promoted posts and a `window.__append(n)` helper. |
| create | `apps/extension/src/content/*.test.ts` | Parser unit tests over fixture HTML (see Tests). |

**Steps:**

- [x] Selectors + parsers + capture entry (functions <= ~30 lines)
- [x] Server db + routes; SW relay; manifest
- [x] Panel list view
- [x] Fixture + unit tests + Playwright smoke test
- [x] `.ai/capture/passive-capture-invariants` entry (constraint: ban-risk rules, one selector module)
- [x] **Live hil check** (below)

**Tests:**

| Action | Kind | File | What it covers |
|---|---|---|---|
| create | unit | `apps/extension/src/content/parse-article.test.ts` | Fixture HTML (jsdom via vitest `environment`, or `happy-dom` only if needed): plain post, quote (outer author), reply tag, promoted -> null, missing metrics group, empty text |
| create | unit | `apps/extension/src/content/parse-metrics.test.ts` | Full label, K/M suffixes, commas, missing parts, garbage |
| create | e2e | `e2e/smoke.spec.ts` | Launch Chromium with the built extension, route `https://x.com/**` to the fixture, spawn a dev server on a temp home; open the page, call `__append(3)`; open the panel -> posts (incl. the appended ones) appear, promoted one absent; an `<img onerror>` text renders as literal text. Also asserts the page made no request to 127.0.0.1 (only the SW does). |

**Verification:**

- [x] `pnpm test:unit`, `pnpm test:e2e smoke`, `pnpm check` pass
- [x] grep: no `fetch(`, `XMLHttpRequest`, `.click(`, `scroll`, `dispatchEvent`, `appendChild`, `setAttribute`, `innerHTML` in `apps/extension/src/content/` (excluding tests)

**Live hil check (separate tiny step, `Mode: hil` for this step only):**

- [x] User: `pnpm build`, load unpacked in real Chrome, `pnpm dev:server`, browse home + a status page
      + own profile for ~2 min; spot-check 5 panel rows against the screen. If the live DOM
      differs, agent updates `selectors.ts` + fixture (sanitized `outerHTML` saved via DevTools) and
      re-runs unit + smoke.
      _Done 2026-10-17 via read-only DOM inspection of live x.com/home (agent, Claude in Chrome): promoted = no `<time>` (placementTracking wraps videos), metrics aria-label localized (EN+ES parser), quote = nested `div[role=link]` with User-Name+time. Reply-context heuristic and panel-vs-screen spot check still unverified live._

**Phase checklist:**

- [x] Steps and Verification ticked in this file
- [x] Changes committed: `feat: passively capture x.com posts into sqlite and list them in the side panel`
- [x] Phase marked complete

---

### Phase 3: Prefilter + DeepSeek triage -> flagged list

**Risk:** medium
**Mode:** afk
**Type:** backend
**Model:** sonnet
**Success criteria:** while browsing, captured posts are prefiltered and triaged in batches of 15
against `context.md`. The panel's "Flagged" tab lists reply-worthy posts sorted by score with
reason, rough draft and a Copy button. Posts mentioning/replying to `handle` and posts by
`watchlist` authors are always flagged (tagged), even if scored low. Old/low-engagement posts show
"skipped: <reason>" and are never sent to the LLM. Tweet text containing instructions never reaches
argv. Malformed model output marks those posts "triage error" and the server keeps running.
**Commit message:** `feat: opencode deepseek triage with prefilter and flagged tab`

**File changes:**
| Action | File | What changes |
|---|---|---|
| create | `apps/server/src/llm/{run-cli,resolve-cli}.ts` | `resolveCli`: PATH lookup; npm `.cmd` shim -> `[execPath, script.js]`. `runCli({argv, stdin, cwd, env, timeoutMs})`: `shell:false`, stdin write, 2 MB cap, timeout -> `taskkill /T /F /PID` (shell:false). Returns `Result`. Shared with Phase 4. |
| create | `apps/server/src/llm/opencode.ts` | `opencode run -m <model> --format json --dir <home>/sandbox/opencode`, prompt on stdin. Event parser written against a real sample recorded in this phase. Extracts JSON, zod-validates. |
| create | `apps/server/src/sandbox.ts` | Ensures `<home>/sandbox/opencode/opencode.json` denying all tools before every run. |
| create | `apps/server/src/triage/{prefilter,triage}.ts`, `prompts.ts` | `prefilter(post, rules, now) -> {action, reason?, mustFlag?}` (pure: age > 24h, engagement floor, mention/reply-to handle case-insensitive, watchlist). Batch prompt: rules + `context.md` (<= 8 KB) + posts as JSON in `<posts>` delimiters with an untrusted-content instruction. Output `[{statusId, relevant, replyWorthy, score, reason<=300, roughDraft<=280}]`; unknown ids dropped. |
| modify | `apps/server/src/{db,posts}.ts` | `triage` table (status_id PK, score, reason, rough_draft, skip_reason, must_flag, error, triaged_at). `GET /v1/posts?view=flagged`. After ingest: run a batch when >= 15 untriaged, or 30s after the first pending post; serial, in-memory flag; simple retry (3 attempts, exponential backoff, longer wait on rate-limit text). On restart, untriaged posts are simply picked up again. |
| create | `apps/extension/src/panel/flagged-view.ts` | All/Flagged tabs; score badge, reason, draft, Copy, tags, skipped reason. |
| create | `fixtures/opencode-run.jsonl` | Real recorded sample used by the parser unit test. |

**Steps:**

- [x] `run-cli` + `resolve-cli`; opencode adapter
- [ ] User (one-time, hil-lite): `pnpm add -g opencode-ai`, `opencode auth login`. Agent records a
      real `opencode run --format json` sample (prompt on stdin) and confirms the deny-all sandbox
      blocks a "list files / run a command" prompt. If opencode is unavailable, build the parser from
      the documented format and flag it unverified in the report.
- [x] Prefilter, triage service, prompts, trigger, DB, route
- [x] Panel Flagged tab
- [x] README "context.md / watchlist / config" section. `.ai/pipeline/triage-flow` entry (decision: stdin-only, deny-all sandbox)

**Tests:**

| Action | Kind | File | What it covers |
|---|---|---|---|
| create | unit | `apps/server/src/triage/prefilter.test.ts` | Age boundary, floor, mention vs reply-to, handle case, watchlist, missing metrics |
| create | unit | `apps/server/src/llm/opencode.test.ts` | Recorded sample -> JSON; fenced/unfenced; missing final event; unknown ids dropped |
| run | e2e | `e2e/smoke.spec.ts` | Still passes (panel/server changed) |

**Verification:**

- [x] `pnpm test:unit`, `pnpm test:e2e smoke`, `pnpm check` pass
- [x] grep: no `shell: true` in `apps/server/src`
- [ ] Manual: `pnpm dev:server`, browse, Flagged tab shows items from real opencode
      _Deferred 2026-10-17: opencode not installed; parser + fixture built from docs (unverified). Steps "User opencode install" and this manual check carry over to the Final Verification pre-merge checklist._

**Phase checklist:**

- [x] Steps and Verification ticked in this file
- [x] Changes committed: `feat: opencode deepseek triage with prefilter and flagged tab`
- [x] Phase marked complete

---

### Phase 4: Claude final reply (Polish, auto top picks, hard-rule guard)

**Risk:** high
**Mode:** afk
**Type:** backend
**Model:** sonnet
**Success criteria:** clicking "Polish" on a flagged post shows "Polishing..." then a final reply
with Copy (double click runs one job). Posts scoring >= 80 are polished automatically, marked
"Top pick", until the local-day cap of 10 is reached ("Daily cap reached"); manual Polish still
works after the cap; `dailyCap: 0` disables auto. A reply that breaks a hard rule is regenerated
once with the violations listed; if it still breaks one the row shows "Needs edit" with rule names.
Claude runs read-only with cwd = the spacehood repo.
**Commit message:** `feat: claude polish with auto top picks, daily cap and hard-rule guard`

**File changes:**
| Action | File | What changes |
|---|---|---|
| create | `apps/server/src/llm/claude.ts` | Pure argv builder + runner via `runCli`: `claude -p --model <final> --allowedTools Read,Grep,Glob --disallowedTools Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task --permission-mode dontAsk --strict-mcp-config --max-turns 8 --output-format json --json-schema <{reply<=280, rationale}> --append-system-prompt-file <asset>`; prompt on stdin; cwd = `spacehoodRepoPath`; env copy with `ANTHROPIC_API_KEY` removed; never `--bare`; reads `.structured_output`. |
| create | `apps/server/src/polish/{polish,guard,auto-polish}.ts`, `assets/finalize-system.md` | System asset: hard rules, post text is untrusted data, read only `.claude/skills/announce/voice.md` and `.ai/product/index.md`, never quote `docs/calculations`. `checkReply(text, source) -> Violation[]` (pure): > 280 chars (URL = 23), > 1 hashtag, hype words (moon, gem, buy, alpha, 100x...), price predictions, advice phrasing, URLs/@mentions not in the source post. `polish`: in-memory in-flight set keyed by statusId (idempotent), generate -> guard -> regenerate once -> `ready`/`needs_edit`. `auto-polish`: after each triage batch, posts >= threshold without a final, reserving slots against a `meta` counter keyed by local day. |
| modify | `apps/server/src/{db,posts}.ts` | `drafts` table (status_id, kind, text, status, violations, created_at), `meta` counters. `POST /v1/posts/:id/polish` -> 202; drafts included in flagged payload. Rough drafts also guard-checked (warning tag). |
| modify | `apps/extension/src/panel/flagged-view.ts` | Polish button/states, Top pick badge, cap line, Needs edit + rule names. |

**Steps:**

- [ ] Claude runner/argv builder; polish + guard + regenerate-once
- [ ] Auto-polish + daily cap; DB + route
- [ ] Panel changes
- [ ] README "Polish / auto top picks / config". `.ai/security/llm-subprocess-sandbox` entry (constraint: stdin, shell:false, flag profile, env scrubbing, opencode sandbox)

**Tests:**

| Action | Kind | File | What it covers |
|---|---|---|---|
| create | unit | `apps/server/src/polish/guard.test.ts` | Each rule positive/negative; 280 boundary with URL; hashtags 0/1/2; hype-word case/punctuation; foreign URL/@mention rejected, source ones allowed |
| create | unit | `apps/server/src/llm/claude.test.ts` | Argv: exact flags, denied tools present, no `--bare`, no prompt text in argv, `ANTHROPIC_API_KEY` removed from env |
| create | unit | `apps/server/src/polish/daily-cap.test.ts` | Local-day key, remaining never negative, cap 0 |
| run | e2e | `e2e/smoke.spec.ts` | Still passes |

**Verification:**

- [ ] `pnpm test:unit`, `pnpm test:e2e smoke`, `pnpm check` pass
- [ ] grep: no `shell: true`, no `--bare`
- [ ] Manual: polish one real flagged post; confirm reply <= 280 and read-only tools only

**Phase checklist:**

- [ ] Steps and Verification ticked in this file
- [ ] Changes committed: `feat: claude polish with auto top picks, daily cap and hard-rule guard`
- [ ] Phase marked complete

---

### Phase 5: On/off toggle via native messaging + doctor card

**Risk:** high
**Mode:** afk
**Type:** security
**Model:** sonnet
<!-- Chosen sonnet to keep cost low: scope is deliberately small (HKCU registration, stdio framing,
loopback bind + token). Final Verification (opus) reviews this phase's code with extra attention. -->
**Success criteria:** after a one-time `pnpm setup:host`, flipping the panel toggle on starts the
server (panel shows "Online"); toggling off or closing Chrome makes the server process exit
("Offline - not capturing"); while offline the service worker drops captures. The server binds
127.0.0.1 and rejects requests without the per-launch token. When online, a readiness card lists
`opencode` and `claude` (ok / missing / not logged in / version) plus config problems (missing
`context.md`, `handle` placeholder, spacehood repo path), each with its fix command.
**Commit message:** `feat: native-messaging on/off toggle, token auth and doctor card`

**File changes:**
| Action | File | What changes |
|---|---|---|
| create | `apps/server/src/native.ts` | `--native` mode: 4-byte LE length framing on stdin/stdout (partial-chunk safe), sends `{type:'ready', port, token}` / `{type:'error', message}`; stdin `end` -> close HTTP + DB, kill child process trees, exit. Single-instance lock file (`<home>/server.lock`, pid). Logger writes to `<home>/logs/server.log` only, never stdout. |
| modify | `apps/server/src/{main,router}.ts` | Token = `randomBytes(32)` per launch, memory only, delivered only in `ready`; constant-time bearer check on every route (`--dev` uses `XC_DEV_TOKEN`). Bind 127.0.0.1. Bundle server to `apps/server/dist/server.mjs` via esbuild for the host. |
| create | `scripts/setup-host.mjs` | `pnpm setup:host [--unregister]`: computes extension id from the manifest `key`, writes host manifest (`allowed_origins` = our id only) + `run-host.bat` (`node <abs>/server.mjs --native`), registers HKCU key via `reg.exe` with `shell:false`. Public key generated once with `node:crypto` (private key discarded). |
| create | `apps/server/src/doctor.ts` | `GET /v1/doctor` (cached 60s): `--version` + `opencode auth list` / `claude` login check (5s timeout each, via `runCli`), config/context/repo path checks. |
| create | `apps/extension/src/background/native-link.ts`, `panel/{power-toggle,doctor-card}.ts` | `connectNative`; `desiredOnline` in `storage.local`, token/port in `storage.session`; reconnect on SW start; status broadcast; Online/Offline/Error states. |
| modify | `apps/extension/manifest.json`, `sw.ts` | `key`, `nativeMessaging`; `Authorization` header from session storage. |

**Steps:**

- [ ] Native framing + lifecycle + lock + file logger
- [ ] Token auth + bundled server
- [ ] `setup-host` script + manifest key
- [ ] Extension native link, toggle, offline drop
- [ ] Doctor route + card
- [ ] README "first run" (install CLIs, build, load unpacked, `setup:host`, manual check). `.ai/architecture/server-as-native-host` entry (decision; rejected: always-on service)

**Tests:**

| Action | Kind | File | What it covers |
|---|---|---|---|
| create | unit | `apps/server/src/native.test.ts` | Framing encode/decode, split chunks, oversize rejected |
| create | unit | `apps/server/src/auth.test.ts` | Missing/malformed/wrong-length/wrong token, correct token |
| run | e2e | `e2e/smoke.spec.ts` | Updated to start the dev server with `XC_DEV_TOKEN`; must still pass |

The real native-host toggle flow is a **manual check** (branded Chrome ignores `--load-extension`;
Chromium-registry e2e is deferred): see Verification.

**Verification:**

- [ ] `pnpm test:unit`, `pnpm test:e2e smoke`, `pnpm check` pass
- [ ] grep: no `shell: true`; no `console.log` / `process.stdout.write` in `apps/server/src` outside `native.ts`
- [ ] Manual (user, real Chrome): `pnpm setup:host`; toggle on -> Online and posts flow; toggle off ->
      process gone in Task Manager; close Chrome -> process gone; `curl 127.0.0.1:<port>/v1/posts`
      without token -> 401; doctor card shows correct states

**Phase checklist:**

- [ ] Steps and Verification ticked in this file
- [ ] Changes committed: `feat: native-messaging on/off toggle, token auth and doctor card`
- [ ] Phase marked complete

---

### Phase 6: Voice profile, feedback examples and rolling digest

**Risk:** low
**Mode:** afk
**Type:** backend
**Model:** sonnet
**Success criteria:** posts by `handle` seen on the user's profile are stored as voice samples (own
detection done server-side, never triaged). After >= 5 samples the "Voice" tab shows a DeepSeek-
generated profile (tone, length, vocabulary, do/don't) and sample count; triage drafts and Claude
finals use it plus up to 8 own-post examples. Copying, editing, or 👍 a draft makes it a positive
example; 👎 makes an "avoid" example (<= 3); the next generated reply includes them. Every 50 new
non-own posts a "Digest" section refreshes with 3-5 trends (links to captured posts only) and 3
post ideas, each with Copy and a guarded Polish; a failed digest keeps the previous one.
**Commit message:** `feat: voice profile, draft feedback and rolling digest`

**File changes:**
| Action | File | What changes |
|---|---|---|
| modify | `apps/server/src/{db,posts}.ts` | `is_own` set on ingest (author == handle, case-insensitive); own posts skipped by prefilter; `voice` (single row), `examples` (draft_id UNIQUE, text, polarity; latest wins), `digests` tables. |
| create | `apps/server/src/voice/{voice,select-examples,feedback}.ts` | Voice job via the opencode triage port, regenerated every 10 new own samples. `selectExamples` (pure): most-engaged own posts <= 8, 20-280 chars, merged with positive examples and <= 3 negatives. `POST /v1/drafts/:id/feedback {kind, text?<=1000}`; edited text is guard-checked. Injected into triage/polish prompts as delimited data. |
| create | `apps/server/src/digest/digest.ts`, `assets/spacehood-features.md` | Every `everyNPosts` (50) new non-own posts: recent posts (<= 60, 280 chars each) -> `{trends[{title,summary,statusIds}], ideas[{text,feature}]}`; unknown statusIds dropped; failure keeps previous + flag. `POST /v1/ideas/:id/polish` reuses polish with an empty source. |
| create | `apps/extension/src/panel/{voice-tab,digest-section,draft-actions}.ts` | `draft-actions` is callbacks-only (edit, copy, 👍/👎). |

**Steps:**

- [ ] Own detection, voice job, example selection, feedback route
- [ ] Digest job + route; idea polish
- [ ] Panel tabs/components
- [ ] README "seeding your voice / digest". `.ai/pipeline/voice-and-digest` entry (decision)

**Tests:**

| Action | Kind | File | What it covers |
|---|---|---|---|
| create | unit | `apps/server/src/voice/select-examples.test.ts` | Engagement order, max 8, length filter, dedupe, positive/negative merge, negatives <= 3 |
| create | unit | `apps/server/src/digest/digest.test.ts` | Bucket trigger (fires every 50, idempotent), unknown statusIds dropped |
| run | e2e | `e2e/smoke.spec.ts` | Still passes |

**Verification:**

- [ ] `pnpm test:unit`, `pnpm test:e2e smoke`, `pnpm check` pass
- [ ] Manual: visit own profile -> samples counted, profile appears at 5; copy/rate a draft -> shows in Voice tab; digest refreshes after 50 posts

**Phase checklist:**

- [ ] Steps and Verification ticked in this file
- [ ] Changes committed: `feat: voice profile, draft feedback and rolling digest`
- [ ] Phase marked complete

---

### Phase 7: Final Verification

**This phase runs after all other phases are complete.**
**Mode:** afk
**Model:** opus

**Overall success criteria:**

- The user toggles the copilot on, browses x.com normally, and sees captured posts, flagged posts
  (mentions/watchlist always included), Claude-polished guarded replies (auto top picks within the
  daily cap, or on click), a voice profile with feedback examples, and a rolling digest.
- The content script never clicks, scrolls, posts, fetches, injects DOM, or calls localhost.
- The server binds 127.0.0.1, requires the per-launch token, exits on toggle-off/Chrome close.
- LLM CLIs never receive tweet text via argv; no shell; opencode in deny-all sandbox; claude
  read-only, no `--bare`, no API key.

**Steps:**

- [ ] Every preceding phase's Steps/Verification checkboxes are ticked in the plan file
- [ ] `pnpm check` and `pnpm test:e2e` pass
- [ ] Security grep sweep: `shell: true`, `innerHTML`, `--bare`, `fetch(` in content script, token/post text in log calls: all absent
- [ ] **Single** code review of the whole change (opus), green with zero blocking findings; focus on passivity, subprocess safety, native host + token, guard. Nits may be deferred to a follow-up list.
- [ ] Findings fixed and reflected back into this plan file
- [ ] `.ai/` synced; `node .ai/_tools/build-index.mjs --check` passes
- [ ] Pre-merge user checklist: `pnpm setup:host` on real Chrome; toggle on/off confirms process exit; polish one real post
- [ ] Orchestrator (user) explicitly approved the merge

## Documentation

| Change | Documentation location |
| --- | --- |
| Scripts, first run, config.json / context.md / watchlist, v1 trade-offs, native host setup, polish/voice/digest usage | `README.md` |
| Test commands | `CLAUDE.md` `## Testing` |

Per-package READMEs are deferred (few packages; README sections instead).

## Knowledge Base Impact

| Entry id (`<domain>/<slug>`) | Action | Type | What it captures |
| --- | --- | --- | --- |
| `tooling/lean-v1-scaffold` | add | decision | Lean workspace (server, extension, shared), tsx + esbuild; deferred list. Rejected: many packages, check-deps, e2e-per-feature for v1 |
| `capture/passive-capture-invariants` | add | constraint | Content-script ban-risk rules; single selector module; handle never sent to page |
| `pipeline/triage-flow` | add | decision | prefilter -> opencode triage; stdin-only, deny-all sandbox, in-memory retry |
| `security/llm-subprocess-sandbox` | add | constraint | Stdin prompts, `shell:false` + shim resolution, claude flag profile, env scrubbing, timeouts |
| `architecture/server-as-native-host` | add | decision | Server is the native host; per-launch token; loopback only. Rejected: always-on service |
| `pipeline/voice-and-digest` | add | decision | Voice from own posts + feedback; rolling digest every 50 posts |

## Tests

| Phase | Kind | Behavior / scenario | Test file |
| --- | --- | --- | --- |
| 1 | none | Pure scaffolding, justified above | n/a |
| 2 | unit | Article parsing on fixture HTML; metrics labels | `apps/extension/src/content/parse-article.test.ts`, `parse-metrics.test.ts` |
| 2 | e2e | Extension on fixture page -> posts appear in panel; no page->localhost | `e2e/smoke.spec.ts` |
| 3 | unit | Prefilter rules; opencode event parsing | `apps/server/src/triage/prefilter.test.ts`, `apps/server/src/llm/opencode.test.ts` |
| 3 | e2e | Smoke still green | `e2e/smoke.spec.ts` |
| 4 | unit | Guard rules; claude argv/env; daily cap | `apps/server/src/polish/guard.test.ts`, `apps/server/src/llm/claude.test.ts`, `apps/server/src/polish/daily-cap.test.ts` |
| 5 | unit | Native framing; token auth | `apps/server/src/native.test.ts`, `apps/server/src/auth.test.ts` |
| 5 | manual | Real-Chrome toggle flow, token 401 | Verification list |
| 6 | unit | Example selection; digest trigger | `apps/server/src/voice/select-examples.test.ts`, `apps/server/src/digest/digest.test.ts` |
| 7 | e2e | Full (smoke) suite + whole-change review | all |

## Human Summary

- **What:** a Chrome side-panel copilot for X that only reads posts you've already scrolled past,
  sends them to a small local server, ranks them with DeepSeek (via opencode), and writes final
  replies with your Claude subscription in your voice. You copy and post by hand.
- **Phases:** scaffold (1) -> capture and list posts (2, with a live check on real x.com) -> triage
  with prefilter and flagged tab (3) -> Claude polish with auto top picks and a hard-rule guard (4)
  -> panel on/off switch via native messaging, token auth and a doctor card (5) -> voice, feedback
  and digest (6) -> one whole-change review (7).
- **End result:** toggle on, browse, glance at the panel for ranked posts and ready-to-copy replies
  that follow spacehood's rules (no hype, no price talk, <= 280 chars).
- **Trade-offs:** lean v1 for personal use. Fewer packages, one smoke e2e, no per-phase review, no
  persistent job queue, no haiku fallback, no Host/Origin checks, native host verified by hand.
  Passivity and untrusted-text containment are kept in full.
