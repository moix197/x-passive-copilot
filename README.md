# X passive copilot

Chrome side-panel copilot for x.com. It only reads posts you already loaded, sends them to a local
server, and helps you find posts worth replying to. You copy and post by hand.

## Prerequisites

- Windows, Node 22, pnpm
- Chrome (load the extension unpacked)

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | Bundles the extension into `apps/extension/dist` (esbuild) |
| `pnpm typecheck` | `tsc` over server, extension, shared |
| `pnpm test:unit` | vitest (passes with no tests) |
| `pnpm test:e2e [spec]` | Build, then Playwright |
| `pnpm setup:host [--unregister] [--dry-run]` | One-time: registers the native-messaging host (HKCU) for the panel on/off switch |
| `XC_DEV_TOKEN=<16+ chars> pnpm dev:server` | Dev server on `127.0.0.1:7457` (`--dev --port N --home DIR`); refuses to start without the token |
| `pnpm check` | typecheck + test:unit + build |

## First run

1. Install the CLIs: `pnpm add -g opencode-ai` then `opencode auth login`; install Claude Code and log in (`claude`, then `/login`).
2. `pnpm install`, then `pnpm build` (builds the extension and `apps/server/dist/server.mjs`).
3. Chrome -> `chrome://extensions` -> Developer mode -> Load unpacked -> `apps/extension/dist`.
4. `pnpm setup:host` (writes `<home>/native-host/*` and an HKCU registry key; undo with `--unregister`).
   The extension id is fixed by the `key` in the manifest. Rerun after moving the repo or changing Node.
5. Open the side panel (click the extension icon) and flip the switch: Chrome starts the server
   ("Online"). Switch off or close Chrome and the server process exits ("Offline - not capturing").
6. Manual check: while online, `curl 127.0.0.1:<port>/v1/posts` without a token returns 401; the
   Readiness card lists opencode / claude / config problems, each with a fix; after toggling off the
   node process is gone in Task Manager.

The token is random per launch, kept in memory, and handed only to the extension over native
messaging. Server logs go to `<home>/logs/server.log`. Without Chrome's host, run
`XC_DEV_TOKEN=<16+ chars> pnpm dev:server` and set the same token from the service worker console:
`chrome.storage.session.set({ token: '<token>' })`.

## Capture usage

With the switch on (or a dev server running), browse https://x.com normally: posts you scroll past are captured
and listed newest first in the side panel (polls every 3s while open). Each post is shown like on X:
avatar (the `src` X already rendered, kept only when it is on `pbs`/`abs.twimg.com`; otherwise an
initials circle), name, @handle, relative time (absolute on hover) linking to the post, text and
metrics. The panel is dark-only. Posts are stored in
`<home>/posts.db` (30-day prune). The extension targets `http://127.0.0.1:7457` by default; to use
another server set it from the service worker DevTools console:
`chrome.storage.local.set({ serverUrl: 'http://127.0.0.1:PORT' })`.

Config lives in `<home>/config.json` (default home `~/.x-passive-copilot`); missing file means defaults.

## v1 trade-offs

This is an internal, personal-use v1 that optimizes for speed and cost. It intentionally deviates
from CLAUDE.md:

- **Few packages:** `apps/server`, `apps/extension`, `shared/` (types + zod schemas + small
  helpers). No `packages/*` split, no dependency-direction checker.
- **Light tests:** unit tests for pure parsers/guard/prefilter/formatters; Playwright specs
  (`e2e/smoke.spec.ts`, `e2e/panel.spec.ts`) with `@covers` headers. The LLM CLIs are faked at the
  process boundary by `e2e/fakes/` (put first on PATH by `installFakeClis` in `e2e/harness.ts`). No lint.
- **No per-phase code review.** One review of the whole change at the end.
- **Deferred (not built in v1):** `check-deps` script, Host/Origin/DNS-rebinding checks, persistent
  job queue (simple in-memory retry instead), claude-haiku fallback chain, idle-RSS measurement,
  exhaustive edge-case tests, Chromium-registry native-host e2e (manual check instead), passivity
  e2e spec (replaced by grep check + manual live check), per-package READMEs, forward/backward
  migration rigor, Telegram, multi-user.
- **Kept:** passivity invariants, untrusted-tweet containment (stdin only, `shell:false`,
  zod-parsed output, `textContent` rendering), 127.0.0.1 bind + per-launch token, hard-rule guard.

## Triage: context.md, watchlist, config

