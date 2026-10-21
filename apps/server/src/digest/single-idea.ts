import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig, DigestIdea, ModelFailureKind, Result } from '@xc/shared';
import { log } from '../log';
import type { Idea } from '../polish/polish';
import { classifyFailure, errorClass, safeReason, sleep, withRetry } from '../triage/retry';
import type { RunModel } from '../voice/voice';
import { buildSingleIdeaPrompt, parseSingleIdea, recentIdeaTexts, recentPosts, saveSingleIdea } from './digest';
import { gatherProductContext } from './product-context';

export type SingleIdeaOutcome =
  | { status: 'ok'; idea: DigestIdea }
  | { status: 'busy' }
  | { status: 'unavailable' }
  | { status: 'paused'; until: number }
  | { status: 'failed'; kind: ModelFailureKind; resumesAt: number | null };

export interface SingleIdeaService {
  /** One new idea from the digest prompt and tone, saved where the panel Digest tab reads it. */
  generate(): Promise<SingleIdeaOutcome>;
}

export interface SingleIdeaDeps {
  productContext?: () => Promise<string>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  /** When the model pool is out of quota on every model (0 = usable). */
  pausedUntil?: () => number;
}

export function createSingleIdeaService(db: DatabaseSync, config: AppConfig, runModel: RunModel, deps: SingleIdeaDeps = {}): SingleIdeaService {
  const { productContext = () => gatherProductContext(config), now = Date.now, wait = sleep, pausedUntil = () => 0 } = deps;
  let running = false;

  function refusal(): SingleIdeaOutcome | null {
    if (!config.models.triage) return { status: 'unavailable' };
    if (running) return { status: 'busy' };
    const until = pausedUntil();
    return until > now() ? { status: 'paused', until } : null;
  }

  async function ask(): Promise<Result<Idea>> {
    const prompt = buildSingleIdeaPrompt(config.product.name, await productContext(), recentPosts(db), recentIdeaTexts(db));
    return withRetry(async () => {
      const out = await runModel(prompt);
      return out.ok ? parseSingleIdea(out.value) : out;
    }, wait);
  }

  function failed(error: string): SingleIdeaOutcome {
    log(`single idea failed: ${errorClass(error)} (${safeReason(error)})`);
    const resumesAt = pausedUntil();
    return { status: 'failed', kind: classifyFailure(error), resumesAt: resumesAt > 0 ? resumesAt : null };
  }

  async function generate(): Promise<SingleIdeaOutcome> {
    const refused = refusal();
    if (refused) return refused;
    running = true;
    try {
      const result = await ask();
      return result.ok ? { status: 'ok', idea: saveSingleIdea(db, result.value, now()) } : failed(result.error);
    } finally {
      running = false;
    }
  }

  return { generate };
}
