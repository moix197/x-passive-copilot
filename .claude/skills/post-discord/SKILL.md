---
name: post-discord
description: Write the Discord changelog post for a shipped plan from its announcement `brief.md`. Triggers on "/post-discord", "write the discord post", "discord changelog for <plan>", or as a step of `announce`.
---

# post-discord

Technical changelog for Discord. Read `.claude/skills/announce/voice.md` first
and follow it. Draft only; never post.

## Input

Announcement folder path (`<announcements-root>\<date>_<slug>\`, root from `voice.md`)
or a plan slug (resolve to its folder). If `brief.md` is missing, run the
`announce` skill's steps 1-3 first. Use only facts in `brief.md`; honor
`## Don't say`.

## Format

Discord markdown, **at most 2000 characters** per message.

```
## 🛰️ <Short title: what shipped>

**What's new**
- <user-visible change, plain language>

**Under the hood**
- <technical note from brief.md; no formulas, no private infra>

<full URL(s) to the pages, one per line>

-# <disclaimer line from voice.md>
```

- One emoji in the header at most; none in bullets.
- 3-6 "What's new" bullets, 2-4 "Under the hood" bullets. Drop "Under the hood" if the brief has nothing technical that is safe to share.
- Keep the disclaimer line only when the change touches data a reader could take as official, and only if `voice.md` defines one; otherwise omit it.

## Length

Count characters (e.g. `wc -m` on the file). If over 2000, split into numbered
parts `(1/2)`, `(2/2)`, each under 2000, at section boundaries; the title stays
on part 1, links on the last part.

## Output

Write `discord.md` in the announcement folder (parts separated by a `---` line,
each preceded by a `<!-- part N -->` marker). Report the path and character count.
