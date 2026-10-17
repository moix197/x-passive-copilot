---
name: post-x
description: Write the X (Twitter) post for a shipped plan from its announcement `brief.md`. Triggers on "/post-x", "write the x post", "tweet this", "social post for <plan>", or as a step of `announce`.
---

# post-x

Short social post for X. Read `.claude/skills/announce/voice.md` first and
follow it. Draft only; never post.

## Input

Announcement folder path or plan slug (resolve to its folder). If `brief.md` is
missing, run the `announce` skill's steps 1-3 first. Use only facts in
`brief.md`; honor `## Don't say`.

## Main post

- Single post, **at most 280 characters**. Count it (e.g. `printf %s "$text" | wc -m`); every URL counts as 23 whatever its length.
- Line 1 is the hook: what a user can now see or do.
- One concrete benefit. No technical internals.
- One link to the page, last line.
- 0-1 hashtag, usually none. No hype words, no price predictions, nothing that reads as financial advice, no latency claims.
- Say "unofficial" only if the wording could read as official.

## Thread (optional)

Only when the feature is big (several distinct user-visible changes). 2-4 posts,
each ≤ 280, numbered `1/`, `2/`...; post 1 is the main post. Each later post
covers one change; the link goes on the last.

## Output

Write `x.md` in the announcement folder:

```
## Main
<post> (<N> chars)

## Alternative hook
<different first line, same body and link> (<N> chars)

## Thread (only if warranted)
1/ ...
```

Report the path, the main post and its count.
