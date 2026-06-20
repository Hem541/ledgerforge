import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationScheduler } from './reconciliation.scheduler';
import { WebhookModule } from '../webhooks/webhook.module';

@Module({
  imports: [WebhookModule],
  providers: [ReconciliationService, ReconciliationScheduler],
  controllers: [ReconciliationController],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
