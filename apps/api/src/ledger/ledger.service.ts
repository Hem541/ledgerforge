import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';

// one side of a double-entry posting
export interface LedgerLine {
  accountId: string;
  // positive = debit, negative = credit. lines must sum to zero
  amount: number;
}

// fixed system account ids (seeded in 02_seed_accounts.sql)
export const SYSTEM_ACCOUNTS = {
  CASH: '00000000-0000-0000-0000-000000000001',
  REVENUE: '00000000-0000-0000-0000-000000000002',
  CUSTOMER_CLEARING: '00000000-0000-0000-0000-000000000003',
  PROCESSING_FEES: '00000000-0000-0000-0000-000000000004',
} as const;

// writes double-entry rows. does not open its own txn - caller passes a
// PoolClient already in one so payment+entries+audit commit together
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  // standard 2-line posting for an incoming payment: debit cash, credit revenue
  buildPaymentPosting(amount: number): LedgerLine[] {
    return [
      { accountId: SYSTEM_ACCOUNTS.CASH, amount: amount }, // debit
      { accountId: SYSTEM_ACCOUNTS.REVENUE, amount: -amount }, // credit
    ];
  }

  // app-level balance check first (fast, good error); deferred db trigger
  // re-checks at commit (authoritative)
  async postEntries(
    client: PoolClient,
    transactionId: string,
    lines: LedgerLine[],
    currency = 'USD',
  ): Promise<void> {
    const sum = lines.reduce((acc, l) => acc + l.amount, 0);
    if (sum !== 0) {
      throw new Error(
        `Refusing to post unbalanced entries (sum=${sum}) for txn ${transactionId}`,
      );
    }
    if (lines.length < 2) {
      throw new Error('A posting needs at least two entries (a debit and a credit)');
    }

    for (const line of lines) {
      await client.query(
        `INSERT INTO ledger_entries (transaction_id, account_id, amount, currency)
         VALUES ($1, $2, $3, $4)`,
        [transactionId, line.accountId, line.amount, currency],
      );
    }

    this.logger.debug(
      `Posted ${lines.length} balanced entries for txn ${transactionId}`,
    );
  }

  // balance = sum of entries, always derived never stored
  async getAccountBalance(
    client: PoolClient,
    accountId: string,
  ): Promise<number> {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS balance
         FROM ledger_entries
        WHERE account_id = $1`,
      [accountId],
    );
    return Number(rows[0].balance);
  }
}
