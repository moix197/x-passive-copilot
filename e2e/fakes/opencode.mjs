// Fake `opencode run --format json` CLI: triages every post in the prompt as reply-worthy, or answers
// a digest prompt (recognised by its <product-context> block) with one trend and one idea.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const readStdin = async () => {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

const triageReply = (ids) =>
  ids.map((statusId) => ({
    statusId,
    relevant: true,
    replyWorthy: true,
    score: 90,
    reason: 'Fake triage: a builder sharing a release invites a reply.',
    roughDraft: 'Congrats on shipping! The hardest part — was it scope?',
  }));

const digestReply = (ids, call) => [
  { trends: [{ title: 'Fake trend', summary: 'Builders ship.', statusIds: ids.slice(0, 1) }], ideas: [{ text: `Fake idea ${call}`, feature: 'f' }] },
];

// Tests steer digest runs through files next to this script: digest-mode.txt = "fail" | "hold" (blocks until digest-release.txt exists).
const dir = import.meta.dirname;
const digestMode = () => (existsSync(join(dir, 'digest-mode.txt')) ? readFileSync(join(dir, 'digest-mode.txt'), 'utf8').trim() : '');
const nextDigestCall = () => {
  const file = join(dir, 'digest-calls.txt');
  const call = (existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0) + 1;
  writeFileSync(file, String(call));
  return call;
};

if (process.argv[2] !== 'run') {
  process.exit(0);
}
const prompt = await readStdin();
const isDigest = prompt.includes('<product-context>');
writeFileSync(join(import.meta.dirname, 'opencode-last-env.json'), JSON.stringify({ gemini: process.env.GEMINI_API_KEY ?? null, google: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null }));
writeFileSync(join(import.meta.dirname, isDigest ? 'opencode-digest-prompt.txt' : 'opencode-last-prompt.txt'), prompt);
let digestCall = 0;
if (isDigest) {
  digestCall = nextDigestCall();
  if (digestMode() === 'fail') {
    process.stderr.write('fake digest failure\n');
    process.exit(1);
  }
  while (digestMode() === 'hold' && !existsSync(join(dir, 'digest-release.txt'))) await sleep(50);
}
const ids = [...new Set([...prompt.matchAll(/"statusId":"(\d+)"/g)].map((m) => m[1]))];
const events = [
  { type: 'step_start', part: {} },
  { type: 'text', part: { text: JSON.stringify(isDigest ? digestReply(ids, digestCall) : triageReply(ids)) } },
  { type: 'step_finish', part: { reason: 'stop' } },
];
process.stdout.write(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
