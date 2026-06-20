import { Controller, Post, Get, Query } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  // on-demand sweep. returns run id, txns checked, mismatches
  @Post('run')
  async run() {
    return this.reconciliation.runReconciliation();
  }

  // recent run history
  @Get('runs')
  async runs(@Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 10;
    return this.reconciliation.getRecentRuns(n);
  }
}
