#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = dirname(AI_ROOT);
const COMMAND = "node .ai/_tools/build-index.mjs";

const ENTRY_TYPES = ["decision", "pattern", "constraint", "gotcha", "howto", "map"];
const STATUSES = ["active", "superseded"];
const ARRAY_FIELDS = ["tags", "paths", "related"];
const REQUIRED_FIELDS = ["id", "type", "summary", "tags", "paths", "related", "status", "updated"];
const KNOWN_FIELDS = [...REQUIRED_FIELDS, "superseded_by"];
const SUMMARY_MAX_CHARS = 160;
const BODY_MAX_LINES = 80;

const REGION_START = "<!-- entries:start -->";
const REGION_END = "<!-- entries:end -->";
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GLOB_WILDCARD = /[*?[{]/;

// ---------- scan ----------

// CRLF is normalized on read so a checkout with autocrlf never reports indexes as stale.
function readText(file) {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function toRepoPath(file) {
  return relative(REPO_ROOT, file).split("\\").join("/");
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function listDomainNames() {
  return readdirSync(AI_ROOT, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !/^[_.]/.test(item.name))
    .map((item) => item.name)
    .sort(compareStrings);
}

function isEntryFile(item) {
  return item.isFile() && item.name.endsWith(".md") && item.name !== "index.md";
}

function scanDomain(name) {
  const dir = join(AI_ROOT, name);
  const children = readdirSync(dir, { withFileTypes: true });
  const indexFile = join(dir, "index.md");
  const indexText = existsSync(indexFile) ? readText(indexFile) : null;
  return {
    name,
    indexFile,
    indexText,
    scope: indexText === null ? undefined : readDomainScope(indexText),
    nestedDirs: children.filter((item) => item.isDirectory()).map((item) => item.name),
    entries: children
      .filter(isEntryFile)
      .map((item) => loadEntry(name, join(dir, item.name)))
      .sort((a, b) => compareStrings(a.id, b.id)),
  };
}

function loadEntry(domainName, file) {
  const slug = file.slice(dirname(file).length + 1, -".md".length);
  const { block, body } = splitFrontmatter(readText(file));
  const { meta, errors } = block === null ? { meta: null, errors: [] } : parseFrontmatter(block);
  return {
    file,
    slug,
    id: `${domainName}/${slug}`,
    meta,
    parseErrors: errors,
    bodyLineCount: countBodyLines(body),
  };
}

// ---------- parse ----------

function splitFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) return { block: null, body: text };
  return { block: match[1], body: text.slice(match[0].length) };
}

function parseFrontmatter(block) {
  const meta = {};
  const errors = [];
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match) errors.push(`unparseable frontmatter line "${line}"`);
    else if (match[1] in meta) errors.push(`duplicate frontmatter field "${match[1]}"`);
    else meta[match[1]] = parseValue(match[2].trim());
  }
  return { meta, errors };
}

