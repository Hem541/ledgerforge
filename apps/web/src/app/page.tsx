'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  api,
  Payment,
  AccountBalance,
  WebhookEvent,
  ReconciliationRun,
} from '@/lib/api';

function money(cents: number, currency = 'USD') {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

export default function Dashboard() {
  const [health, setHealth] = useState<{ db: string; redis: string } | null>(
    null,
  );
  const [payments, setPayments] = useState<Payment[]>([]);
  const [balances, setBalances] = useState<AccountBalance[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [reconBusy, setReconBusy] = useState(false);
  const [reconResult, setReconResult] = useState<string | null>(null);
  const [amount, setAmount] = useState('5000');
  const [payBusy, setPayBusy] = useState(false);

  const refresh = useCallback(async () => {
    // Each call is independent; a failure in one shouldn't blank the others.
    api.health().then(setHealth).catch(() => setHealth({ db: 'down', redis: 'down' }));
    api.listPayments().then(setPayments).catch(() => {});
    api.balances().then(setBalances).catch(() => {});
    api.listWebhooks().then(setWebhooks).catch(() => {});
    api.reconciliationRuns().then(setRuns).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    // Poll every 4s so the console feels live as background jobs run.
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // The invariant: sum of all account balances must equal zero.
  const ledgerSum = balances.reduce((acc, b) => acc + Number(b.balance), 0);
  const balanced = ledgerSum === 0;

  // For the balance bars, scale against the largest absolute balance.
  const maxAbs = Math.max(1, ...balances.map((b) => Math.abs(Number(b.balance))));

  async function handleRunRecon() {
    setReconBusy(true);
    setReconResult(null);
    try {
      const r = await api.runReconciliation();
      if (r.mismatchesFound === 0) {
        setReconResult(
          `ok::Checked ${r.transactionsChecked} transactions — no mismatches.`,
        );
      } else {
        setReconResult(
          `bad::Found ${r.mismatchesFound} mismatch(es) across ${r.transactionsChecked} transactions.`,
        );
      }
      refresh();
    } catch {
      setReconResult('bad::Reconciliation request failed.');
    } finally {
      setReconBusy(false);
    }
  }

  async function handleCreatePayment() {
    const cents = parseInt(amount, 10);
    if (!Number.isInteger(cents) || cents <= 0) return;
    setPayBusy(true);
    try {
      // Unique idempotency key per click — a real client would reuse one
      // across retries of the SAME logical payment.
      const key = `dash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await api.createPayment(key, cents);
      refresh();
    } finally {
      setPayBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1>
            <span className="glyph">▦</span> LedgerForge
          </h1>
          <div className="sub">Payment ledger · reconciliation console</div>
        </div>
        <div className="health">
          <span className={`dot ${health?.db === 'up' ? 'up' : 'down'}`} />
          postgres
          <span
            className={`dot ${health?.redis === 'up' ? 'up' : 'down'}`}
            style={{ marginLeft: 12 }}
          />
          redis
        </div>
      </header>

      {/* SIGNATURE: the balance invariant, front and center */}
      <div className="invariant">
        <div>
          <div className="label">Ledger balance invariant</div>
          <div className="equation">
            Σ debits <span className="eq">=</span> Σ credits
            <span style={{ color: 'var(--bone-500)', marginLeft: 16 }}>
              net = {money(ledgerSum)}
            </span>
          </div>
        </div>
        <div className="verdict">
          <div className={`state ${balanced ? 'balanced' : 'broken'}`}>
            {balanced ? 'BALANCED' : 'IMBALANCE'}
          </div>
          <div className="note">
            {balanced
              ? 'every transaction nets to zero'
              : 'reconciliation will flag this'}
          </div>
        </div>
      </div>

      <div className="grid">
        {/* PANEL 1: transactions */}
        <div className="panel wide">
          <div className="panel-head">
            <h2>Transactions</h2>
            <div className="controls">
              <input
                className="input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="amount in cents"
              />
              <button
                className="btn"
                onClick={handleCreatePayment}
                disabled={payBusy}
              >
                {payBusy ? 'posting…' : 'Submit payment'}
              </button>
            </div>
          </div>
          <div className="panel-body">
            {payments.length === 0 ? (
              <div className="empty">
                No transactions yet. Submit one to see it post to the ledger.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="id-cell">{shortId(p.id)}</td>
                      <td>
                        <span className={`badge ${p.status}`}>{p.status}</span>
                      </td>
                      <td className="amount">{money(p.amount, p.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* PANEL 2: ledger balances */}
        <div className="panel">
          <div className="panel-head">
            <h2>Account balances</h2>
            <span className="bal-type">derived from entries</span>
          </div>
          <div className="panel-body">
            {balances.length === 0 ? (
              <div className="empty">No accounts loaded.</div>
            ) : (
              balances.map((b) => {
                const val = Number(b.balance);
                const pct = (Math.abs(val) / maxAbs) * 100;
                return (
                  <div className="bal-row" key={b.id}>
                    <div className="bal-head">
                      <div>
                        <span className="bal-name">{b.name}</span>{' '}
                        <span className="bal-type">{b.type}</span>
                      </div>
                      <span
                        className={`bal-value ${val >= 0 ? 'pos' : 'neg'}`}
                      >
                        {money(val)}
                      </span>
                    </div>
                    <div className="bal-bar">
                      <div
                        className="bal-fill"
                        style={{
                          width: `${pct}%`,
                          background:
                            val >= 0 ? 'var(--teal)' : 'var(--brass)',
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANEL 3: webhooks */}
        <div className="panel">
          <div className="panel-head">
            <h2>Webhook delivery</h2>
            <span className="bal-type">retry + backoff</span>
          </div>
          <div className="panel-body">
            {webhooks.length === 0 ? (
              <div className="empty">No webhook events yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((w) => (
                    <tr key={w.id}>
                      <td className="id-cell">{w.event_type}</td>
                      <td>
                        <span className={`badge ${w.status}`}>{w.status}</span>
                      </td>
                      <td className="amount">{w.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* PANEL 4: reconciliation */}
        <div className="panel wide">
          <div className="panel-head">
            <h2>Reconciliation</h2>
            <button
              className="btn ghost"
              onClick={handleRunRecon}
              disabled={reconBusy}
            >
              {reconBusy ? 'running…' : 'Run reconciliation now'}
            </button>
          </div>
          {reconResult && (
            <div className="recon-result">
              <span className={reconResult.startsWith('ok') ? 'ok' : 'bad'}>
                {reconResult.split('::')[1]}
              </span>
            </div>
          )}
          <div className="panel-body">
            {runs.length === 0 ? (
              <div className="empty">
                No reconciliation runs yet. The scheduler sweeps every minute,
                or run one now.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Checked</th>
                    <th>Mismatches</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="id-cell">{shortId(r.id)}</td>
                      <td className="amount">{r.transactions_checked}</td>
                      <td className="amount">
                        <span
                          style={{
                            color:
                              r.mismatches_found > 0
                                ? 'var(--rust)'
                                : 'var(--teal)',
                          }}
                        >
                          {r.mismatches_found}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${r.status}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="foot">
        LedgerForge operations console · polling every 4s · {payments.length}{' '}
        transactions · {runs.length} reconciliation runs recorded
      </div>
    </div>
  );
}
