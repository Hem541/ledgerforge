import { Test } from '@nestjs/testing';
import { ReconciliationService } from './reconciliation.service';
import { DatabaseService } from '../database/database.service';

/**
 * Proves reconciliation reports mismatches correctly given DB query results,
 * without a real database. The query() mock returns canned rows for each
 * query the service runs, in order.
 */
describe('ReconciliationService', () => {
  let service: ReconciliationService;
  const query = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: DatabaseService, useValue: { query } },
      ],
    }).compile();
    service = moduleRef.get(ReconciliationService);
  });

  it('reports zero mismatches on a clean ledger', async () => {
    query
      .mockResolvedValueOnce([{ id: 'run-1' }]) // INSERT run
      .mockResolvedValueOnce([]) // unbalanced check: none
      .mockResolvedValueOnce([]) // status mismatch check: none
      .mockResolvedValueOnce([{ count: '3' }]) // count txns
      .mockResolvedValueOnce([]); // UPDATE run

    const result = await service.runReconciliation();

    expect(result.runId).toBe('run-1');
    expect(result.transactionsChecked).toBe(3);
    expect(result.mismatchesFound).toBe(0);
  });

  it('detects an unbalanced transaction', async () => {
    query
      .mockResolvedValueOnce([{ id: 'run-2' }]) // INSERT run
      .mockResolvedValueOnce([
        { transaction_id: 'txn-bad', entry_sum: '1000', status: 'completed' },
      ]) // unbalanced check: one bad
      .mockResolvedValueOnce([]) // status mismatch check: none
      .mockResolvedValueOnce([{ count: '5' }]) // count txns
      .mockResolvedValueOnce([]); // UPDATE run

    const result = await service.runReconciliation();

    expect(result.mismatchesFound).toBe(1);
    expect(result.mismatches[0].transactionId).toBe('txn-bad');
    expect(result.mismatches[0].reason).toBe('unbalanced_entries');
    expect(result.mismatches[0].entrySum).toBe(1000);
  });

  it('detects a completed transaction with no entries', async () => {
    query
      .mockResolvedValueOnce([{ id: 'run-3' }])
      .mockResolvedValueOnce([]) // balanced
      .mockResolvedValueOnce([
        { transaction_id: 'txn-empty', status: 'completed', entry_count: '0' },
      ]) // status mismatch: one
      .mockResolvedValueOnce([{ count: '2' }])
      .mockResolvedValueOnce([]);

    const result = await service.runReconciliation();

    expect(result.mismatchesFound).toBe(1);
    expect(result.mismatches[0].reason).toBe('completed_without_entries');
  });
});
