#!/usr/bin/env bash
set -euo pipefail

echo "==> Injecting an UNBALANCED transaction directly into Postgres"
echo "    (temporarily disabling the balance trigger to simulate corruption)"

docker exec -i ledgerforge-db psql -U ledger -d ledgerforge << 'SQL'
BEGIN;
ALTER TABLE ledger_entries DISABLE TRIGGER trg_transaction_balanced;

INSERT INTO transactions (id, idempotency_key, amount, currency, status)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd',
        'INJECTED-MISMATCH-001', 5000, 'USD', 'completed');

INSERT INTO ledger_entries (transaction_id, account_id, amount, currency) VALUES
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '00000000-0000-0000-0000-000000000001', 5000, 'USD'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '00000000-0000-0000-0000-000000000002', -4000, 'USD');

ALTER TABLE ledger_entries ENABLE TRIGGER trg_transaction_balanced;
COMMIT;
SQL

echo
echo "==> Done. The ledger now contains a +1000 imbalance."
echo "    Trigger this to detect it:"
echo "      curl -s -X POST http://localhost:3001/reconciliation/run | json_pp"
echo
echo "    Or just wait up to 60s for the scheduled sweep and check:"
echo "      curl -s http://localhost:3001/reconciliation/runs | json_pp"
echo
echo "    To clean up the injected row afterwards:"
echo "      bash scripts/clean-mismatch.sh"
