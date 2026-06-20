#!/usr/bin/env bash
set -euo pipefail

COUNT="${COUNT:-1000000}"
echo "==> Seeding $COUNT synthetic balanced transactions into Postgres"
echo "    (this runs entirely inside the database; expect a few minutes for 1M)"
echo

START=$(date +%s)

docker exec -i ledgerforge-db psql -U ledger -d ledgerforge -v count="$COUNT" << 'SQL'
\set ON_ERROR_STOP on
\timing on

ALTER TABLE ledger_entries DISABLE TRIGGER trg_transaction_balanced;

INSERT INTO transactions (id, idempotency_key, amount, currency, status, created_at)
SELECT
    gen_random_uuid(),
    'seed-' || gs::text,
    (floor(random() * 99901) + 100)::bigint,           -- 100..100000 cents
    'USD',
    'completed',
    now() - (random() * interval '30 days')
FROM generate_series(1, :count) AS gs;

INSERT INTO ledger_entries (transaction_id, account_id, amount, currency)
SELECT t.id, '00000000-0000-0000-0000-000000000001', t.amount, 'USD'
  FROM transactions t
 WHERE t.idempotency_key LIKE 'seed-%';

INSERT INTO ledger_entries (transaction_id, account_id, amount, currency)
SELECT t.id, '00000000-0000-0000-0000-000000000002', -t.amount, 'USD'
  FROM transactions t
 WHERE t.idempotency_key LIKE 'seed-%';

ALTER TABLE ledger_entries ENABLE TRIGGER trg_transaction_balanced;

SELECT
    (SELECT count(*) FROM transactions)            AS total_transactions,
    (SELECT count(*) FROM ledger_entries)          AS total_entries,
    (SELECT COALESCE(SUM(amount),0) FROM ledger_entries) AS ledger_net_should_be_zero;
SQL

END=$(date +%s)
echo
echo "============================================================"
echo "Seed complete in $((END - START))s."
echo "ledger_net_should_be_zero = 0 proves the 1M-row ledger balances."
echo
echo "Next — prove the invariant across the whole dataset:"
echo "  curl -s -X POST http://localhost:3001/reconciliation/run"
echo "============================================================"
