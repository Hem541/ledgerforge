import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

// outbound event delivery w/ retries + backoff against a flaky endpoint
// status: pending -> delivered | failed (retry after backoff) | dead (gave up)
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly baseDelayMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {
    this.baseDelayMs = this.config.get<number>('WEBHOOK_RETRY_BASE_MS', 1000);
    this.maxAttempts = this.config.get<number>('WEBHOOK_MAX_ATTEMPTS', 6);
  }

  async createEvent(
    transactionId: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<string> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO webhook_events (transaction_id, event_type, payload, status, next_attempt_at)
       VALUES ($1, $2, $3, 'pending', now())
       RETURNING id`,
      [transactionId, eventType, JSON.stringify(payload)],
    );
    return rows[0].id;
  }

  // try one delivery. success -> delivered. fail -> retry w/ backoff or dead
  async attemptDelivery(eventId: string): Promise<string> {
    const events = await this.db.query<{
      id: string;
      attempts: number;
      event_type: string;
      payload: any;
      transaction_id: string;
    }>(
      `SELECT id, attempts, event_type, payload, transaction_id
         FROM webhook_events
        WHERE id = $1`,
      [eventId],
    );
    if (events.length === 0) {
      this.logger.warn(`Webhook ${eventId} not found`);
      return 'not_found';
    }
    const event = events[0];
    const attemptNumber = event.attempts + 1;

    try {
      await this.simulateDelivery(event.event_type, event.payload);

      await this.db.query(
        `UPDATE webhook_events
            SET status = 'delivered', attempts = $2, last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [eventId, attemptNumber],
      );
      await this.audit(event.transaction_id, 'webhook_delivered', {
        eventId,
        attempts: attemptNumber,
      });
      this.logger.log(`Webhook ${eventId} delivered on attempt ${attemptNumber}`);
      return 'delivered';
    } catch (err: any) {
      const errorMsg = err?.message ?? 'unknown error';

      if (attemptNumber >= this.maxAttempts) {
        // out of retries
        await this.db.query(
          `UPDATE webhook_events
              SET status = 'dead', attempts = $2, last_error = $3, updated_at = now()
            WHERE id = $1`,
          [eventId, attemptNumber, errorMsg],
        );
        await this.audit(event.transaction_id, 'webhook_dead', {
          eventId,
          attempts: attemptNumber,
          error: errorMsg,
        });
        this.logger.error(
          `Webhook ${eventId} marked DEAD after ${attemptNumber} attempts: ${errorMsg}`,
        );
        return 'dead';
      }

      // backoff: base * 2^(attempt-1)
      const delayMs = this.baseDelayMs * Math.pow(2, attemptNumber - 1);
      await this.db.query(
        `UPDATE webhook_events
            SET status = 'failed',
                attempts = $2,
                last_error = $3,
                next_attempt_at = now() + ($4 || ' milliseconds')::interval,
                updated_at = now()
          WHERE id = $1`,
        [eventId, attemptNumber, errorMsg, String(delayMs)],
      );
      this.logger.warn(
        `Webhook ${eventId} failed attempt ${attemptNumber}, retry in ${delayMs}ms: ${errorMsg}`,
      );
      return 'failed';
    }
  }

  // due = pending/failed with next_attempt_at in the past
  async findDueEvents(limit = 50): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id
         FROM webhook_events
        WHERE status IN ('pending', 'failed')
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at ASC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }

  // simulated delivery - random ~30% failure to exercise retries.
  // force_fail in payload = deterministic permanent fail for tests
  private async simulateDelivery(
    eventType: string,
    payload: any,
  ): Promise<void> {
    if (payload && payload.force_fail === true) {
      throw new Error('Simulated permanent downstream failure');
    }
    const failed = Math.random() < 0.3;
    // fake network latency
    await new Promise((r) => setTimeout(r, 20));
    if (failed) {
      throw new Error('Simulated transient downstream error (HTTP 503)');
    }
  }

  private async audit(
    transactionId: string | null,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, detail)
       VALUES ('webhook', $1, $2, $3)`,
      [transactionId, action, JSON.stringify(detail)],
    );
  }
}
