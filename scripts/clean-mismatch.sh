#!/usr/bin/env bash
set -euo pipefail

echo "==> Removing injected mismatch transaction"
docker exec -i ledgerforge-db psql -U ledger -d ledgerforge << 'SQL'
BEGIN;
ALTER TABLE ledger_entries DISABLE TRIGGER trg_transaction_balanced;
DELETE FROM ledger_entries
 WHERE transaction_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
DELETE FROM transactions
 WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
ALTER TABLE ledger_entries ENABLE TRIGGER trg_transaction_balanced;
COMMIT;
SQL

echo "==> Cleaned. Ledger should balance again:"
echo "    SELECT SUM(amount) FROM ledger_entries;  -- expect 0"
