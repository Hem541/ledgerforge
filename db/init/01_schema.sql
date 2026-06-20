-- ledgerforge schema
-- runs once on first container start (docker-entrypoint-initdb.d, alphabetical)
-- double-entry ledger: every money movement = balanced entries, debits == credits

-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- accounts
-- money always moves between accounts. balance is derived (sum of entries),
-- never a stored column, so it can't drift from history
CREATE TABLE accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    -- asset/expense increase w/ debits; liability/equity/revenue w/ credits
    type        TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
    currency    CHAR(3) NOT NULL DEFAULT 'USD',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- transactions
-- business-level event grouping the entries that net to zero.
-- idempotency_key UNIQUE = dup-charge prevention. redis is fast path,
-- this unique constraint is the safety net (final arbiter if redis misses)
CREATE TABLE transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key  TEXT NOT NULL UNIQUE,
    amount           BIGINT NOT NULL CHECK (amount > 0),  -- cents, never floats
    currency         CHAR(3) NOT NULL DEFAULT 'USD',
    status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','completed','failed')),
    metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- bigint cents: float can't hold 0.10 exactly. int caps ~$21M, bigint ~$92Q

-- ledger_entries
-- the double-entry rows. >=2 per txn, sum to zero. debit positive, credit negative
CREATE TABLE ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    -- positive = debit, negative = credit. sum per txn MUST be 0
    amount          BIGINT NOT NULL,
    currency        CHAR(3) NOT NULL DEFAULT 'USD',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- entries for a txn
CREATE INDEX idx_ledger_entries_txn ON ledger_entries(transaction_id);
-- account balance sum
CREATE INDEX idx_ledger_entries_account ON ledger_entries(account_id);

-- webhook_events
-- simulated processor callbacks. arrive late/out of order/fail. per-attempt
-- state so the retry worker can back off exponentially
CREATE TABLE webhook_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID REFERENCES transactions(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,           -- e.g. 'payment.succeeded'
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','delivered','failed','dead')),
    attempts        INT NOT NULL DEFAULT 0,
    -- next retry allowed (backoff pushes this forward)
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_retry ON webhook_events(status, next_attempt_at);

-- audit_log
-- append-only (no update/delete in app code) record of money/state mutations
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    entity_type TEXT NOT NULL,    -- 'transaction', 'webhook', 'ledger_entry'
    entity_id   UUID,
    action      TEXT NOT NULL,    -- 'created', 'completed', 'failed', 'retried'
    detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- reconciliation_runs
-- one row per sweep: txns checked + mismatches found.
-- mismatch = entries don't net to zero, or status disagrees with entries
CREATE TABLE reconciliation_runs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at        TIMESTAMPTZ,
    transactions_checked INT NOT NULL DEFAULT 0,
    mismatches_found     INT NOT NULL DEFAULT 0,
    report_location      TEXT,   -- s3 key for full report when uploaded
    status             TEXT NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running','completed','failed'))
);

-- balance-enforcement trigger
-- db-level guard: a txn's entries must sum to exactly zero. app can have bugs
-- or be bypassed by scripts; the constraint is the one place the rule can't skip
CREATE OR REPLACE FUNCTION check_transaction_balanced()
RETURNS TRIGGER AS $$
DECLARE
    entry_sum BIGINT;
BEGIN
    SELECT COALESCE(SUM(amount), 0)
      INTO entry_sum
      FROM ledger_entries
     WHERE transaction_id = NEW.transaction_id;

    IF entry_sum <> 0 THEN
        RAISE EXCEPTION
            'Ledger entries for transaction % do not balance: sum=%',
            NEW.transaction_id, entry_sum;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- deferrable + fires at commit: debit and credit insert one at a time, so the
-- sum is non-zero mid-insert. defer to commit, then check the full set once
CREATE CONSTRAINT TRIGGER trg_transaction_balanced
    AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION check_transaction_balanced();
