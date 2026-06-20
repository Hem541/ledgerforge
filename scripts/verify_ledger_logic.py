# verify the double-entry balance rule against sqlite (pg uses a deferred
# constraint trigger for the same check)
import sqlite3, uuid, sys

con = sqlite3.connect(":memory:")
con.execute("PRAGMA foreign_keys = ON")
cur = con.cursor()

# Mirror the essential tables (types simplified to SQLite equivalents).
cur.executescript("""
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense'))
);
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE ledger_entries (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    amount INTEGER NOT NULL
);
""")

CASH = '00000000-0000-0000-0000-000000000001'
REV  = '00000000-0000-0000-0000-000000000002'
cur.execute("INSERT INTO accounts VALUES (?,?,?)", (CASH, 'Cash', 'asset'))
cur.execute("INSERT INTO accounts VALUES (?,?,?)", (REV, 'Payment Revenue', 'revenue'))

def post_payment(idem_key, amount_cents, entries):
    """Insert a transaction + its entries, then enforce the balance invariant
    (the deferred-commit-time check the Postgres trigger does)."""
    txn_id = str(uuid.uuid4())
    cur.execute("INSERT INTO transactions (id, idempotency_key, amount) VALUES (?,?,?)",
                (txn_id, idem_key, amount_cents))
    for acct, amt in entries:
        cur.execute("INSERT INTO ledger_entries (id, transaction_id, account_id, amount) VALUES (?,?,?,?)",
                    (str(uuid.uuid4()), txn_id, acct, amt))
    # commit-time invariant: entries for this txn must net to zero
    total = cur.execute("SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE transaction_id=?",
                        (txn_id,)).fetchone()[0]
    if total != 0:
        con.rollback()
        raise ValueError(f"UNBALANCED: transaction {txn_id} entries sum to {total}, not 0")
    con.commit()
    return txn_id

print("=" * 60)
print("TEST 1: a balanced $50.00 payment is accepted")
print("=" * 60)
# $50.00 = 5000 cents. Debit cash +5000, credit revenue -5000. Nets to 0.
tid = post_payment("idem-key-001", 5000, [(CASH, 5000), (REV, -5000)])
print(f"  PASS: balanced payment posted, txn={tid[:8]}")

print()
print("=" * 60)
print("TEST 2: an UNBALANCED payment is rejected")
print("=" * 60)
# Debit cash +5000 but only credit revenue -4000. Sums to +1000. Must fail.
try:
    post_payment("idem-key-002", 5000, [(CASH, 5000), (REV, -4000)])
    print("  FAIL: unbalanced payment was wrongly accepted!")
    sys.exit(1)
except ValueError as e:
    print(f"  PASS: rejected as expected -> {e}")

print()
print("=" * 60)
print("TEST 3: duplicate idempotency key is rejected")
print("=" * 60)
# Reusing idem-key-001 must violate the UNIQUE constraint (duplicate charge).
try:
    post_payment("idem-key-001", 5000, [(CASH, 5000), (REV, -5000)])
    print("  FAIL: duplicate idempotency key was wrongly accepted!")
    sys.exit(1)
except sqlite3.IntegrityError as e:
    print(f"  PASS: duplicate charge blocked by UNIQUE constraint -> {e}")
    con.rollback()

print()
print("=" * 60)
print("TEST 4: global ledger invariant holds across all transactions")
print("=" * 60)
# Post several more valid payments, then assert SUM of ALL entries == 0.
post_payment("idem-key-003", 1200, [(CASH, 1200), (REV, -1200)])
post_payment("idem-key-004", 99,   [(CASH, 99),   (REV, -99)])
post_payment("idem-key-005", 7500, [(CASH, 7500), (REV, -7500)])
grand_total = cur.execute("SELECT COALESCE(SUM(amount),0) FROM ledger_entries").fetchone()[0]
txn_count = cur.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
print(f"  transactions posted: {txn_count}")
print(f"  sum of ALL ledger entries: {grand_total}")
if grand_total == 0:
    print("  PASS: 100% balanced ledger invariant holds")
else:
    print(f"  FAIL: ledger out of balance by {grand_total}")
    sys.exit(1)

# Show derived account balances (this is how balances are computed — no stored column)
print()
print("Derived account balances (summed from entries, never stored):")
for acct_id, name in [(CASH,'Cash'), (REV,'Payment Revenue')]:
    bal = cur.execute("SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE account_id=?",
                      (acct_id,)).fetchone()[0]
    print(f"  {name:18} {bal:>8} cents  (${bal/100:,.2f})")

print()
print("ALL TESTS PASSED")
