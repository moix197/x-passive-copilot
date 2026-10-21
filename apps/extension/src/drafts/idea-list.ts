import type { DigestIdea, DigestView } from '@xc/shared/types';

/** Most ideas the compose popover keeps listed. */
export const MAX_LISTED_IDEAS = 30;

/** Every idea in a digest view: the latest digest's, then the earlier ones'. */
export function viewIdeas(view: DigestView): DigestIdea[] {
  return [...(view.digest?.ideas ?? []), ...view.earlier.flatMap((digest) => digest.ideas)];
}

// Idea ids are "<digest row>-<index>": a higher row is newer; inside a row the model's order is kept.
function idParts(id: string): [number, number] {
  const [row = '0', index = '0'] = id.split('-');
  return [Number(row), Number(index)];
}

function newestFirst(a: DigestIdea, b: DigestIdea): number {
  const [rowA, indexA] = idParts(a.id);
  const [rowB, indexB] = idParts(b.id);
  return rowB - rowA || indexA - indexB;
}

/** Both lists as one, each idea once (the incoming copy wins), newest first and bounded. */
export function mergeIdeas(current: DigestIdea[], incoming: DigestIdea[]): DigestIdea[] {
  const byId = new Map(current.map((idea) => [idea.id, idea]));
  for (const idea of incoming) byId.set(idea.id, idea);
  return [...byId.values()].sort(newestFirst).slice(0, MAX_LISTED_IDEAS);
}
