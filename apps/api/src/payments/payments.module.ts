import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { LedgerModule } from '../ledger/ledger.module';
import { WebhookModule } from '../webhooks/webhook.module';

@Module({
  imports: [LedgerModule, WebhookModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
