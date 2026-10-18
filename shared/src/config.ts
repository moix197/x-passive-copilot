import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { err, ok, type Result } from './types';

export const AppConfigSchema = z.object({
  handle: z.string().default('YOUR_HANDLE'),
  watchlist: z.array(z.string()).default([]),
  spacehoodRepoPath: z.string().default(''),
  announcementsPath: z.string().default(''),
  product: z.object({ name: z.string().trim().min(1).max(60).default('Spacehub') }).prefault({}),
  triage: z
    .object({
      batchSize: z.number().int().positive().default(15),
      maxAgeHours: z.number().positive().default(24),
      mentionMaxAgeHours: z.number().positive().default(72),
      minEngagement: z.number().nonnegative().default(3),
    })
    .prefault({}),
  autoPolish: z
    .object({
      enabled: z.boolean().default(false),
      threshold: z.number().default(80),
      dailyCap: z.number().int().nonnegative().default(10),
    })
    .prefault({}),
  digest: z
    .object({
      everyNPosts: z.number().int().positive().default(50),
      manualMinIntervalSec: z.number().int().nonnegative().default(60),
    })
    .prefault({}),
  voice: z.object({ minSamples: z.number().int().positive().default(5) }).prefault({}),
  models: z
    .object({ triage: z.string().default(''), final: z.string().default('') })
    .prefault({}),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export function defaultConfig(): AppConfig {
  return AppConfigSchema.parse({});
}

function readJsonFile(path: string): Result<unknown> {
  try {
    return ok(JSON.parse(readFileSync(path, 'utf8')));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' ? ok({}) : err(`cannot read ${path}: ${(e as Error).message}`);
  }
}

export function loadConfig(home: string): Result<AppConfig> {
  const file = readJsonFile(join(home, 'config.json'));
  if (!file.ok) return file;
  const parsed = AppConfigSchema.safeParse(file.value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.message);
}
