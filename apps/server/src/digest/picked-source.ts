import type { DatabaseSync } from 'node:sqlite';
import { MAX_IDEA_SOURCE_TEXT, type IdeaSource, type IdeaSourceInput } from '@xc/shared';
import { ideaSourceOf, type SourcePost } from './source-posts';

/** A post the user picked for an idea: how the idea cites it, and how the prompt shows it. */
export interface PickedSource {
  source: IdeaSource;
  prompt: SourcePost;
}

interface PostRow {
  status_id: string;
  author_handle: string;
  text: string;
}

// X's quote composer shows no status link, so a quoted post is also matched by author and exact text.
function findCaptured(db: DatabaseSync, input: IdeaSourceInput): PostRow | undefined {
  const columns = 'SELECT status_id, author_handle, text FROM posts';
  const byId = input.statusId ? db.prepare(`${columns} WHERE status_id = ?`).get(input.statusId) : undefined;
  return (byId ??
    db.prepare(`${columns} WHERE author_handle = ? COLLATE NOCASE AND text = ? ORDER BY seq DESC LIMIT 1`).get(input.authorHandle, input.text)) as
    | PostRow
    | undefined;
}

/** The stored post when it was captured, else what the content script read from X's DOM; both untrusted. */
export function resolvePickedSource(db: DatabaseSync, input: IdeaSourceInput): PickedSource {
  const row = findCaptured(db, input);
  const post = row
    ? { statusId: row.status_id, authorHandle: row.author_handle, text: row.text }
    : { statusId: input.statusId, authorHandle: input.authorHandle, text: input.text };
  return {
    source: ideaSourceOf(post),
    prompt: { statusId: post.statusId, author: post.authorHandle, excerpt: post.text.slice(0, MAX_IDEA_SOURCE_TEXT) },
  };
}
