import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type AppConfig, type DoctorCheck, type DoctorReport, type Result } from '@xc/shared';
import { resolveCli } from './llm/resolve-cli';
import { runCli, type CliOutput } from './llm/run-cli';

const CLI_TIMEOUT_MS = 5000;
const CACHE_MS = 60_000;
const ANSI = /\u001b\[[0-9;]*m/g;

type Run = (argv: string[]) => Promise<Result<CliOutput>>;

export interface DoctorDeps {
  home: string;
  config: AppConfig;
  run?: Run;
  resolve?: (name: string) => Result<string[]>;
  now?: () => number;
}

const defaultRun: Run = (argv) => runCli({ argv, stdin: '', timeoutMs: CLI_TIMEOUT_MS });

function check(id: string, label: string, status: DoctorCheck['status'], detail: string | null, fix: string | null): DoctorCheck {
  return { id, label, status, detail, fix };
}

function firstLine(text: string): string {
  return (text.replace(ANSI, '').split(/\r?\n/).find((l) => l.trim()) ?? '').trim().slice(0, 80);
}

function opencodeLoggedIn(out: Result<CliOutput>): boolean {
  if (!out.ok) return false;
  const text = out.value.stdout.replace(ANSI, '');
  return text.trim() !== '' && !/\b0 credentials\b/i.test(text);
}

function claudeLoggedIn(out: Result<CliOutput>): boolean {
  if (!out.ok) return false;
  try {
    return (JSON.parse(out.value.stdout) as { loggedIn?: unknown }).loggedIn !== false;
  } catch {
    return true;
  }
}

async function checkCli(
  deps: Required<Pick<DoctorDeps, 'run' | 'resolve'>>,
  name: string,
  authArgs: string[],
  loggedIn: (out: Result<CliOutput>) => boolean,
  loginFix: string,
  installFix: string,
): Promise<DoctorCheck> {
  const cli = deps.resolve(name);
  if (!cli.ok) return check(name, name, 'missing', null, installFix);
  const [version, auth] = await Promise.all([deps.run([...cli.value, '--version']), deps.run([...cli.value, ...authArgs])]);
  if (!version.ok) return check(name, name, 'problem', 'cannot run --version', installFix);
  const detail = firstLine(version.value.stdout);
  return loggedIn(auth) ? check(name, name, 'ok', detail, null) : check(name, name, 'not_logged_in', detail, loginFix);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile() && readFileSync(path, 'utf8').trim() !== '';
  } catch {
    return false;
  }
}

export function checkConfig(home: string, config: AppConfig): DoctorCheck[] {
  const contextPath = join(home, 'context.md');
  const repo = config.spacehoodRepoPath;
  return [
    isFile(contextPath)
      ? check('context', 'context.md', 'ok', null, null)
      : check('context', 'context.md', 'missing', null, `Create ${contextPath} describing what you build and want to reply to`),
    config.handle && config.handle !== 'YOUR_HANDLE'
      ? check('handle', 'handle', 'ok', null, null)
      : check('handle', 'handle', 'problem', 'still the placeholder', `Set "handle" in ${join(home, 'config.json')}`),
    repo && existsSync(repo) && statSync(repo).isDirectory()
      ? check('repo', 'spacehoodRepoPath', 'ok', null, null)
      : check('repo', 'spacehoodRepoPath', 'problem', repo ? 'not a directory' : 'not set', `Set "spacehoodRepoPath" in ${join(home, 'config.json')}`),
    config.models.triage
      ? check('model-triage', 'models.triage', 'ok', null, null)
      : check('model-triage', 'models.triage', 'problem', 'not set', 'Set "models.triage" (see `opencode models`)'),
    config.models.final
      ? check('model-final', 'models.final', 'ok', null, null)
      : check('model-final', 'models.final', 'problem', 'not set', 'Set "models.final" to a Claude model id'),
  ];
}

export function createDoctor(deps: DoctorDeps): () => Promise<DoctorReport> {
  const run = deps.run ?? defaultRun;
  const resolve = deps.resolve ?? ((name) => resolveCli(name));
  const now = deps.now ?? Date.now;
  let cached: { at: number; report: DoctorReport } | null = null;
  return async () => {
    if (cached && now() - cached.at < CACHE_MS) return cached.report;
    const cliChecks = await Promise.all([
      checkCli({ run, resolve }, 'opencode', ['auth', 'list'], opencodeLoggedIn, 'opencode auth login', 'pnpm add -g opencode-ai'),
      checkCli({ run, resolve }, 'claude', ['auth', 'status'], claudeLoggedIn, 'claude, then /login', 'Install Claude Code, see https://claude.com/claude-code'),
    ]);
    const report = { checks: [...cliChecks, ...checkConfig(deps.home, deps.config)] };
    cached = { at: now(), report };
    return report;
  };
}

