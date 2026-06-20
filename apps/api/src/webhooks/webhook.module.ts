import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';

@Module({
  providers: [WebhookService],
  controllers: [WebhookController],
  exports: [WebhookService],
})
export class WebhookModule {}
