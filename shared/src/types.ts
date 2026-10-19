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

const xHandle = z.string().regex(/^[A-Za-z0-9_]{1,15}$/);
const capturedStatusId = z.string().regex(/^\d{1,30}$/);

// Only X's own image CDNs: the panel loads this URL, so any other host would be a tracking beacon.
export const AVATAR_URL_PATTERN = /^https:\/\/(?:pbs|abs)\.twimg\.com\/[A-Za-z0-9_\-./%]{1,250}$/;

export const CapturedPostSchema = z.object({
  statusId: capturedStatusId,
  authorName: z.string().max(200),
  authorHandle: xHandle,
  text: z.string().max(4000),
  postedAt: z.string().max(40).nullable(),
  metrics: counts,
  isReply: z.boolean(),
  replyTo: z.array(xHandle).max(10).default([]),
  quotedStatusId: capturedStatusId.nullable(),
  avatarUrl: z.string().max(300).regex(AVATAR_URL_PATTERN).nullable().default(null),
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
  /** The rough draft's saved thumb (its `examples` polarity), independent of the Claude version's. */
  feedback: z.enum(['up', 'down']).nullable().default(null),
});
export type TriageInfo = z.infer<typeof TriageInfoSchema>;

export const PolishStatusSchema = z.enum(['polishing', 'ready', 'needs_edit', 'error', 'cap_reached']);
export type PolishStatus = z.infer<typeof PolishStatusSchema>;

export const MAX_DRAFT_VERSIONS = 10;

export const DraftVersionSchema = z.object({
  id: z.number().int().positive(),
  text: z.string(),
  status: z.enum(['ready', 'needs_edit']),
  violations: z.array(z.string()),
});
export type DraftVersion = z.infer<typeof DraftVersionSchema>;

export const PolishInfoSchema = z.object({
  status: PolishStatusSchema,
  /** The selected version's text (kept while a regenerate is polishing). */
  text: z.string().nullable(),
  violations: z.array(z.string()),
  topPick: z.boolean(),
  error: z.string().nullable(),
  /** Every generated option, oldest first. */
  versions: z.array(DraftVersionSchema).default([]),
  selectedVersion: z.number().int().positive().nullable().default(null),
  /** The draft's latest thumb rating (an examples row), so the panel can show it as selected. */
  feedback: z.enum(['up', 'down']).nullable().default(null),
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
  /** When the user marked this post replied (null while it still needs a reply). */
  repliedAt: z.number().int().nonnegative().nullable().default(null),
  triage: TriageInfoSchema.nullable(),
  polish: PolishInfoSchema.nullable(),
});
export type StoredPost = z.infer<typeof StoredPostSchema>;

export const FLAGGED_FEEDS = ['to_reply', 'replied'] as const;
export type FlaggedFeed = (typeof FLAGGED_FEEDS)[number];

export const FlaggedCountsSchema = z.object({ toReply: z.number().int().nonnegative(), replied: z.number().int().nonnegative() });
export type FlaggedCounts = z.infer<typeof FlaggedCountsSchema>;

export const PostListResponseSchema = z.object({
  posts: z.array(StoredPostSchema),
  nextBefore: z.number().int().positive().nullable(),
  /** Flagged view only: sizes of both sub-feeds, whichever one `posts` holds. */
  counts: FlaggedCountsSchema.optional(),
});
export type PostListResponse = z.infer<typeof PostListResponseSchema>;

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:7457';

export const NATIVE_HOST_NAME = 'com.xpassivecopilot.host';

export const NativeHostMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    port: z.number().int().min(1).max(65535),
    token: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  }),
  z.object({ type: z.literal('error'), message: z.string().max(300) }),
]);
export type NativeHostMessage = z.infer<typeof NativeHostMessageSchema>;

export const LinkStatusSchema = z.object({
  state: z.enum(['offline', 'connecting', 'online', 'error']),
  message: z.string().max(300).nullable(),
});
export type LinkStatus = z.infer<typeof LinkStatusSchema>;

export const LinkControlMessageSchema = z.object({ type: z.literal('set-online'), online: z.boolean() });
export type LinkControlMessage = z.infer<typeof LinkControlMessageSchema>;

export const DoctorCheckSchema = z.object({
  id: z.string().max(40),
  label: z.string().max(80),
  status: z.enum(['ok', 'missing', 'not_logged_in', 'problem']),
  detail: z.string().max(200).nullable(),
  fix: z.string().max(300).nullable(),
});
export type DoctorCheck = z.infer<typeof DoctorCheckSchema>;

export const DoctorReportSchema = z.object({ checks: z.array(DoctorCheckSchema).max(20) });
export type DoctorReport = z.infer<typeof DoctorReportSchema>;

