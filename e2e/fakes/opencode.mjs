// Fake `opencode run --format json` CLI: triages every post in the prompt as reply-worthy (unless marked), or answers
// a digest prompt (recognised by its <product-context> block) with one trend and one idea.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const readStdin = async () => {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

// A post whose text carries "[score:NN]" gets that triage score; the rest get 90.
const scoreOf = (prompt, id) => Number(prompt.match(new RegExp(`"statusId":"${id}"[^}]*?\\[score:(\\d+)\\]`))?.[1] ?? 90);

// The prompt's JSON for one post, up to the next post (its note comes after the nested metrics object).
const postSegment = (prompt, id) => {
  const start = prompt.indexOf(`"statusId":"${id}"`);
  const next = prompt.indexOf('"statusId":', start + 1);
  return prompt.slice(start, next < 0 ? undefined : next);
};

// "[unworthy]" in a post's text: not reply-worthy and no draft, unless the owner flagged it (note "manual");
// "[draft-anyway]": not reply-worthy, yet the model still wrote a draft.
const verdictOf = (segment) => {
  const manual = segment.includes('"note":"manual"');
  const unworthy = !manual && (segment.includes('[unworthy]') || segment.includes('[draft-anyway]'));
  return { worthy: !unworthy, drafted: !unworthy || segment.includes('[draft-anyway]') };
};

const triageReply = (ids, prompt) =>
  ids.map((statusId) => {
    const { worthy, drafted } = verdictOf(postSegment(prompt, statusId));
    return {
      statusId,
      relevant: worthy,
      replyWorthy: worthy,
      score: scoreOf(prompt, statusId),
      reason: 'Fake triage: a builder sharing a release invites a reply.',
      roughDraft: drafted ? 'Congrats on shipping! The hardest part — was it scope?' : '',
    };
  });

// Tests steer digest runs through files next to this script: digest-mode.txt = "fail" | "hold" (blocks until digest-release.txt exists).
const dir = import.meta.dirname;

// The idea kinds the prompt plans, and the source posts it offers (best first).
const plannedKinds = (prompt) => JSON.parse(prompt.match(/these kinds, in this order: (\[[^\]]*\])/)?.[1] ?? '["spacehub"]');
const sourceIds = (prompt) => {
  const block = prompt.match(/<source-posts>\n([^]*?)\n<\/source-posts>/)?.[1] ?? '';
  return [...block.matchAll(/"statusId":"(\d+)"/g)].map((m) => m[1]);
};

// One idea of the first planned kind, citing the best source post; digest-ideas.json (an ideas array,
// "{call}" in a text replaced by the call number) overrides it, e.g. to answer with more ideas than allowed.
const fakeIdeas = (prompt, call) => {
  const file = join(dir, 'digest-ideas.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8').replaceAll('{call}', String(call)));
  const kind = plannedKinds(prompt)[0];
  const cites = kind === 'quote' || kind === 'inspired';
  return [{ kind, text: `Fake idea ${call}`, feature: 'f', sourceIds: cites ? sourceIds(prompt).slice(0, 1) : [] }];
};

const digestReply = (ids, call, prompt) => [
  { trends: [{ title: 'Fake trend', summary: 'Builders ship.', statusIds: ids.slice(0, 1) }], ideas: fakeIdeas(prompt, call) },
];
const digestMode = () => (existsSync(join(dir, 'digest-mode.txt')) ? readFileSync(join(dir, 'digest-mode.txt'), 'utf8').trim() : '');
const nextDigestCall = () => {
  const file = join(dir, 'digest-calls.txt');
  const call = (existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0) + 1;
  writeFileSync(file, String(call));
  return call;
};

// Tests make models answer with a provider quota error by listing them in quota-models.txt (one per
// line); quota-message.txt overrides the error text. Every run appends "<model> <triage|digest>" to
// opencode-calls.txt.
const readLines = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8').split(/\r?\n/).filter(Boolean) : []);
const QUOTA_TEXT = 'You exceeded your current quota, please check your plan and billing details.';

if (process.argv[2] !== 'run') {
  process.exit(0);
}
const model = process.argv[process.argv.indexOf('-m') + 1];
const prompt = await readStdin();
const isDigest = prompt.includes('<product-context>');
appendFileSync(join(dir, 'opencode-calls.txt'), `${model} ${isDigest ? 'digest' : 'triage'}\n`);
if (readLines('quota-models.txt').includes(model)) {
  const message = readLines('quota-message.txt')[0] ?? QUOTA_TEXT;
  process.stdout.write(JSON.stringify({ type: 'error', error: { name: 'APIError', data: { message } } }) + '\n');
  process.exit(1);
}
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
// Tests make triage runs fail (until the file is removed) by creating triage-fail.txt next to this script.
if (!isDigest && existsSync(join(dir, 'triage-fail.txt'))) {
  process.stderr.write('fake triage failure\n');
  process.exit(1);
}
// Tests hold triage runs (posts stay "triage pending") by creating triage-hold.txt next to this script.
while (!isDigest && existsSync(join(dir, 'triage-hold.txt'))) await sleep(50);
const ids = [...new Set([...prompt.matchAll(/"statusId":"(\d+)"/g)].map((m) => m[1]))];
const events = [
  { type: 'step_start', part: {} },
  { type: 'text', part: { text: JSON.stringify(isDigest ? digestReply(ids, digestCall, prompt) : triageReply(ids, prompt)) } },
  { type: 'step_finish', part: { reason: 'stop' } },
];
process.stdout.write(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
