import { spawn, type ChildProcess } from 'node:child_process';
import { err, ok, type Result } from '@xc/shared';

const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_CHARS = 64 * 1024;

export interface RunCliOptions {
  argv: string[];
  stdin: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface CliOutput {
  stdout: string;
  stderr: string;
}

const activeChildren = new Set<number>();

export function killAllChildren(): void {
  for (const pid of activeChildren) killTree(pid);
  activeChildren.clear();
}

export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { shell: false, windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already exited
    }
  }
}

function collectStreams(child: ChildProcess, onOverflow: () => void) {
  const out: Buffer[] = [];
  let size = 0;
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_STDOUT_BYTES) onOverflow();
    else out.push(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < MAX_STDERR_CHARS) stderr += chunk.toString('utf8');
  });
  return { read: (): CliOutput => ({ stdout: Buffer.concat(out).toString('utf8'), stderr }) };
}

export function runCli(opts: RunCliOptions): Promise<Result<CliOutput>> {
  return new Promise((resolve) => {
    const [cmd, ...args] = opts.argv;
    if (!cmd) return resolve(err('empty argv'));
    const child = spawn(cmd, args, {
      shell: false,
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (child.pid !== undefined) activeChildren.add(child.pid);
    let failure: string | null = null;
    const abort = (reason: string) => {
      failure ??= reason;
      killTree(child.pid);
    };
    const timer = setTimeout(() => abort('timeout'), opts.timeoutMs);
    const streams = collectStreams(child, () => abort('stdout cap exceeded'));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(err(`spawn failed: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (child.pid !== undefined) activeChildren.delete(child.pid);
      const output = streams.read();
      if (failure) return resolve(err(failure));
      resolve(code === 0 ? ok(output) : err(`exit ${code}: ${output.stderr.slice(0, 300)}`));
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(opts.stdin);
  });
}
