# verify reconciliation detection queries + webhook backoff math (sqlite + arithmetic)
import sqlite3, sys

con = sqlite3.connect(":memory:")
cur = con.cursor()
cur.executescript("""
CREATE TABLE transactions (id TEXT PRIMARY KEY, status TEXT);
CREATE TABLE ledger_entries (id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT, account_id TEXT, amount INTEGER);
""")

# A balanced, completed txn.
cur.execute("INSERT INTO transactions VALUES ('t-ok','completed')")
cur.executescript("""
INSERT INTO ledger_entries (transaction_id,account_id,amount) VALUES ('t-ok','CASH',5000);
INSERT INTO ledger_entries (transaction_id,account_id,amount) VALUES ('t-ok','REV',-5000);
""")
# An UNBALANCED completed txn (the injected-corruption case): +1000.
cur.execute("INSERT INTO transactions VALUES ('t-bad','completed')")
cur.executescript("""
INSERT INTO ledger_entries (transaction_id,account_id,amount) VALUES ('t-bad','CASH',5000);
INSERT INTO ledger_entries (transaction_id,account_id,amount) VALUES ('t-bad','REV',-4000);
""")
# A completed txn with NO entries (status/ledger disagreement).
cur.execute("INSERT INTO transactions VALUES ('t-empty','completed')")
con.commit()

passed = failed = 0
def check(name, cond, extra=""):
    global passed, failed
    if cond: print(f"  PASS: {name}"); passed += 1
    else: print(f"  FAIL: {name} {extra}"); failed += 1

print("="*60); print("RECONCILIATION CHECK 1: detect unbalanced transactions"); print("="*60)
# Same query the service runs: group by txn, HAVING sum <> 0.
unbalanced = cur.execute("""
    SELECT t.id, COALESCE(SUM(le.amount),0) AS s, t.status
      FROM transactions t
      LEFT JOIN ledger_entries le ON le.transaction_id = t.id
     GROUP BY t.id, t.status
    HAVING COALESCE(SUM(le.amount),0) <> 0
""").fetchall()
ids = [r[0] for r in unbalanced]
check("finds exactly the unbalanced txn", ids == ['t-bad'], f"got {ids}")
check("reports the correct imbalance amount", unbalanced and unbalanced[0][1] == 1000,
      f"got {unbalanced[0][1] if unbalanced else None}")

print()
print("="*60); print("RECONCILIATION CHECK 2: detect completed txns with no entries"); print("="*60)
empty = cur.execute("""
    SELECT t.id, t.status, COUNT(le.id) AS c
      FROM transactions t
      LEFT JOIN ledger_entries le ON le.transaction_id = t.id
     WHERE t.status = 'completed'
     GROUP BY t.id, t.status
    HAVING COUNT(le.id) = 0
""").fetchall()
eids = [r[0] for r in empty]
check("finds exactly the empty completed txn", eids == ['t-empty'], f"got {eids}")

print()
print("="*60); print("RECONCILIATION CHECK 3: a clean ledger reports no mismatches"); print("="*60)
# Remove the two bad txns; only t-ok remains.
cur.execute("DELETE FROM transactions WHERE id IN ('t-bad','t-empty')")
cur.execute("DELETE FROM ledger_entries WHERE transaction_id IN ('t-bad','t-empty')")
con.commit()
unbalanced2 = cur.execute("""
    SELECT t.id FROM transactions t
      LEFT JOIN ledger_entries le ON le.transaction_id = t.id
     GROUP BY t.id HAVING COALESCE(SUM(le.amount),0) <> 0
""").fetchall()
check("no unbalanced txns remain", len(unbalanced2) == 0, f"got {unbalanced2}")

print()
print("="*60); print("WEBHOOK BACKOFF: exponential schedule base*2^(n-1)"); print("="*60)
base = 1000
expected = [1000, 2000, 4000, 8000, 16000, 32000]  # attempts 1..6
actual = [base * (2 ** (n-1)) for n in range(1, 7)]
check("backoff schedule matches 1s,2s,4s,8s,16s,32s", actual == expected, f"got {actual}")
# After max attempts (6), the 7th would exceed -> mark dead.
max_attempts = 6
def next_state(attempt):
    return 'dead' if attempt >= max_attempts else 'failed'
check("attempt 6 -> dead", next_state(6) == 'dead')
check("attempt 5 -> failed (still retrying)", next_state(5) == 'failed')
check("attempt 1 -> failed", next_state(1) == 'failed')

print()
print("="*60)
print(f"RESULT: {passed} passed, {failed} failed")
print("="*60)
sys.exit(0 if failed == 0 else 1)
