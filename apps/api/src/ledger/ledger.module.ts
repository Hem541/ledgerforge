import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { AccountsController } from './accounts.controller';

@Module({
  providers: [LedgerService],
  controllers: [AccountsController],
  exports: [LedgerService],
})
export class LedgerModule {}
