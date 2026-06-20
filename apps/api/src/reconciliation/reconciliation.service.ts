import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface ReconciliationResult {
  runId: string;
  transactionsChecked: number;
  mismatchesFound: number;
  mismatches: MismatchDetail[];
}

export interface MismatchDetail {
  transactionId: string;
  reason: string;
  entrySum: number;
  status: string;
}

// sweeps the ledger for inconsistencies, records result in reconciliation_runs.
// independent check from the db trigger - catches out-of-band corruption.
// detects: (1) entries not summing to zero, (2) status vs entries disagreement
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly db: DatabaseService) {}

  async runReconciliation(): Promise<ReconciliationResult> {
    const runRows = await this.db.query<{ id: string }>(
      `INSERT INTO reconciliation_runs (status) VALUES ('running') RETURNING id`,
    );
    const runId = runRows[0].id;
    this.logger.log(`Reconciliation run ${runId} started`);

    try {
      const mismatches: MismatchDetail[] = [];

      // check 1: entries per txn must sum to zero
      const unbalanced = await this.db.query<{
        transaction_id: string;
        entry_sum: string;
        status: string;
      }>(
        `SELECT t.id AS transaction_id,
                COALESCE(SUM(le.amount), 0)::bigint AS entry_sum,
                t.status
           FROM transactions t
           LEFT JOIN ledger_entries le ON le.transaction_id = t.id
          GROUP BY t.id, t.status
         HAVING COALESCE(SUM(le.amount), 0) <> 0`,
      );
      for (const row of unbalanced) {
        mismatches.push({
          transactionId: row.transaction_id,
          reason: 'unbalanced_entries',
          entrySum: Number(row.entry_sum),
          status: row.status,
        });
      }

      // check 2: completed txn with zero entries = status/ledger disagree
      const statusMismatch = await this.db.query<{
        transaction_id: string;
        status: string;
        entry_count: string;
      }>(
        `SELECT t.id AS transaction_id,
                t.status,
                COUNT(le.id) AS entry_count
           FROM transactions t
           LEFT JOIN ledger_entries le ON le.transaction_id = t.id
          WHERE t.status = 'completed'
          GROUP BY t.id, t.status
         HAVING COUNT(le.id) = 0`,
      );
      for (const row of statusMismatch) {
        mismatches.push({
          transactionId: row.transaction_id,
          reason: 'completed_without_entries',
          entrySum: 0,
          status: row.status,
        });
      }

      const countRows = await this.db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM transactions`,
      );
      const transactionsChecked = Number(countRows[0].count);

      await this.db.query(
        `UPDATE reconciliation_runs
            SET status = 'completed',
                finished_at = now(),
                transactions_checked = $2,
                mismatches_found = $3
          WHERE id = $1`,
        [runId, transactionsChecked, mismatches.length],
      );

      if (mismatches.length > 0) {
        this.logger.warn(
          `Reconciliation run ${runId} found ${mismatches.length} mismatch(es)`,
        );
      } else {
        this.logger.log(
          `Reconciliation run ${runId} clean: ${transactionsChecked} transactions, 0 mismatches`,
        );
      }

      return {
        runId,
        transactionsChecked,
        mismatchesFound: mismatches.length,
        mismatches,
      };
    } catch (err: any) {
      await this.db.query(
        `UPDATE reconciliation_runs
            SET status = 'failed', finished_at = now()
          WHERE id = $1`,
        [runId],
      );
      this.logger.error(`Reconciliation run ${runId} failed: ${err.message}`);
      throw err;
    }
  }

  // recent runs for dashboard
  async getRecentRuns(limit = 10) {
    return this.db.query(
      `SELECT id, started_at, finished_at, transactions_checked,
              mismatches_found, status
         FROM reconciliation_runs
        ORDER BY started_at DESC
        LIMIT $1`,
      [limit],
    );
  }
}
