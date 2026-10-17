import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { err, ok, type NativeHostMessage, type Result } from '@xc/shared';
import { log, setLogSink } from './log';

export const MAX_OUTBOUND_BYTES = 1024 * 1024;
export const MAX_INBOUND_BYTES = 1024 * 1024;
const HEADER_BYTES = 4;
const EXIT_GRACE_MS = 300;
const UNREADABLE_LOCK_GRACE_MS = 5_000;

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_OUTBOUND_BYTES) throw new Error('native message too large');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export interface FrameDecoder {
  push(chunk: Buffer): void;
}

export function createFrameDecoder(
  onMessage: (message: unknown) => void,
  onError: (reason: string) => void,
  maxBytes = MAX_INBOUND_BYTES,
): FrameDecoder {
  let buffer = Buffer.alloc(0);
  let failed = false;
  const fail = (reason: string) => {
    failed = true;
    buffer = Buffer.alloc(0);
    onError(reason);
  };
  return {
    push(chunk) {
      if (failed) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (!failed && buffer.length >= HEADER_BYTES) {
        const length = buffer.readUInt32LE(0);
        if (length > maxBytes) return fail('oversize message');
        if (buffer.length < HEADER_BYTES + length) return;
        const body = buffer.subarray(HEADER_BYTES, HEADER_BYTES + length).toString('utf8');
        buffer = buffer.subarray(HEADER_BYTES + length);
        try {
          onMessage(JSON.parse(body));
        } catch {
          return fail('malformed message');
        }
      }
    },
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLockPid(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writeLockExclusive(path: string, pid: number): void {
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, String(pid));
  } finally {
    closeSync(fd);
  }
}

// An empty/unparsable lock that is still fresh belongs to a starter between open and write.
function lockHeld(path: string, pid: number, alive: (pid: number) => boolean, now: number): boolean {
  const holder = readLockPid(path);
  if (holder !== null) return holder !== pid && alive(holder);
  try {
    return now - statSync(path).mtimeMs < UNREADABLE_LOCK_GRACE_MS;
  } catch {
    return false;
  }
}

export function acquireLock(
  home: string,
  pid = process.pid,
  alive = isAlive,
  now = Date.now(),
): Result<() => void> {
  mkdirSync(home, { recursive: true });
  const path = join(home, 'server.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeLockExclusive(path, pid);
      return ok(() => {
        if (readLockPid(path) === pid) unlinkSync(path);
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return err(`lock failed: ${(e as Error).message}`);
      if (lockHeld(path, pid, alive, now)) return err('another server instance is running');
      try {
        unlinkSync(path);
      } catch {
        // raced with another starter; the retry decides
      }
    }
  }
  return err('could not acquire server lock');
}

function useFileLogger(home: string): void {
  const dir = join(home, 'logs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'server.log');
  const write = (line: string) => {
    try {
      appendFileSync(file, `${line}\n`);
    } catch {
      // logging must never break the host or touch stdout
    }
  };
  setLogSink(write);
  const toLog = (...args: unknown[]) => write(args.map(String).join(' '));
  console.log = toLog;
  console.info = toLog;
  console.warn = toLog;
  console.error = toLog;
}

export interface NativeApp {
  port: number;
  close(): Promise<void>;
}

export interface NativeHostOptions {
  home: string;
  start: (token: string) => Promise<NativeApp>;
  createToken: () => string;
}

function send(message: NativeHostMessage): void {
  process.stdout.write(encodeFrame(message));
}

export async function runNativeHost({ home, start, createToken }: NativeHostOptions): Promise<void> {
  useFileLogger(home);
  const lock = acquireLock(home);
  if (!lock.ok) {
    send({ type: 'error', message: lock.error });
    setTimeout(() => process.exit(1), EXIT_GRACE_MS);
    return;
  }
  let app: NativeApp | null = null;
  let closing = false;
  const shutdown = async (code: number) => {
    if (closing) return;
    closing = true;
    log('shutting down');
    try {
      await app?.close();
    } catch (e) {
      log(`close failed: ${(e as Error).message}`);
    }
    lock.value();
    setTimeout(() => process.exit(code), EXIT_GRACE_MS);
  };
  const decoder = createFrameDecoder(
    () => undefined,
    (reason) => {
      log(`inbound rejected: ${reason}`);
      void shutdown(1);
    },
  );
  process.stdin.on('data', (chunk: Buffer) => decoder.push(chunk));
  process.stdin.on('end', () => void shutdown(0));
  process.stdin.on('close', () => void shutdown(0));
  process.stdin.on('error', () => void shutdown(1));
  try {
    const token = createToken();
    app = await start(token);
    send({ type: 'ready', port: app.port, token });
  } catch (e) {
    log(`start failed: ${(e as Error).message}`);
    send({ type: 'error', message: 'server failed to start, see server.log' });
    void shutdown(1);
  }
}
