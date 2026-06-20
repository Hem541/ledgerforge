// Typed client for the LedgerForge API. All calls go through /api/* which
// Next.js proxies to the NestJS backend on :3001 (see next.config.js).

export interface Payment {
  id: string;
  status: string;
  amount: number;
  currency: string;
}

export interface AccountBalance {
  id: string;
  name: string;
  type: string;
  balance: number;
}

export interface WebhookEvent {
  id: string;
  transaction_id: string | null;
  event_type: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
}

export interface ReconciliationRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  transactions_checked: number;
  mismatches_found: number;
  status: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

export const api = {
  health: () => get<{ status: string; db: string; redis: string }>('/health'),

  listPayments: () => get<Payment[]>('/payments'),
  getPayment: (id: string) => get<Payment>(`/payments/${id}`),
  createPayment: (idempotencyKey: string, amount: number, currency = 'USD') =>
    fetch('/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ amount, currency }),
    }).then((r) => r.json()),

  balances: () => get<AccountBalance[]>('/accounts/balances'),

  listWebhooks: () => get<WebhookEvent[]>('/webhooks?limit=20'),

  reconciliationRuns: () =>
    get<ReconciliationRun[]>('/reconciliation/runs?limit=10'),
  runReconciliation: () =>
    post<{
      runId: string;
      transactionsChecked: number;
      mismatchesFound: number;
      mismatches: Array<{
        transactionId: string;
        reason: string;
        entrySum: number;
        status: string;
      }>;
    }>('/reconciliation/run'),
};
