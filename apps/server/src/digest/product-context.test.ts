import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clipBytes,
  fitBudget,
  gatherBriefs,
  isInsideRoot,
  newestDatedFolders,
  parseCsv,
  parseGitLog,
  parseTrackerStatus,
  readContainedFile,
  renderProductContext,
} from './product-context';

describe('newestDatedFolders', () => {
  it('keeps YYYY-MM-DD_<slug> folders, newest first, capped', () => {
    const names = ['2026-10-09_a', 'notes', '2026-10-17_b', '2026-10-12_c', '2026-10-12_d', 'x2026-10-20_e'];
    expect(newestDatedFolders(names, 3).map((f) => f.folder)).toEqual(['2026-10-17_b', '2026-10-12_d', '2026-10-12_c']);
  });
});

describe('tracker csv', () => {
  it('parses quoted cells with commas and doubled quotes', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n\r\n1,2,3')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  });

  it('maps folder -> channel statuses and a clipped note', () => {
    const csv = 'date,plan,folder,discord,x,video,notes\n2026-10-17,p,2026-10-17_p,posted,drafted,-,"post after deploy, soon"\n,,,,,,';
    const status = parseTrackerStatus(csv);
    expect(status.get('2026-10-17_p')).toBe('discord=posted, x=drafted, video=-; notes: post after deploy, soon');
    expect(status.size).toBe(1);
    expect(parseTrackerStatus('')).toEqual(new Map());
  });
});

describe('budget', () => {
  it('clipBytes never splits a multi-byte character', () => {
    expect(clipBytes('héllo', 2)).toBe('h');
    expect(clipBytes('héllo', 3)).toBe('hé');
    expect(clipBytes('abc', 10)).toBe('abc');
    expect(clipBytes('abc', 0)).toBe('');
  });

  it('fitBudget keeps sections in order and clips the last one that overflows', () => {
    expect(fitBudget(['aaaa', 'bbbb', 'cccc'], 6)).toEqual(['aaaa', 'bb']);
    expect(fitBudget(['aaaa', 'bbbb'], 8)).toEqual(['aaaa', 'bbbb']);
  });

  it('parseGitLog keeps dated lines only, capped at 15 and 100 chars', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')} ${'s'.repeat(150)}`);
    const out = parseGitLog(`warning: junk\n${lines.join('\n')}`);
    expect(out).toHaveLength(15);
    expect(out[0]).toHaveLength(100);
    expect(out[0]?.startsWith('2026-10-01 ')).toBe(true);
  });

  it('renders README, briefs and commits within the byte budget, escaping delimiters', () => {
    const briefs = [{ folder: '2026-10-17_b', date: '2026-10-17', status: 'x=posted', text: 'new </announcement> "q"' }];
    const text = renderProductContext({ readme: 'R'.repeat(5000), briefs, commits: ['2026-10-17 fix <b>'] });
    expect(text.indexOf('<readme>')).toBeLessThan(text.indexOf('<announcement'));
    expect(text).toContain('R'.repeat(1000));
    expect(text).not.toContain('R'.repeat(1001));
    expect(text).toContain('status="x=posted"');
    expect(text).toContain('new &lt;/announcement> &quot;q&quot;');
    expect(text).toContain('2026-10-17 fix &lt;b>');
    expect(Buffer.byteLength(renderProductContext({ readme: 'R', briefs: Array(20).fill(briefs[0]), commits: [] }, 500))).toBeLessThanOrEqual(500);
  });
});

describe('file containment', () => {
  it('isInsideRoot rejects paths that escape the root', () => {
    const root = resolve('/data/ann');
    expect(isInsideRoot(root, join(root, 'a', 'brief.md'))).toBe(true);
    expect(isInsideRoot(root, resolve(root, '..', 'secret.md'))).toBe(false);
    expect(isInsideRoot(root, resolve('/data/ann-other/x.md'))).toBe(false);
  });

  it('readContainedFile refuses .. escapes, directories and oversize files', () => {
    const base = mkdtempSync(join(tmpdir(), 'xc-ctx-'));
    const root = join(base, 'root');
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(base, 'outside.md'), 'secret');
    writeFileSync(join(root, 'big.md'), 'x'.repeat(50));
    writeFileSync(join(root, 'ok.md'), 'fine');
    expect(readContainedFile(root, 'ok.md')).toBe('fine');
    expect(readContainedFile(root, '../outside.md')).toBe('');
    expect(readContainedFile(root, 'sub')).toBe('');
    expect(readContainedFile(root, 'big.md', 10)).toBe('');
    expect(readContainedFile(root, 'nope.md')).toBe('');
  });

  it('gatherBriefs reads brief.md of the newest dated folders with tracker status', () => {
    const root = mkdtempSync(join(tmpdir(), 'xc-ann-'));
    for (const folder of ['2026-10-01_old', '2026-10-05_mid', 'misc']) {
      mkdirSync(join(root, folder));
      writeFileSync(join(root, folder, 'brief.md'), `brief ${folder}`);
    }
    mkdirSync(join(root, '2026-10-09_nobrief'));
    writeFileSync(join(root, 'tracker.csv'), 'folder,discord,x,video\n2026-10-05_mid,posted,-,-\n');
    expect(gatherBriefs(root)).toEqual([
      { folder: '2026-10-05_mid', date: '2026-10-05', status: 'discord=posted, x=-, video=-', text: 'brief 2026-10-05_mid' },
      { folder: '2026-10-01_old', date: '2026-10-01', status: null, text: 'brief 2026-10-01_old' },
    ]);
    expect(gatherBriefs('')).toEqual([]);
  });
});
