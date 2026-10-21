// Fake `claude -p` CLI: answers each polish prompt with the next scripted reply.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const REPLIES = [
  'Shipping beats polishing — what did you cut to get it out the door?',
  'Small releases keep the feedback loop honest. Nice work on v2.',
];
// Breaks the reply guard (hype word + two hashtags), so every later version must come back needs_edit.
const GUARD_BREAKER = 'lfg #ship #now';
// A post containing this marker gets a product pitch, outside the scripted sequence.
const PITCH_PROBE = 'pitch-probe';
const PITCH = 'We built Spacehub to track exactly this, check it out.';

const dir = import.meta.dirname;
const counterFile = join(dir, 'claude-calls.txt');
const readStdin = async () => {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

if (!process.argv.includes('-p')) {
  process.stdout.write('{}');
  process.exit(0);
}
const prompt = await readStdin();
writeFileSync(join(dir, 'claude-last-cwd.txt'), process.cwd());
// Tests hold a polish (its steps stay observable) by creating claude-hold.txt next to this script.
while (existsSync(join(dir, 'claude-hold.txt'))) await sleep(50);
// claude-fail.txt = N: the next N calls report an error (without using up a scripted reply).
const failFile = join(dir, 'claude-fail.txt');
const failsLeft = existsSync(failFile) ? Number(readFileSync(failFile, 'utf8')) : 0;
if (failsLeft > 0) {
  writeFileSync(failFile, String(failsLeft - 1));
  process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'fake claude failure' }));
  process.exit(0);
}
if (prompt.includes(PITCH_PROBE)) {
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: { reply: PITCH, rationale: 'fake' } }));
  process.exit(0);
}
const calls = existsSync(counterFile) ? Number(readFileSync(counterFile, 'utf8')) : 0;
writeFileSync(counterFile, String(calls + 1));
writeFileSync(join(dir, 'claude-last-prompt.txt'), prompt);
writeFileSync(join(dir, 'claude-last-env.json'), JSON.stringify({ gemini: process.env.GEMINI_API_KEY ?? null, google: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null }));
const reply = REPLIES[calls] ?? GUARD_BREAKER;
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: { reply, rationale: 'fake' } }));
