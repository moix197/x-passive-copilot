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

export const MustFlagSchema = z.enum(['mention', 'watchlist']);
export type MustFlag = z.infer<typeof MustFlagSchema>;

export const TriageItemSchema = z.object({
  statusId: z.string().regex(/^\d+$/),
  relevant: z.boolean(),
  replyWorthy: z.boolean(),
  score: z.number().min(0).max(100),
  reason: z.string().max(300),
  roughDraft: z.string().max(280),
});
export type TriageItem = z.infer<typeof TriageItemSchema>;

export const TriageInfoSchema = z.object({
  score: z.number().nullable(),
  reason: z.string().nullable(),
  roughDraft: z.string().nullable(),
  replyWorthy: z.boolean(),
  skipReason: z.string().nullable(),
  mustFlag: MustFlagSchema.nullable(),
  error: z.string().nullable(),
  roughDraftWarnings: z.array(z.string()),
});
export type TriageInfo = z.infer<typeof TriageInfoSchema>;

export const PolishStatusSchema = z.enum(['polishing', 'ready', 'needs_edit', 'error', 'cap_reached']);
export type PolishStatus = z.infer<typeof PolishStatusSchema>;

export const PolishInfoSchema = z.object({
  status: PolishStatusSchema,
  text: z.string().nullable(),
  violations: z.array(z.string()),
  topPick: z.boolean(),
  error: z.string().nullable(),
});
export type PolishInfo = z.infer<typeof PolishInfoSchema>;

export const PolishReplySchema = z.object({
  reply: z.string().min(1).max(1000),
  rationale: z.string().max(1000).default(''),
});
export type PolishReply = z.infer<typeof PolishReplySchema>;

export const StoredPostSchema = CapturedPostSchema.extend({
  seq: z.number().int().positive(),
  capturedAt: z.number().int().nonnegative(),
  triage: TriageInfoSchema.nullable(),
  polish: PolishInfoSchema.nullable(),
});
export type StoredPost = z.infer<typeof StoredPostSchema>;

export const PostListResponseSchema = z.object({
  posts: z.array(StoredPostSchema),
  nextBefore: z.number().int().positive().nullable(),
});
export type PostListResponse = z.infer<typeof PostListResponseSchema>;

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:7457';
