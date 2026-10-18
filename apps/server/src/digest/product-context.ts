import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { AppConfig } from '@xc/shared';
import { resolveCli } from '../llm/resolve-cli';
import { runCli } from '../llm/run-cli';

export const MAX_CONTEXT_BYTES = 8 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
const BRIEF_COUNT = 5;
const BRIEF_BYTES = 1200;
const README_BYTES = 1000;
const TRACKER_NOTE_CHARS = 160;
const COMMIT_COUNT = 15;
const COMMIT_CHARS = 100;
const GIT_TIMEOUT_MS = 5000;
const DATED_FOLDER = /^(\d{4}-\d{2}-\d{2})[_-]/;
const STATUS_COLUMNS = ['discord', 'x', 'video'] as const;
const REPLACEMENT_TAIL = new RegExp('\\uFFFD+$');

export interface Brief {
  folder: string;
  date: string;
  status: string | null;
  text: string;
}

export interface RawProductContext {
  readme: string;
  briefs: Brief[];
  commits: string[];
}

/** Folders named `YYYY-MM-DD_<slug>`, newest first (same date: name descending). */
export function newestDatedFolders(names: string[], count: number): { folder: string; date: string }[] {
  return names
    .flatMap((folder) => {
      const date = DATED_FOLDER.exec(folder)?.[1];
      return date ? [{ folder, date }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.folder.localeCompare(a.folder))
    .slice(0, count);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  return [...cells, cell];
}

/** Minimal CSV: quoted cells with "" escapes and commas; quoted newlines are not supported. */
export function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(splitCsvLine);
}

function statusLine(record: Record<string, string>): string {
  const channels = STATUS_COLUMNS.map((c) => `${c}=${record[c]?.trim() || '-'}`).join(', ');
  const note = (record.notes ?? '').trim().slice(0, TRACKER_NOTE_CHARS);
  return note ? `${channels}; notes: ${note}` : channels;
}

/** tracker.csv rows keyed by their `folder` column -> "discord=posted, x=drafted, video=-; notes: ...". */
export function parseTrackerStatus(csv: string): Map<string, string> {
  const [header, ...rows] = parseCsv(csv);
  const columns = (header ?? []).map((h) => h.trim().toLowerCase());
  const statuses = new Map<string, string>();
  for (const row of rows) {
    const record = Object.fromEntries(columns.map((c, i) => [c, row[i] ?? '']));
    if (record.folder?.trim()) statuses.set(record.folder.trim(), statusLine(record));
  }
  return statuses;
}

/** Cuts to at most `maxBytes` of UTF-8 without splitting a character. */
export function clipBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString('utf8').replace(REPLACEMENT_TAIL, '');
}

/** Keeps sections in priority order until `budget` bytes are used; the last one is clipped to fit. */
export function fitBudget(sections: string[], budget: number): string[] {
  const kept: string[] = [];
  let left = budget;
  for (const section of sections) {
    const clipped = clipBytes(section, left);
    if (clipped) kept.push(clipped);
    left -= Buffer.byteLength(clipped, 'utf8');
    if (clipped !== section) break;
  }
  return kept;
}

/** `git log --format=%cs %s` stdout -> "YYYY-MM-DD subject" lines, capped. */
export function parseGitLog(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{4}-\d{2}-\d{2} /.test(line))
    .slice(0, COMMIT_COUNT)
    .map((line) => line.slice(0, COMMIT_CHARS));
}

// Gathered text is untrusted: no raw `<` or `"` may close our delimiters or attributes.
const escapeData = (text: string): string => text.replaceAll('<', '&lt;').replaceAll('"', '&quot;');

function renderBrief(b: Brief): string {
  const status = escapeData(b.status ?? 'not in tracker');
  const body = clipBytes(escapeData(b.text.trim()), BRIEF_BYTES);
  return `<announcement folder="${escapeData(b.folder)}" date="${b.date}" status="${status}">\n${body}\n</announcement>`;
}

/** Product context in priority order (README, briefs newest first, commits), within the byte budget. */
export function renderProductContext(raw: RawProductContext, budget = MAX_CONTEXT_BYTES): string {
  const readme = raw.readme.trim();
  const sections = [
    readme ? `<readme>\n${clipBytes(escapeData(readme), README_BYTES)}\n</readme>` : '',
    ...raw.briefs.map(renderBrief),
    raw.commits.length ? `<recent-commits>\n${escapeData(raw.commits.join('\n'))}\n</recent-commits>` : '',
  ].filter(Boolean);
  return fitBudget(sections.map((s) => `${s}\n`), budget).join('').trimEnd();
}

/** True when `target` is `root` itself or inside it (both already resolved). */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Reads `<root>/<name>` read-only; '' when missing, too big, not a file, or resolving outside root. */
export function readContainedFile(root: string, name: string, maxBytes = MAX_FILE_BYTES): string {
  try {
    const realRoot = realpathSync(root);
    const real = realpathSync(join(realRoot, name));
    if (!isInsideRoot(realRoot, real)) return '';
    const stat = statSync(real);
    if (!stat.isFile() || stat.size > maxBytes) return '';
    return readFileSync(real, 'utf8');
  } catch {
    return '';
  }
}

function listFolders(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

export function gatherBriefs(root: string): Brief[] {
  if (!root) return [];
  const statuses = parseTrackerStatus(readContainedFile(root, 'tracker.csv'));
  return newestDatedFolders(listFolders(root), BRIEF_COUNT)
    .map(({ folder, date }) => ({ folder, date, status: statuses.get(folder) ?? null, text: readContainedFile(root, join(folder, 'brief.md')) }))
    .filter((b) => b.text.trim() !== '');
}

// Never walk up into a parent repo and never take optional locks: the repo is read-only to us.
function gitEnv(repo: string): NodeJS.ProcessEnv {
  return { ...process.env, GIT_CEILING_DIRECTORIES: dirname(resolve(repo)), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
}

export async function gatherCommits(repo: string): Promise<string[]> {
  const git = resolveCli('git');
  if (!repo || !git.ok) return [];
  const argv = [...git.value, 'log', `-n${COMMIT_COUNT}`, '--no-merges', '--no-color', '--format=%cs %s'];
  const out = await runCli({ argv, stdin: '', cwd: repo, env: gitEnv(repo), timeoutMs: GIT_TIMEOUT_MS });
  return out.ok ? parseGitLog(out.value.stdout) : [];
}

/** Fresh product context for one digest run, read-only from the configured folders. */
export async function gatherProductContext(config: AppConfig): Promise<string> {
  const repo = config.spacehoodRepoPath;
  const raw: RawProductContext = {
    readme: repo ? readContainedFile(repo, 'README.md') : '',
    briefs: gatherBriefs(config.announcementsPath),
    commits: await gatherCommits(repo),
  };
  return renderProductContext(raw);
}
