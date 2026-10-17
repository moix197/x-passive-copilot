---
id: tooling/knowledge-base-layout
type: decision
summary: .ai/ is atomic one-question entries in domain folders with script-generated indexes; no monolithic docs, no type-keyed folders
tags: [knowledge-base, rag, agent-workflow]
paths: [.ai/**]
related: []
status: active
updated: 2026-09-20
---

# Knowledge base layout: atomic entries, domain folders, generated indexes

**Decision:** `.ai/` holds one file per retrievable chunk (`<domain>/<slug>.md`),
grouped in folders by work area (domain), with strict flat frontmatter. The root
index and each domain's entry table are generated from that frontmatter by
`.ai/_tools/build-index.mjs`; entry type lives in frontmatter, not in the path.

**Why:** Monolithic files (a single `architecture.md`, type-keyed `decisions/` and
`patterns/` folders) grew huge and forced whole-file reads to find one fact. With
one chunk per file an agent reads two small indexes and then only the matching
entries. The shape also maps 1:1 onto a future MCP/RAG server: summary + body
become the embedded text, frontmatter becomes metadata filters, so migration is
mechanical rather than a rewrite.

**Rejected:**
- Type-based folders (`decisions/`, `patterns/`): retrieval happens by what you
  are working on, not by document type.
- Hand-maintained index: drifts from the entries and stops being trusted.
- One big `architecture.md`: unbounded growth, no partial reads.

**Constraints it creates:**
- Entry body is capped at 80 lines; over the cap means split into more entries.
- Every entry carries the full frontmatter schema defined in `.ai/README.md`.
- Index content between the `entries:start` / `entries:end` markers, and the whole
  root `index.md`, is never hand-edited.
- `node .ai/_tools/build-index.mjs --check` must pass before work is considered done.