function parseValue(raw) {
  if (!raw.startsWith("[") || !raw.endsWith("]")) return raw;
  return raw
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readDomainScope(indexText) {
  const { block } = splitFrontmatter(indexText);
  if (block === null) return undefined;
  const { scope } = parseFrontmatter(block).meta;
  return typeof scope === "string" && scope ? scope : undefined;
}

function countBodyLines(body) {
  const trimmed = body.trim();
  return trimmed ? trimmed.split("\n").length : 0;
}

// ---------- lint ----------

function lintKnowledgeBase(domains) {
  const entryIds = new Set(domains.flatMap((domain) => domain.entries.map((entry) => entry.id)));
  return domains.flatMap((domain) => [
    ...lintDomain(domain).map((message) => ({ file: domainErrorFile(domain), message })),
    ...domain.entries.flatMap((entry) =>
      lintEntry(entry, entryIds).map((message) => ({ file: toRepoPath(entry.file), message })),
    ),
  ]);
}

function domainErrorFile(domain) {
  return toRepoPath(domain.indexText === null ? dirname(domain.indexFile) : domain.indexFile);
}

function lintDomain(domain) {
  const errors = [];
  if (!KEBAB_CASE.test(domain.name)) errors.push("domain folder name must be kebab-case");
  for (const nested of domain.nestedDirs) {
    errors.push(`nested folder "${nested}" not allowed; domains are one level deep`);
  }
  if (domain.indexText === null) return [...errors, "domain folder has no index.md"];
  if (!domain.scope) errors.push("index.md frontmatter must define a one-line `scope`");
  return [...errors, ...lintRegionMarkers(domain.indexText)];
}

function lintRegionMarkers(indexText) {
  const starts = indexText.split(REGION_START).length - 1;
  const ends = indexText.split(REGION_END).length - 1;
  if (starts !== 1 || ends !== 1) {
    return [`must contain exactly one "${REGION_START}" and one "${REGION_END}" marker`];
  }
  if (indexText.indexOf(REGION_START) > indexText.indexOf(REGION_END)) {
    return ["entries:start marker must come before entries:end"];
  }
  return [];
}

function lintEntry(entry, entryIds) {
  if (entry.meta === null) return ["missing frontmatter block (file must start with ---)"];
  return [
    ...entry.parseErrors,
    ...lintSlug(entry),
    ...lintFieldPresence(entry.meta),
    ...lintFieldValues(entry),
    ...lintSupersession(entry.meta),
    ...lintReferences(entry.meta, entryIds),
    ...lintPaths(entry.meta),
    ...lintBodyLength(entry),
  ];
}

function lintSlug(entry) {
  return KEBAB_CASE.test(entry.slug) ? [] : ["file name must be kebab-case"];
}

function lintFieldPresence(meta) {
  const missing = REQUIRED_FIELDS.filter((field) => meta[field] === undefined || meta[field] === "");
  const unknown = Object.keys(meta).filter((field) => !KNOWN_FIELDS.includes(field));
  const notArrays = ARRAY_FIELDS.filter((field) => typeof meta[field] === "string" && meta[field]);
  return [
    ...missing.map((field) => `missing required field "${field}"`),
    ...unknown.map((field) => `unknown field "${field}"`),
    ...notArrays.map((field) => `"${field}" must be an inline array, e.g. [a, b] or []`),
  ];
}

function lintFieldValues({ id, meta }) {
  const errors = [];
  if (meta.id && meta.id !== id) errors.push(`id "${meta.id}" must equal file path "${id}"`);
  if (meta.type && !ENTRY_TYPES.includes(meta.type)) {
    errors.push(`invalid type "${meta.type}" (expected ${ENTRY_TYPES.join(" | ")})`);
  }
  if (meta.status && !STATUSES.includes(meta.status)) {
    errors.push(`invalid status "${meta.status}" (expected ${STATUSES.join(" | ")})`);
  }
  if (typeof meta.summary === "string" && meta.summary.length > SUMMARY_MAX_CHARS) {
    errors.push(`summary is ${meta.summary.length} chars (max ${SUMMARY_MAX_CHARS})`);
  }
  if (meta.updated && !isIsoDate(meta.updated)) errors.push(`updated "${meta.updated}" must be YYYY-MM-DD`);
  return [...errors, ...lintTags(meta.tags)];
}

function isIsoDate(value) {
  return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

function lintTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag) => !KEBAB_CASE.test(tag)).map((tag) => `tag "${tag}" must be kebab-case`);
}

function lintSupersession(meta) {
  const hasTarget = meta.superseded_by !== undefined && meta.superseded_by !== "";
  if (meta.status === "superseded" && !hasTarget) return ["status is superseded but superseded_by is missing"];
  if (meta.status === "active" && hasTarget) return ["superseded_by is only allowed when status is superseded"];
  return [];
}

function lintReferences(meta, entryIds) {
  const related = Array.isArray(meta.related) ? meta.related : [];
  const errors = related
    .filter((id) => !entryIds.has(id))
    .map((id) => `related id "${id}" does not resolve to an entry`);
  if (typeof meta.superseded_by === "string" && meta.superseded_by && !entryIds.has(meta.superseded_by)) {
    errors.push(`superseded_by id "${meta.superseded_by}" does not resolve to an entry`);
  }
  return errors;
}

// A glob's wildcard may sit mid-segment (src/foo*.ts), so the checkable prefix ends at the last full segment.
function staticPrefix(glob) {
  const wildcardAt = glob.search(GLOB_WILDCARD);
  if (wildcardAt === -1) return glob;
  return glob.slice(0, glob.lastIndexOf("/", wildcardAt) + 1);
}

function lintPaths(meta) {
  const globs = Array.isArray(meta.paths) ? meta.paths : [];
  return globs
    .filter((glob) => !existsSync(join(REPO_ROOT, staticPrefix(glob))))
    .map((glob) => `dead path "${glob}": "${staticPrefix(glob)}" does not exist in the repo`);
}

function lintBodyLength(entry) {
  if (entry.bodyLineCount <= BODY_MAX_LINES) return [];
  return [`body is ${entry.bodyLineCount} lines (max ${BODY_MAX_LINES}); split into multiple entries`];
}

