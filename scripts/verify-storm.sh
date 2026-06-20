#!/usr/bin/env bash
set -euo pipefail

echo "==> Verifying duplicate-charge prevention after the retry storm"
docker exec -i ledgerforge-db psql -U ledger -d ledgerforge << 'SQL'
SELECT
    count(*)                              AS transactions_for_storm_keys,
    count(DISTINCT idempotency_key)       AS distinct_keys_used
FROM transactions
WHERE idempotency_key LIKE 'storm-key-%';

SELECT
    CASE
        WHEN count(*) = count(DISTINCT idempotency_key)
        THEN 'PASS: no duplicate charges — one transaction per key'
        ELSE 'FAIL: duplicate charges detected'
    END AS verdict
FROM transactions
WHERE idempotency_key LIKE 'storm-key-%';

SELECT
    CASE WHEN COALESCE(SUM(amount),0) = 0
         THEN 'PASS: storm transactions are all balanced'
         ELSE 'FAIL: storm left an imbalance'
    END AS balance_verdict
FROM ledger_entries le
JOIN transactions t ON t.id = le.transaction_id
WHERE t.idempotency_key LIKE 'storm-key-%';
SQL
