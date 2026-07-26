export interface QueuedRequest {
  sessionId: string;
  execute: () => Promise<void>;
  onEvent: (event: Record<string, unknown>) => void;
  enqueuedAt: number;
}

export type EnqueueResult =
  | { status: 'executed'; executionPromise: Promise<void> }
  | { status: 'queued'; position: number; estimatedWait: string; executionPromise: Promise<void> }
  | { status: 'rejected'; reason: 'queue_full'; executionPromise: Promise<void> };
