import { z } from 'zod';

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E = string>(error: E): Result<never, E> => ({ ok: false, error });

const counts = z.object({
  replies: z.number().int().nonnegative(),
  reposts: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  views: z.number().int().nonnegative(),
});

export const CapturedPostSchema = z.object({
  statusId: z.string().regex(/^\d+$/),
  authorName: z.string().max(200),
  authorHandle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  text: z.string().max(4000),
  postedAt: z.string().max(40).nullable(),
  metrics: counts,
  isReply: z.boolean(),
  quotedStatusId: z.string().regex(/^\d+$/).nullable(),
});
export type CapturedPost = z.infer<typeof CapturedPostSchema>;

export const PostBatchSchema = z.object({ posts: z.array(CapturedPostSchema).max(100) });
export type PostBatch = z.infer<typeof PostBatchSchema>;

export const PostBatchResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
});
export type PostBatchResult = z.infer<typeof PostBatchResultSchema>;

export const HealthResponseSchema = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const CaptureMessageSchema = z.object({
  type: z.literal('posts'),
  posts: z.array(z.unknown()).max(100),
});
export type CaptureMessage = z.infer<typeof CaptureMessageSchema>;

export const StoredPostSchema = CapturedPostSchema.extend({
  seq: z.number().int().positive(),
  capturedAt: z.number().int().nonnegative(),
});
export type StoredPost = z.infer<typeof StoredPostSchema>;

export const PostListResponseSchema = z.object({
  posts: z.array(StoredPostSchema),
  nextBefore: z.number().int().positive().nullable(),
});
export type PostListResponse = z.infer<typeof PostListResponseSchema>;

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:7457';
