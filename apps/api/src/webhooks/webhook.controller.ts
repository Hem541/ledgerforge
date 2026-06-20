import { Controller, Post, Get, Body, Query } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { DatabaseService } from '../database/database.service';

@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly webhooks: WebhookService,
    private readonly db: DatabaseService,
  ) {}

  // create event for a txn. {force_fail:true} in payload drives the fail path
  @Post()
  async create(
    @Body()
    body: {
      transactionId: string;
      eventType?: string;
      payload?: Record<string, unknown>;
    },
  ) {
    const id = await this.webhooks.createEvent(
      body.transactionId,
      body.eventType ?? 'payment.succeeded',
      body.payload ?? {},
    );
    return { id, status: 'pending' };
  }

  // recent events + retry state
  @Get()
  async list(@Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 20;
    return this.db.query(
      `SELECT id, transaction_id, event_type, status, attempts,
              next_attempt_at, last_error
         FROM webhook_events
        ORDER BY created_at DESC
        LIMIT $1`,
      [n],
    );
  }
}
