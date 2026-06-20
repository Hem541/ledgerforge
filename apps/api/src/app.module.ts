import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { PaymentsModule } from './payments/payments.module';
import { LedgerModule } from './ledger/ledger.module';
import { HealthModule } from './health/health.module';
import { WebhookModule } from './webhooks/webhook.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    // drives the @Cron decorators in the reconciliation scheduler
    ScheduleModule.forRoot(),
    DatabaseModule,
    CommonModule,
    LedgerModule,
    PaymentsModule,
    WebhookModule,
    ReconciliationModule,
    HealthModule,
  ],
})
export class AppModule {}
