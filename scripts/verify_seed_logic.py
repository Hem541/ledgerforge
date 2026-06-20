# verify seed strategy at small scale: N txns -> 2N entries, every txn balances,
# global sum zero. pg version uses generate_series at 1M
import sqlite3, sys

con = sqlite3.connect(":memory:")
cur = con.cursor()
cur.executescript("""
CREATE TABLE transactions (id INTEGER PRIMARY KEY, idempotency_key TEXT UNIQUE,
    amount INTEGER, status TEXT);
CREATE TABLE ledger_entries (id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER, account_id TEXT, amount INTEGER);
""")

N = 10000  # stand-in for 1,000,000

# 1) bulk insert transactions (SQLite analog of generate_series)
cur.executescript(f"""
WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < {N})
INSERT INTO transactions (id, idempotency_key, amount, status)
SELECT n, 'seed-' || n, (abs(random()) % 99901) + 100, 'completed' FROM seq;
""")

# 2) the balanced entry pair per txn
cur.execute("""INSERT INTO ledger_entries (transaction_id, account_id, amount)
               SELECT id, 'CASH', amount FROM transactions WHERE idempotency_key LIKE 'seed-%'""")
cur.execute("""INSERT INTO ledger_entries (transaction_id, account_id, amount)
               SELECT id, 'REV', -amount FROM transactions WHERE idempotency_key LIKE 'seed-%'""")
con.commit()

passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: print(f"  PASS: {name}"); passed += 1
    else: print(f"  FAIL: {name} {extra}"); failed += 1

txns = cur.execute("SELECT count(*) FROM transactions").fetchone()[0]
entries = cur.execute("SELECT count(*) FROM ledger_entries").fetchone()[0]
net = cur.execute("SELECT COALESCE(SUM(amount),0) FROM ledger_entries").fetchone()[0]

print(f"Seeded {txns} transactions, {entries} entries")
check(f"transaction count == {N}", txns == N, f"got {txns}")
check(f"entry count == 2*{N}", entries == 2*N, f"got {entries}")
check("global ledger sum == 0", net == 0, f"got {net}")

# every individual transaction must net to zero
bad = cur.execute("""
    SELECT count(*) FROM (
        SELECT transaction_id, SUM(amount) s FROM ledger_entries
        GROUP BY transaction_id HAVING SUM(amount) <> 0
    )""").fetchone()[0]
check("zero individually-unbalanced transactions", bad == 0, f"got {bad} unbalanced")

# amounts in expected range
rng = cur.execute("SELECT min(amount), max(amount) FROM transactions").fetchone()
check("amounts within 100..100000 cents", rng[0] >= 100 and rng[1] <= 100000, f"got {rng}")

print(f"\nRESULT: {passed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
