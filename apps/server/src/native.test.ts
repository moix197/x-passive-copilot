import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireLock, createFrameDecoder, encodeFrame, MAX_OUTBOUND_BYTES } from './native';

function decode(chunks: Buffer[], max?: number) {
  const messages: unknown[] = [];
  const errors: string[] = [];
  const decoder = createFrameDecoder((m) => messages.push(m), (e) => errors.push(e), max);
  for (const chunk of chunks) decoder.push(chunk);
  return { messages, errors };
}

describe('native framing', () => {
  it('encodes a 4-byte little-endian length header', () => {
    const frame = encodeFrame({ a: 1 });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(JSON.parse(frame.subarray(4).toString())).toEqual({ a: 1 });
  });

  it('decodes frames split at every byte and several frames in one chunk', () => {
    const frames = Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 })]);
    const bytes = [...frames].map((b) => Buffer.from([b]));
    expect(decode(bytes).messages).toEqual([{ n: 1 }, { n: 2 }]);
    expect(decode([frames]).messages).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('rejects oversize inbound frames and stops decoding', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(2000, 0);
    const out = decode([header, encodeFrame({ n: 1 })], 1000);
    expect(out.errors).toEqual(['oversize message']);
    expect(out.messages).toEqual([]);
  });

  it('rejects malformed JSON', () => {
    const body = Buffer.from('{nope');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    expect(decode([header, body]).errors).toEqual(['malformed message']);
  });

  it('refuses to encode a message over the 1 MB host-to-extension cap', () => {
    expect(() => encodeFrame({ pad: 'x'.repeat(MAX_OUTBOUND_BYTES) })).toThrow();
  });
});

describe('single-instance lock', () => {
  const dirs: string[] = [];
  const home = () => {
    const dir = mkdtempSync(join(tmpdir(), 'xc-lock-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('refuses a second instance while the holder is alive, releases cleanly', () => {
    const dir = home();
    const first = acquireLock(dir, 111, () => true);
    expect(first.ok).toBe(true);
    expect(acquireLock(dir, 222, () => true).ok).toBe(false);
    if (first.ok) first.value();
    expect(acquireLock(dir, 222, () => true).ok).toBe(true);
  });

  it('takes over a stale or garbage lock', () => {
    const dir = home();
    writeFileSync(join(dir, 'server.lock'), '999999');
    expect(acquireLock(dir, 222, () => false).ok).toBe(true);
    writeFileSync(join(dir, 'server.lock'), 'garbage');
    expect(acquireLock(dir, 333, () => true).ok).toBe(true);
  });
});
