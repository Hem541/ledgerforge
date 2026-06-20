import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';
import { WebhookService } from '../webhooks/webhook.service';

// background timers: reconciliation sweep every minute, webhook pump every 10s
@Injectable()
export class ReconciliationScheduler {
  private readonly logger = new Logger(ReconciliationScheduler.name);

  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly webhooks: WebhookService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledReconciliation() {
    this.logger.debug('Scheduled reconciliation sweep starting');
    try {
      await this.reconciliation.runReconciliation();
    } catch (err: any) {
      this.logger.error(`Scheduled reconciliation failed: ${err.message}`);
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async pumpWebhooks() {
    try {
      const due = await this.webhooks.findDueEvents(50);
      if (due.length === 0) return;
      this.logger.debug(`Pumping ${due.length} due webhook(s)`);
      // sequential to keep demo logs readable
      for (const id of due) {
        await this.webhooks.attemptDelivery(id);
      }
    } catch (err: any) {
      this.logger.error(`Webhook pump failed: ${err.message}`);
    }
  }
}
