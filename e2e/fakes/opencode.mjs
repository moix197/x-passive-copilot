// Fake `opencode run --format json` CLI: triages every post in the prompt as reply-worthy.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const readStdin = async () => {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

if (process.argv[2] !== 'run') {
  process.exit(0);
}
const prompt = await readStdin();
writeFileSync(join(import.meta.dirname, 'opencode-last-env.json'), JSON.stringify({ gemini: process.env.GEMINI_API_KEY ?? null, google: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null }));
writeFileSync(join(import.meta.dirname, 'opencode-last-prompt.txt'), prompt);
const ids = [...new Set([...prompt.matchAll(/"statusId":"(\d+)"/g)].map((m) => m[1]))];
const items = ids.map((statusId) => ({
  statusId,
  relevant: true,
  replyWorthy: true,
  score: 90,
  reason: 'Fake triage: a builder sharing a release invites a reply.',
  roughDraft: 'Congrats on shipping! The hardest part — was it scope?',
}));
const events = [
  { type: 'step_start', part: {} },
  { type: 'text', part: { text: JSON.stringify(items) } },
  { type: 'step_finish', part: { reason: 'stop' } },
];
process.stdout.write(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
