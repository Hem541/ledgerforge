import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

// GET /accounts/balances - derived balances (summed from entries, not stored)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('balances')
  async balances() {
    return this.db.query(
      `SELECT a.id,
              a.name,
              a.type,
              COALESCE(SUM(le.amount), 0)::bigint AS balance
         FROM accounts a
         LEFT JOIN ledger_entries le ON le.account_id = a.id
        GROUP BY a.id, a.name, a.type
        ORDER BY a.name`,
    );
  }
}
