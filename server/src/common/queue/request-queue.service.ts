import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { QueuedRequest, EnqueueResult } from './request-queue.interface';

@Injectable()
export class RequestQueueService {
  private readonly queue: QueuedRequest[] = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;

  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {
    this.maxConcurrent = this.configService.get('MAX_CONCURRENT_LLM', 3);
    this.maxQueueSize = this.configService.get('REQUEST_QUEUE_MAX_SIZE', 50);
  }

  async enqueue(request: QueuedRequest): Promise<EnqueueResult> {
    // Create a promise that resolves when execution completes
    let resolveExecution!: () => void;
    const executionPromise = new Promise<void>((resolve) => {
      resolveExecution = resolve;
    });

    const wrappedExecute = async (): Promise<void> => {
      try {
        await request.execute();
      } finally {
        resolveExecution();
      }
    };

    const wrappedRequest: QueuedRequest = {
      ...request,
      execute: wrappedExecute,
    };

    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      this.logger.debug(`Request for session ${request.sessionId} executing directly`);
      this.executeAndDequeue(wrappedRequest).catch((err) => {
        this.logger.error(`Queue execute error: ${err}`);
      });
      return { status: 'executed', executionPromise };
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.logger.warn(`Queue full, rejecting request for session ${request.sessionId}`);
      resolveExecution(); // Release any waiters
      return { status: 'rejected', reason: 'queue_full', executionPromise };
    }

    this.queue.push(wrappedRequest);
    const position = this.queue.length;
    const waitSeconds = Math.ceil(position * 10);
    this.logger.debug(`Request for session ${request.sessionId} queued at position ${position}`);
    return {
      status: 'queued',
      position,
      estimatedWait: `约 ${waitSeconds} 秒`,
      executionPromise,
    };
  }

  cancel(sessionId: string): boolean {
    const index = this.queue.findIndex((r) => r.sessionId === sessionId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.logger.debug(`Cancelled queued request for session ${sessionId}`);
      return true;
    }
    return false;
  }

  getQueuePosition(sessionId: string): number | null {
    const index = this.queue.findIndex((r) => r.sessionId === sessionId);
    return index !== -1 ? index + 1 : null;
  }

  private async executeAndDequeue(request: QueuedRequest): Promise<void> {
    try {
      await request.execute();
    } catch (err) {
      this.logger.error(`Queue execute error for session ${request.sessionId}: ${err}`);
    } finally {
      this.activeCount--;
      this.dequeueNext();
    }
  }

  private dequeueNext(): void {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const next = this.queue.shift()!;
      this.activeCount++;
      this.logger.debug(`Dequeuing request for session ${next.sessionId}`);
      next.onEvent({ type: 'dequeued', data: {} });
      this.executeAndDequeue(next).catch((err) => {
        this.logger.error(`Queue dequeue error: ${err}`);
      });
    }
  }
}