Posts are prefiltered, then triaged against `<home>/context.md` (what you build and want to reply
to; first 8 KB are used) by an LLM through [opencode](https://opencode.ai). Setup:
`pnpm add -g opencode-ai`, `opencode auth login`, then in `<home>/config.json`:

```json
{
  "handle": "yourhandle",
  "watchlist": ["someauthor"],
  "models": { "triage": "opencode/<model-id>" },
  "triage": { "batchSize": 15, "maxAgeHours": 24, "mentionMaxAgeHours": 72, "minEngagement": 3 }
}
```

- `models.triage` is required (provider/model id as shown by `opencode models`); empty = triage off.
- Posts older than `maxAgeHours` or with likes+reposts+replies below `minEngagement` show
  "skipped: <reason>" in the All tab and are never sent to the LLM.
- Posts whose text mentions `@handle` and posts by `watchlist` authors are flagged
  (tagged `mention` / `watchlist`), even if scored low or low-engagement, unless too old: mentions
  older than `mentionMaxAgeHours` (72) and watchlist posts older than `maxAgeHours` are skipped and hidden from Flagged. Fresh ones show in Flagged as "triage pending"
  before triage runs (or when triage is off) and "triage error" if it failed.
- **Gemini free tier (recommended):** set `"triage": "google/gemini-3.8-flash"`, copy `.env.example` to
  `.env` in the repo root and set `GEMINI_API_KEY=` (free key at https://aistudio.google.com). The server
  loads `.env` at startup and hands the key only to opencode (as `GOOGLE_GENERATIVE_AI_API_KEY`); no
  `opencode auth login` needed. Restart the host after editing `.env`.
- **Quota fallbacks:** `"triageFallbacks": ["google/gemini-3.5-flash-lite", "google/gemini-3.8-flash"]`
  under `models` is tried in order when a model hits its free quota (each Gemini model has its own).
  Quota errors are never retried; an exhausted model is skipped until its reset (midnight Pacific for
  daily quotas, or the "retry in N s" the error gives) and that survives restarts. With every model
  exhausted, triage and digest pause until the earliest reset; posts stay untriaged and are picked up
  afterwards (age limits still apply). The readiness card shows "Gemini quota reached for X, using Y"
  or "paused until HH:MM", and the Digest tab says why the last refresh failed.
- Free `opencode/*-free` models need no `opencode auth login`; the readiness card shows opencode ok
  ("free models only, no auth") when `models.triage` is one of them.
- Failed batches log `triage batch <ids> failed: <class> (<reason>)`; the reason is CLI/provider
  error text (exit code, stderr, opencode error event), never the prompt.
- The **Flagged** tab lists reply-worthy posts with reason, rough draft and a Copy button, split by a toggle into **To reply** (default; unscored "triage pending" posts first, then score high to low, ties newest) and **Replied** (newest replied first), each with its count. Copying any draft (first draft or Claude version) or pressing **Mark replied** moves the post to Replied immediately; **Move back to To reply** undoes it. Replied posts ignore the Flagged age limits and are kept past the 30-day prune.
- A batch runs at 15 pending posts or 30s after the first pending one. Malformed model output marks
  those posts "triage error"; the server keeps running.
- opencode runs in `<home>/sandbox/opencode` with all tools denied (only `read` is offered, with
  every path denied, because opencode's free tier rejects requests without it); prompts go over
  stdin only. Verified against opencode 1.19.3 with `opencode/deepseek-v4.1-flash-free`.

## Polish / auto top picks / config

The **Polish** button on a flagged post asks `claude -p` (subscription login) for one final reply in
your voice. Claude runs read-only (`Read,Grep,Glob`) with cwd = `spacehoodRepoPath` and reads only
`.claude/skills/announce/voice.md` and `.ai/product/index.md` there. `ANTHROPIC_API_KEY` is removed
from its environment so it never bills the API. Double clicks run one job.

```json
{
  "spacehoodRepoPath": "H:/path/to/spacehood_dashboard",
  "models": { "triage": "opencode/<model-id>", "final": "<claude model id>" },
  "autoPolish": { "enabled": false, "threshold": 80, "dailyCap": 10 }
}
```

- Claude only runs when you click Polish/Regenerate. Auto-polish is off by default (`autoPolish.enabled: false`); when set to `true`, posts scoring >= `threshold` are polished automatically after each triage batch and marked
  **Top pick**, up to `dailyCap` per local day. Beyond that the row says "Daily cap reached"; manual
  Polish still works. `dailyCap: 0` also turns it off. The **First draft** has the same Copy / Edit / thumbs actions as the Claude version.
- A pure guard checks every reply: <= 280 chars (URL = 23), <= 1 hashtag, no hype words, price
  predictions or advice phrasing, no URL/@mention absent from the source post. A violation triggers
  one regeneration with the violations listed; still failing -> "Needs edit: <rules>". Rough drafts
  get a "draft warning" tag.
- `models.final` and `spacehoodRepoPath` are required; otherwise polish shows "Polish failed: config...".
- A flagged card has three labeled sections: the **original post**, the **First draft** (triage
  model: reason + rough draft) and the **Claude version** (polished).
- **Regenerate** on a Claude version asks for another option (the earlier ones are in the prompt as
  "already written") without discarding any: every version is guarded, stored in `draft_versions`
  and kept across reloads. **‹ 2/3 ›** flips between them; the shown version is the selected one
  (persisted) that Copy/Edit/feedback use. Max 10 versions per draft. A failed regenerate keeps the
  selected version and shows "Regenerate failed".

## Seeding your voice / digest

Set `handle` in `<home>/config.json` to your X handle (case-insensitive). The server marks posts by
that author as **own** when they are ingested: they are stored, never triaged, and never counted
for the digest.

1. **Seed:** open your own profile on x.com and scroll. Each captured post of yours is a voice
   sample. At `voice.minSamples` (default 5) the **Voice** tab shows a profile (tone, length,
   vocabulary, do/don't) generated by the triage model, and it regenerates every 10 new samples. A
   failed generation keeps the previous profile and retries after 10 minutes.
2. **Feedback:** on a finished reply (Flagged tab or a polished digest idea) **Copy**, **Edit** (Save
   runs the hard-rule guard; violations are rejected) and thumbs up make it a positive example;
   thumbs down makes an "avoid" example (3 most recent kept). Latest feedback per draft wins.
3. **Injection:** the profile plus up to 8 examples (feedback first, then your most engaged posts of
   20-280 chars) are added to the triage and Claude prompts as delimited, untrusted style data.
4. **Digest:** every `digest.everyNPosts` (default 50) new non-own posts the triage model writes 3-5
   trends (linked to captured posts only) and 3 post ideas. Ideas are build-in-public and
   educational (the LONG ecosystem, how `product.name` tracks things and why, lessons, decisions),
   never sales/CTA posts or feature ads; the idea Polish prompt carries the same rules. Each idea has
   **Copy** and a guarded **Polish** (same guard, no source post, so any URL or @mention is
   rejected). A failed refresh keeps the previous digest and shows a notice. The Digest tab also has a
   **Generate new ideas** button: runs a digest now from the latest captured non-own posts (needs >= 3),
   independent of the automatic counter. One run at a time (409), at least `digest.manualMinIntervalSec`
   (default 60) between manual runs (429, retry-after shown in the button tooltip and under it); a
   failure shows the reason inline and keeps the previous ideas.
5. **Product context** is gathered fresh on every digest run, read-only, and sent as untrusted data
   in a `<product-context>` block (8 KB total, in this priority order):
   - `README.md` of `spacehoodRepoPath` (first 1 KB);
   - from `announcementsPath`: `brief.md` of the 5 newest `YYYY-MM-DD_<slug>` folders, newest
     first (1.2 KB each), each tagged with its `tracker.csv` status (discord/x/video, notes) so the
     model knows what is already posted;
   - the last 15 commit subjects with dates (`git log`, 5s timeout; skipped if git or the repo is missing).
   Files must resolve inside their folder (symlink/`..` escapes refused) and be <= 256 KB; media and
   draft files are never read. Either path may be unset; the digest uses whatever exists.

```json
{
  "handle": "yourhandle",
  "voice": { "minSamples": 5 },
  "digest": { "everyNPosts": 50, "manualMinIntervalSec": 60 },
  "announcementsPath": "H:/path/to/spacehood-announcements",
  "product": { "name": "Spacehub" }
}
```

- **Style notes** (Voice tab): a textarea (max 2000 chars, Save button) for your own writing rules,
  e.g. "keep it short, lowercase ok". Stored in the server db and injected into the triage and
  polish prompts in a `<user-style-rules>` block.
- Model output never keeps the em dash (U+2014): prompts forbid it and `replaceDashes` rewrites it
  (and spaced/bare en dashes) to commas or hyphens in triage drafts, polished replies, versions and
  digest text, before the reply guard runs.
- Every post card has a **View on X ↗** link (new tab) next to the metrics; the time also links.

Routes (all need the bearer token): `GET /v1/voice`, `GET /v1/digest`, `POST /v1/digest/run` (200, 409 busy, 422 too few posts, 429 + `Retry-After`, 502 failed), `GET|POST /v1/style-notes {notes<=2000}`,
`POST /v1/drafts/:id/feedback {kind: copy|edit|up|down, text?<=1000}`, `POST /v1/ideas/:id/polish`,
`GET /v1/posts?view=flagged&feed=to_reply|replied` (returns `counts`), `POST /v1/posts/:id/replied {replied: boolean}`, `POST /v1/posts/:id/polish[?regenerate=1]` (409 at the version cap), `POST /v1/drafts/:id/select {versionId}`.
