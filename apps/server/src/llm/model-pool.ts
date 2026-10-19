import type { DatabaseSync } from 'node:sqlite';
import { err, type AppConfig, type Result } from '@xc/shared';
import { log } from '../log';
import { deleteMeta, getMeta, setMeta } from '../meta';
import { classifyFailure, PAUSED_PREFIX } from '../triage/retry';
import { earliestReset, pickModel, quotaResetAt } from './quota';

export type RunOn = (prompt: string, model: string) => Promise<Result<string>>;

export interface QuotaStatus {
  /** Model the next call goes to, or null while paused. */
  active: string | null;
  exhausted: { model: string; until: number; unavailable: boolean }[];
  /** 0 when some model is usable. */
  pausedUntil: number;
}

export interface ModelPool {
  run(prompt: string): Promise<Result<string>>;
  pausedUntil(): number;
  status(): QuotaStatus;
}

/** `models.triage` first, then `models.triageFallbacks`, deduplicated; empty when triage is off. */
export function modelChain(config: AppConfig): string[] {
  if (!config.models.triage) return [];
  return [...new Set([config.models.triage, ...config.models.triageFallbacks])];
}

const untilKey = (model: string) => `quota-until:${model}`;
// 0 = short cooldown, 1 = daily quota, 2 = model retired ("no longer available"), rechecked after 30 days.
const dailyKey = (model: string) => `quota-daily:${model}`;
const UNAVAILABLE_RECHECK_MS = 30 * 86_400_000;

/**
 * Sends each call to the first model with quota left. A quota error marks that model exhausted
 * (persisted in `meta`, so a restart does not hammer the API) and falls through to the next one;
 * with every model exhausted it fails fast with a `paused` error until the earliest reset.
 */
export function createModelPool(db: DatabaseSync, models: readonly string[], runOn: RunOn, now: () => number = Date.now): ModelPool {
  const exhaustedUntil = (model: string) => getMeta(db, untilKey(model));

  function markExhausted(model: string, message: string): void {
    const afterShortCooldown = exhaustedUntil(model) > 0 && getMeta(db, dailyKey(model)) === 0;
    const reset = quotaResetAt(message, now(), afterShortCooldown);
    setMeta(db, untilKey(model), reset.until);
    setMeta(db, dailyKey(model), reset.daily ? 1 : 0);
    log(`quota reached for ${model} until ${new Date(reset.until).toISOString()}`);
  }

  function markUnavailable(model: string): void {
    setMeta(db, untilKey(model), now() + UNAVAILABLE_RECHECK_MS);
    setMeta(db, dailyKey(model), 2);
    log(`model ${model} is no longer available; skipping it`);
  }

  function markHealthy(model: string): void {
    deleteMeta(db, untilKey(model));
    deleteMeta(db, dailyKey(model));
  }

  const pausedUntil = () => earliestReset(models, exhaustedUntil, now());

  async function run(prompt: string): Promise<Result<string>> {
    for (let model = pickModel(models, exhaustedUntil, now()); model; model = pickModel(models, exhaustedUntil, now())) {
      const out = await runOn(prompt, model);
      if (out.ok) {
        markHealthy(model);
        return out;
      }
      const kind = classifyFailure(out.error);
      if (kind === 'unavailable') markUnavailable(model);
      else if (kind === 'quota' || kind === 'rate') markExhausted(model, out.error);
      else return out;
    }
    return err(`${PAUSED_PREFIX}: quota reached on every model until ${new Date(pausedUntil()).toISOString()}`);
  }

  function status(): QuotaStatus {
    const at = now();
    const exhausted = models
      .map((model) => ({ model, until: exhaustedUntil(model), unavailable: getMeta(db, dailyKey(model)) === 2 }))
      .filter((m) => m.until > at);
    return { active: pickModel(models, exhaustedUntil, at), exhausted, pausedUntil: pausedUntil() };
  }

  return { run, pausedUntil, status };
}