// ---------- render ----------

function renderRow(cells) {
  return `| ${cells.map((cell) => String(cell).replace(/\|/g, "\\|")).join(" | ")} |`;
}

function renderTable(headers, rows) {
  return [renderRow(headers), renderRow(headers.map(() => "---")), ...rows.map(renderRow)].join("\n");
}

function activeEntries(domain) {
  return domain.entries.filter((entry) => entry.meta.status === "active");
}

function renderEntryCells({ slug, meta }) {
  const paths = meta.paths.map((glob) => `\`${glob}\``).join(", ");
  return [`[${slug}](${slug}.md)`, meta.type, meta.summary, meta.tags.join(", "), paths];
}

function renderActiveSection(domain) {
  const active = activeEntries(domain);
  if (active.length === 0) return "_No active entries._";
  return renderTable(["Entry", "Type", "Summary", "Tags", "Paths"], active.map(renderEntryCells));
}

function renderSupersededSection(domain) {
  const superseded = domain.entries.filter((entry) => entry.meta.status === "superseded");
  if (superseded.length === 0) return [];
  const items = superseded.map(
    ({ slug, meta }) => `- [${slug}](${slug}.md) -> [${meta.superseded_by}](../${meta.superseded_by}.md)`,
  );
  return ["### Superseded", items.join("\n")];
}

function renderDomainRegion(domain) {
  const notice = `<!-- Generated by \`${COMMAND}\`. Do not edit between the markers. -->`;
  const sections = [notice, renderActiveSection(domain), ...renderSupersededSection(domain)];
  return `${REGION_START}\n${sections.join("\n\n")}\n${REGION_END}`;
}

function renderDomainIndex(domain) {
  const text = domain.indexText;
  const before = text.slice(0, text.indexOf(REGION_START));
  const after = text.slice(text.indexOf(REGION_END) + REGION_END.length);
  return before + renderDomainRegion(domain) + after;
}

function renderRootIndex(domains) {
  const rows = domains.map((domain) => [
    `[${domain.name}](${domain.name}/index.md)`,
    domain.scope,
    activeEntries(domain).length,
  ]);
  return [
    "# Knowledge Index",
    `<!-- Generated by \`${COMMAND}\`. Do not edit. Format spec: README.md -->`,
    "Read protocol: pick the domain(s) matching your task, open that domain's `index.md`, then open ONLY the entries whose summary, tags or paths match. Never bulk-read a domain folder.",
    domains.length ? renderTable(["Domain", "Scope", "Active entries"], rows) : "_No domains yet._",
  ].join("\n\n") + "\n";
}

// ---------- write ----------

function planIndexWrites(domains) {
  const rootFile = join(AI_ROOT, "index.md");
  const domainWrites = domains.map((domain) => ({
    file: domain.indexFile,
    current: domain.indexText,
    next: renderDomainIndex(domain),
  }));
  return [
    { file: rootFile, current: existsSync(rootFile) ? readText(rootFile) : null, next: renderRootIndex(domains) },
    ...domainWrites,
  ];
}

function reportErrors(errors) {
  const lines = errors.map(({ file, message }) => `${file}: ${message}`).sort(compareStrings);
  console.error(lines.join("\n"));
  console.error(`\n${lines.length} error(s).`);
  process.exitCode = 1;
}

function reportStaleIndexes(staleWrites) {
  reportErrors(staleWrites.map(({ file }) => ({ file: toRepoPath(file), message: `out of date; run \`${COMMAND}\`` })));
}

function writeIndexes(staleWrites) {
  for (const { file, next } of staleWrites) {
    writeFileSync(file, next, "utf8");
    console.log(`updated ${toRepoPath(file)}`);
  }
  if (staleWrites.length === 0) console.log("indexes already up to date");
}

function main(args) {
  const unknownArgs = args.filter((arg) => arg !== "--check");
  if (unknownArgs.length) {
    return reportErrors([{ file: "usage", message: `${COMMAND} [--check] (unknown: ${unknownArgs.join(" ")})` }]);
  }
  const domains = listDomainNames().map(scanDomain);
  const errors = lintKnowledgeBase(domains);
  // Indexes built from invalid entries can't be trusted, so lint errors block all writes.
  if (errors.length) return reportErrors(errors);

  const staleWrites = planIndexWrites(domains).filter(({ current, next }) => current !== next);
  if (!args.includes("--check")) return writeIndexes(staleWrites);
  if (staleWrites.length) return reportStaleIndexes(staleWrites);
  console.log("knowledge base OK");
}

main(process.argv.slice(2));
