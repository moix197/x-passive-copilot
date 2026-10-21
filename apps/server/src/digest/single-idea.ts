import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig, DigestIdea, IdeaKind, IdeaSourceInput, ModelFailureKind, Result } from '@xc/shared';
import { log } from '../log';
import type { Idea } from '../polish/polish';
import { classifyFailure, errorClass, safeReason, sleep, withRetry } from '../triage/retry';
import type { RunModel } from '../voice/voice';
import {
  buildSingleIdeaPrompt,
  offeredSources,
  parseSingleIdea,
  recentIdeaKinds,
  recentIdeaTexts,
  recentPosts,
  saveSingleIdea,
} from './digest';
import { needsSource, pickNextKind } from './idea-kind';
import { resolvePickedSource, type PickedSource } from './picked-source';
import { gatherProductContext } from './product-context';
import { freshSourcePosts, toPromptSource, type SourceCandidate } from './source-posts';

export type SingleIdeaOutcome =
  | { status: 'ok'; idea: DigestIdea }
  | { status: 'busy' }
  | { status: 'unavailable' }
  /** An inspired or quote idea was asked for, but no fresh, unquoted captured post exists. */
  | { status: 'no_source' }
  | { status: 'paused'; until: number }
  | { status: 'failed'; kind: ModelFailureKind; resumesAt: number | null };

export interface SingleIdeaService {
  /**
   * One new idea of the given kind (none: the mixed rotation), saved where the panel Digest tab reads it.
   * A picked post (inspired or quote only) replaces the automatic source selection.
   */
  generate(kind?: IdeaKind, picked?: IdeaSourceInput): Promise<SingleIdeaOutcome>;
}

export interface SingleIdeaDeps {
  productContext?: () => Promise<string>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  /** When the model pool is out of quota on every model (0 = usable). */
  pausedUntil?: () => number;
}

interface IdeaPlan {
  kind: IdeaKind;
  sources: SourceCandidate[];
  picked?: PickedSource;
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

  // Source posts go into the prompt only for the kinds that draw on them.
  function plan(requested: IdeaKind | undefined, picked: IdeaSourceInput | undefined): IdeaPlan | null {
    if (requested && picked) return { kind: requested, sources: [], picked: resolvePickedSource(db, picked) };
    const fresh = freshSourcePosts(db, config.triage.maxAgeHours, now());
    const kind = requested ?? pickNextKind(recentIdeaKinds(db), fresh.length > 0);
    if (!needsSource(kind)) return { kind, sources: [] };
    return fresh.length > 0 ? { kind, sources: fresh } : null;
  }

  async function ask({ kind, sources, picked }: IdeaPlan): Promise<Result<Idea>> {
    const inputs = { kind, sources: picked ? [picked.prompt] : sources.map(toPromptSource) };
    const prompt = buildSingleIdeaPrompt(config.product.name, await productContext(), recentPosts(db), recentIdeaTexts(db), inputs);
    const offered = offeredSources(sources);
    return withRetry(async () => {
      const out = await runModel(prompt);
      return out.ok ? parseSingleIdea(out.value, kind, offered, picked?.source) : out;
    }, wait);
  }

  function failed(error: string): SingleIdeaOutcome {
    log(`single idea failed: ${errorClass(error)} (${safeReason(error)})`);
    const resumesAt = pausedUntil();
    return { status: 'failed', kind: classifyFailure(error), resumesAt: resumesAt > 0 ? resumesAt : null };
  }

  async function generate(requested?: IdeaKind, picked?: IdeaSourceInput): Promise<SingleIdeaOutcome> {
    const refused = refusal();
    if (refused) return refused;
    const planned = plan(requested, picked);
    if (!planned) return { status: 'no_source' };
    running = true;
    try {
      const result = await ask(planned);
      return result.ok ? { status: 'ok', idea: saveSingleIdea(db, result.value, now()) } : failed(result.error);
    } finally {
      running = false;
    }
  }

  return { generate };
}
