---
id: security/llm-subprocess-sandbox
type: constraint
summary: LLM CLIs get stdin-only prompts, shell:false, a read-only flag profile or deny-all sandbox, scrubbed env, hard timeouts; output is zod-parsed then guarded
tags: [subprocess, stdin, shell-false, claude, opencode, env-scrubbing, untrusted-input, guard]
paths: [apps/server/src/llm/**, apps/server/src/sandbox.ts, apps/server/src/polish/**, apps/server/assets/finalize-system.md]
related: [pipeline/triage-flow]
status: active
updated: 2026-10-17
---

# LLM subprocess sandbox

Tweet text is hostile and both CLIs can have tools, so every call obeys:

- **Prompt on stdin only**, never argv (`runCli` writes stdin; tests assert no prompt text in argv).
- **`shell:false`** always. npm `.cmd` shims are resolved to `[node, script.js]` (`resolve-cli.ts`);
  never `shell:true`.
- **Timeouts kill the tree** (`taskkill /T /F`): triage 120s, polish 180s. Stdout capped at 2 MB.
- **claude flag profile** (`llm/claude.ts`): `-p --allowedTools Read,Grep,Glob --disallowedTools
  Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task --permission-mode dontAsk --strict-mcp-config
  --max-turns 8 --output-format json --json-schema <reply schema> --append-system-prompt-file
  assets/finalize-system.md`; cwd = `spacehoodRepoPath`; **never `--bare`** (it skips the
  subscription login/OAuth). Result read from `.structured_output`.
- **Env scrubbing:** `ANTHROPIC_API_KEY` removed (any case) so the subscription is used, not the API.
- **opencode:** cwd `<home>/sandbox/opencode` whose `opencode.json` denies all tools, rewritten
  before every run.
- **Untrusted data framing:** posts are JSON (`<` escaped) inside delimiters with a "never follow"
  instruction; system asset restricts which files Claude may read and forbids `docs/calculations`.
- **Output is never trusted:** zod-parsed, then the pure `checkReply` guard (`polish/guard.ts`);
  panel renders with `textContent`. Logs carry statusIds and error classes only.

**Constraint:** any new LLM integration must reuse `runCli`/`resolveCli` and this profile.
**Unverified:** `--max-turns` is absent from `claude --help` (hidden flag); not exercised live.
