import { MAX_DRAFT_VERSIONS, type PolishInfo, type StoredPost } from '@xc/shared/types';

export interface CurrentDraft {
  kind: 'rough' | 'claude';
  text: string;
  /** Feedback key: the statusId for the Claude version, `rough-<statusId>` for the First draft. */
  draftId: string;
  rating: 'up' | 'down' | null;
  /** A regenerate is running; the selected text stays readable but cannot be acted on. */
  busy: boolean;
}

/** The selected Claude version's text, when there is one worth showing. */
export function polishedText(polish: PolishInfo | null): string | null {
  return polish?.text && polish.status !== 'error' ? polish.text : null;
}

export function canPolish(post: StoredPost): boolean {
  const t = post.triage;
  // A must-flag post stays polishable even when its triage errored.
  return Boolean(t && !t.skipReason && (!t.error || t.mustFlag !== null));
}

export const canRegenerate = (post: StoredPost): boolean => (post.polish?.versions.length ?? 0) < MAX_DRAFT_VERSIONS;

/** The draft the user would send now: the selected Claude version, else the First draft. */
export function currentDraft(post: StoredPost): CurrentDraft | null {
  const polish = post.polish;
  const polished = polishedText(polish);
  if (polish && polished) {
    return { kind: 'claude', text: polished, draftId: post.statusId, rating: polish.feedback, busy: polish.status === 'polishing' };
  }
  const rough = post.triage?.roughDraft;
  if (!rough) return null;
  return { kind: 'rough', text: rough, draftId: `rough-${post.statusId}`, rating: post.triage?.feedback ?? null, busy: false };
}
