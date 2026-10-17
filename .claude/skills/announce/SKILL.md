---
name: announce
description: Draft the announcement posts (Discord changelog, X post) for a finished plan. Triggers on "/announce", "announce this plan", "write the posts for <plan>", or as the optional last closeout step called by `execute-prd`.
---

# announce

Turns a finished plan into drafts for the audience. **Drafts only: never post
anything externally.** The user posts manually. Voice rules live in
`.claude/skills/announce/voice.md` (read by the post skills).

Output root: the announcements root set in `voice.md` `## Config`. If it is
still `TODO`, ask the user for the path before starting.

## Input

Plan path or slug. Default: the most recently completed plan (newest entry in
`plans/completed/`).

## Steps

1. **Gather facts via a subagent** (`model: haiku`, per project CLAUDE.md;
   read-only). Ask it to return only: plan title and goal, commit range
   (`<base>..<head>` from the plan/BOARD card SHAs, else `git log`), changed
   files grouped by area, related `.ai/` entries (read narrowly via
   `.ai/index.md` -> domain index), routes a user can visit, and whether
   anything is user-visible.
2. **Create the folder**
   `<announcements-root>\<YYYY-MM-DD>_<plan-slug>\`
   (date = today) and write `brief.md`, the single shared fact source. Gather
   once; all posts read it.

   ```
   ---
   plan: <slug>
   date: YYYY-MM-DD
   plan_path: plans/completed/...
   commits: <base>..<head>
   user_visible: yes|no
   pages: [routes a user can visit, e.g. /items/<id>]
   ---
   ## What shipped (plain language)
   ## Why it matters to users
   ## Technical notes (for Discord)
   ## Screens / URLs to show
   ## Don't say
   ```

   `## Don't say` lists claims to avoid and internal-only details: formulas
   and private infra (the list in `voice.md`), DB names. Derive facts from the
   plan and code; never invent numbers.
3. **Show the brief to the user** and wait for a quick OK or edits. No drafting before that.
4. **Run `post-discord` and `post-x`** with the folder path.
5. **Upsert the tracker row** in `<announcements-root>\tracker.csv`.
   Header: `date,plan,folder,user_visible,discord,x,discord_url,x_url,notes`.
   Statuses: `drafted|posted|skipped|-` (`-` = not made/not applicable). Key is
   `plan`: update the row if it exists, else append.
6. **Report concisely:** folder path and the drafts (or their paths).

## Marking posted

On "mark posted <plan> discord <url>" (or `x`): set that column to
`posted`, fill `discord_url` / `x_url`, leave other columns untouched.

## Rules

- `post-discord` / `post-x` also run standalone given a folder or plan; if `brief.md` is missing they run steps 1-3 first.
- Commit in the announcements repo only when the user asks.
- Calculation formulas and private infra never appear in any draft.
