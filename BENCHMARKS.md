# Benchmarks & diagnostics

This is how to produce — and verify — every benchmark claim. All numbers come
from your own machine; nothing here is estimated.

## Prerequisites

- API running (`cd apps/api && npm run start:dev`)
- Postgres + Redis up (`npm run infra:up`)
- For load tests: **k6** installed. On macOS:
  ```bash
  brew install k6
  ```

---

## Claim 1 — "1,000,000 synthetic transactions"

```bash
bash scripts/seed-1m.sh
```

Runs entirely inside Postgres (set-based, not row-by-row), so 1M takes a few
minutes, not hours. At the end it prints the totals. Verify any time:

```bash
docker exec -it ledgerforge-db psql -U ledger -d ledgerforge \
  -c "SELECT count(*) FROM transactions;"
```

## Claim 2 — "100% balanced ledger invariant"

After seeding, prove the whole dataset balances:

```bash
curl -s -X POST http://localhost:3001/reconciliation/run
```

`mismatchesFound: 0` across all ~1M transactions is the proof. Also:

```bash
docker exec -it ledgerforge-db psql -U ledger -d ledgerforge \
  -c "SELECT SUM(amount) AS should_be_zero FROM ledger_entries;"
```

## Claim 3 — "p95 latency under load"

```bash
k6 run load-tests/k6/baseline.js
```

k6 prints a full summary. The numbers to record for the README:
- `http_req_duration` → **p(95)** and **p(99)**
- `http_reqs` → total requests + requests/sec
- `payments_created` → successful payments

The test has thresholds baked in (p95 < 250ms, p99 < 500ms, <1% errors); k6
exits non-zero if they're missed, so it doubles as a regression gate. Adjust
the targets in the file to match what your hardware actually achieves, then
report the real figure.

## Claim 4 — "duplicate-charge prevention under retry storms"

```bash
k6 run load-tests/k6/payment-storm.js
```

50 concurrent users hammer a pool of 20 shared idempotency keys for 30s. Then
prove no double charges happened:

```bash
bash scripts/verify-storm.sh
```

You want: `PASS: no duplicate charges — one transaction per key`. That means
thousands of concurrent duplicate requests produced at most one transaction per
key — the retry storm was fully absorbed.

---

## Recording results for the README

Replace the _TBD_ rows in the README benchmark table with your actual figures,
phrased precisely, e.g.:

| Metric | Result |
|---|---|
| Synthetic transactions processed | 1,000,000 |
| Ledger balance invariant violations | 0 |
| Duplicate charges under retry storm (20 keys, 50 VUs, 30s) | 0 |
| p95 latency, POST /payments (20 concurrent VUs, local) | _your number_ ms |
| Reconciliation mismatches detected (injected test) | 1 / 1 |

Keep the qualifiers ("20 concurrent VUs, local") in the table — they state
exactly what was measured under what conditions.
```
