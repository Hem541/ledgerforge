# Running the API

Do these in order. You need the infra (Postgres + Redis) already up from the
previous step (`npm run infra:up` at the repo root).

## 1. Install API dependencies

From the repo root:

```bash
cd apps/api
npm install
```

This pulls NestJS, the Postgres driver (`pg`), and the Redis client
(`ioredis`). Takes a minute or two the first time.

## 2. Make sure your .env exists

From the repo root (one level up):

```bash
cd ../..
cp .env.example .env
```

The defaults already match the Docker containers, so no editing needed.

## 3. Run the unit tests

```bash
cd apps/api
npm test
```

You should see the `PaymentsService` suite pass — this verifies the
idempotency decision logic (replay, in-flight conflict, DB-race conflict,
input validation) with mocked dependencies.

## 4. Start the API in watch mode

```bash
npm run start:dev
```

Watch the logs. You want to see:

```
Postgres pool initialized
Redis connected
LedgerForge API listening on :3001
```

Leave this terminal running.

## 5. Smoke-test it end to end

Open a SECOND terminal, go to the repo root, and run:

```bash
bash scripts/smoke-test.sh
```

This hits the live API: health check, a real $50 payment, a duplicate with the
same idempotency key (which must replay, not double-charge), a fetch by id, and
a rejected bad request. It prints PASS/FAIL for each.

## 6. Confirm the ledger balances

```bash
npm run db:psql
```

Then:

```sql
-- every transaction's entries net to zero, so the grand total is zero
SELECT SUM(amount) AS should_be_zero FROM ledger_entries;

-- see the entries from your smoke-test payment
SELECT transaction_id, account_id, amount FROM ledger_entries ORDER BY created_at DESC LIMIT 4;
```

`should_be_zero` returning `0` is the live proof of the balanced-ledger
invariant.

## Troubleshooting

- **`Postgres pool initialized` then errors about connection refused** — the
  containers aren't up. Run `npm run infra:up` from the repo root and check
  `docker compose ps` shows both healthy.
- **Port 3001 already in use** — change `API_PORT` in `.env`.
- **`npm install` fails** — make sure you're on Node 20+ (`node --version`).

---

# Async layer (webhooks + reconciliation)

After pulling this version, reinstall to get the new dependencies (Bull,
scheduler), then restart:

```bash
cd apps/api
npm install      # pulls @nestjs/bull, @nestjs/schedule, bull
npm test         # PaymentsService + ReconciliationService suites should pass
npm run start:dev
```

On startup you'll now also see the scheduler initialize. Every 10 seconds a
webhook "pump" runs; every minute a reconciliation sweep runs. You'll see
DEBUG/LOG lines for both in the API terminal.

## What's new

**Webhooks with retry + backoff.** When a payment completes, a webhook event is
created automatically. The retry pump attempts delivery; delivery is simulated
and fails ~30% of the time, so you'll see retries with exponential backoff
(1s, 2s, 4s, 8s...) in the logs. After 6 attempts a webhook is marked `dead`.

- `POST /webhooks` — manually create one (pass `{"payload":{"force_fail":true}}`
  to force it down the failure/backoff path)
- `GET /webhooks` — list recent webhooks with their attempt counts and status

**Reconciliation.** Sweeps the ledger for (a) transactions whose entries don't
net to zero and (b) completed transactions with no entries.

- `POST /reconciliation/run` — run a sweep now, returns mismatches
- `GET /reconciliation/runs` — recent run history

## Demo: prove mismatch detection works

```bash
# 1. inject a deliberately broken (unbalanced) transaction
bash scripts/inject-mismatch.sh

# 2. run reconciliation — it will report mismatchesFound >= 1
curl -s -X POST http://localhost:3001/reconciliation/run | json_pp

# 3. clean it up
bash scripts/clean-mismatch.sh

# 4. confirm the ledger balances again
curl -s -X POST http://localhost:3001/reconciliation/run | json_pp
```

This is the live, on-screen proof of the "reconciliation mismatch detection"
resume claim.