export const VoiceProfileSchema = z.object({
  tone: z.string().max(300),
  length: z.string().max(200),
  vocabulary: z.string().max(300),
  dos: z.array(z.string().max(200)).max(8),
  donts: z.array(z.string().max(200)).max(8),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const VoiceViewSchema = z.object({
  profile: VoiceProfileSchema.nullable(),
  sampleCount: z.number().int().nonnegative(),
  minSamples: z.number().int().positive(),
  failed: z.boolean(),
  examples: z.object({ positive: z.array(z.string()), negative: z.array(z.string()) }),
});
export type VoiceView = z.infer<typeof VoiceViewSchema>;

export const FeedbackRequestSchema = z
  .object({
    kind: z.enum(['copy', 'edit', 'up', 'down']),
    text: z.string().min(1).max(1000).optional(),
  })
  .refine((v) => v.kind !== 'edit' || v.text !== undefined, { message: 'edit needs text' });
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const RepliedRequestSchema = z.object({ replied: z.boolean() });
export type RepliedRequest = z.infer<typeof RepliedRequestSchema>;

export const SelectVersionRequestSchema = z.object({ versionId: z.number().int().positive() });
export type SelectVersionRequest = z.infer<typeof SelectVersionRequestSchema>;

export const MODEL_FAILURE_KINDS = ['cli', 'timeout', 'malformed', 'busy', 'rate', 'quota', 'paused', 'unavailable'] as const;
export const ModelFailureKindSchema = z.enum(MODEL_FAILURE_KINDS);
export type ModelFailureKind = z.infer<typeof ModelFailureKindSchema>;

const MODEL_FAILURE_TEXT: Record<ModelFailureKind, string> = {
  quota: 'Gemini free quota reached',
  paused: 'Gemini free quota reached on every configured model',
  rate: 'Gemini rate limit hit',
  busy: 'Gemini is busy right now',
  unavailable: 'the configured model is no longer available (set another in models.triage)',
  timeout: 'the model took too long to answer',
  malformed: 'the model answered in an unreadable format',
  cli: 'the model CLI failed (see the server log)',
};

/** Plain-words cause of a failed model call, shown in the panel. */
export function describeModelFailure(kind: ModelFailureKind): string {
  return MODEL_FAILURE_TEXT[kind];
}

export const DigestTrendSchema = z.object({
  title: z.string().max(120),
  summary: z.string().max(400),
  statusIds: z.array(z.string().regex(/^\d+$/)).max(10),
});
export type DigestTrend = z.infer<typeof DigestTrendSchema>;

export const DigestIdeaSchema = z.object({
  id: z.string().regex(/^\d{1,9}-\d$/),
  text: z.string().max(280),
  feature: z.string().max(120),
  polish: PolishInfoSchema.nullable(),
});
export type DigestIdea = z.infer<typeof DigestIdeaSchema>;

export const DIGEST_STEP_IDS = ['collect', 'context', 'model', 'save'] as const;
export type DigestStepId = (typeof DIGEST_STEP_IDS)[number];

export const DigestStepSchema = z.object({
  id: z.enum(DIGEST_STEP_IDS),
  label: z.string().max(200),
  state: z.enum(['pending', 'current', 'done', 'failed']),
  /** What the current step is waiting on, e.g. a retry or a model switch. */
  detail: z.string().max(200).nullable(),
});
export type DigestStep = z.infer<typeof DigestStepSchema>;

/** The current (or just finished) digest run, kept in server memory only. */
export const DigestProgressSchema = z.object({
  startedAt: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  steps: z.array(DigestStepSchema).max(DIGEST_STEP_IDS.length),
  outcome: z
    .discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), ideas: z.number().int().nonnegative() }),
      z.object({ ok: z.literal(false), reason: z.string().max(200) }),
    ])
    .nullable(),
});
export type DigestProgress = z.infer<typeof DigestProgressSchema>;

export const EarlierDigestSchema = z.object({
  createdAt: z.number().int().nonnegative(),
  ideas: z.array(DigestIdeaSchema).max(3),
});
export type EarlierDigest = z.infer<typeof EarlierDigestSchema>;

export const MAX_EARLIER_DIGESTS = 9;

export const DigestViewSchema = z.object({
  digest: z
    .object({
      createdAt: z.number().int().nonnegative(),
      trends: z.array(DigestTrendSchema).max(5),
      ideas: z.array(DigestIdeaSchema).max(3),
    })
    .nullable(),
  /** Ideas of the digests before the latest one, newest first, bounded. */
  earlier: z.array(EarlierDigestSchema).max(MAX_EARLIER_DIGESTS),
  failed: z.boolean(),
  /** Why the last refresh failed; null when it succeeded or the cause was not recorded. */
  failure: z
    .object({
      kind: ModelFailureKindSchema,
      at: z.number().int().nonnegative(),
      resumesAt: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  /** A digest (automatic or manual) is generating right now. */
  running: z.boolean(),
  /** Steps of the running digest, or of one that finished a few seconds ago; null otherwise. */
  progress: DigestProgressSchema.nullable(),
});
export type DigestView = z.infer<typeof DigestViewSchema>;

export const MAX_STYLE_NOTES = 2000;
export const StyleNotesSchema = z.object({ notes: z.string().max(MAX_STYLE_NOTES) });
export type StyleNotes = z.infer<typeof StyleNotesSchema>;
