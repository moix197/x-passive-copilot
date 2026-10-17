// Fake `claude -p` CLI: answers each polish prompt with the next scripted reply.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPLIES = [
  'Shipping beats polishing. What did you cut to get it out the door?',
  'Small releases keep the feedback loop honest. Nice work on v2.',
];
// Breaks the reply guard (hype word + two hashtags), so every later version must come back needs_edit.
const GUARD_BREAKER = 'lfg #ship #now';

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
const calls = existsSync(counterFile) ? Number(readFileSync(counterFile, 'utf8')) : 0;
writeFileSync(counterFile, String(calls + 1));
writeFileSync(join(dir, 'claude-last-prompt.txt'), prompt);
const reply = REPLIES[calls] ?? GUARD_BREAKER;
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: { reply, rationale: 'fake' } }));
