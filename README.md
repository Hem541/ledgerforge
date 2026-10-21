# LedgerForge

**A cloud payment ledger & reconciliation platform** — double-entry accounting with a database-enforced balance invariant, idempotent payment processing, and an independent reconciliation engine.

**[▶ Watch the demo](https://youtu.be/Wmw6I7dmefs)** — the balance invariant flips to IMBALANCE the instant the ledger is corrupted, then back to BALANCED once it's reconciled.

![LedgerForge dashboard](demos/dashboard.png)

## What it is

LedgerForge records money movements using double-entry bookkeeping. Account balances are *derived* from ledger entries rather than stored, so they can't drift from the underlying history.

Correctness comes from two distinct layers:

- **Enforcement** — a deferred PostgreSQL constraint trigger rejects any transaction whose entries don't sum to zero at commit time. Application code (and ordinary bugs) cannot write an unbalanced transaction through the normal path.
- **Detection** — an independent reconciliation engine sweeps the ledger for inconsistencies, including those introduced out-of-band (e.g. direct database changes that bypass the trigger). It flags imbalances and status/entry mismatches rather than preventing them.

Idempotent payments and asynchronous webhook delivery handle the two most common failure modes in payment systems: duplicate requests and unreliable downstream services.

## Highlights

- **Double-entry ledger** with a deferred Postgres constraint trigger enforcing that every transaction's entries sum to zero — enforced at the database layer, so it can't be bypassed by application code.
- **Idempotent payments** — a Redis `SET NX` fast path backed by a Postgres unique constraint on the idempotency key. Load-tested under a retry storm of 700K+ colliding requests with zero duplicate charges.
- **Asynchronous webhook delivery** with exponential backoff and a dead-letter state.
- **Independent reconciliation engine** that detects unbalanced entries and status/entry mismatches; reported zero mismatches across a 1M+ transaction dataset.
- Measured **p95 ~9.6ms** write latency at ~2,300 payments/sec with 0% errors under load (20 concurrent VUs, local).

## Stack

TypeScript · NestJS · PostgreSQL · Redis · Next.js · Docker · k6 · AWS EC2

## Run it

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

The dashboard is served at `http://localhost`. See [DEPLOY.md](DEPLOY.md) for the AWS deployment walkthrough and [BENCHMARKS.md](BENCHMARKS.md) for load-test details.
