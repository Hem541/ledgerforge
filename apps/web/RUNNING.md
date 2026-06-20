# Running the dashboard

The dashboard is a Next.js app in `apps/web`. It talks to the NestJS API
(which must be running on :3001) through a proxy, so you run both at once.

## 1. Install dependencies

From the repo root:

```bash
cd apps/web
npm install
```

## 2. Make sure the API and infra are running

You need THREE things up:
- Postgres + Redis containers (`npm run infra:up` at repo root)
- The API (`cd apps/api && npm run start:dev`) — leave it running
- (now) the web app

## 3. Start the dashboard

In a new terminal:

```bash
cd apps/web
npm run dev
```

Then open **http://localhost:3000** in your browser.

## What you'll see

- **Balance invariant banner** (top): live proof that Σ debits = Σ credits.
  Shows BALANCED in teal when the ledger nets to zero.
- **Transactions**: every payment, newest first. There's a "Submit payment"
  button — type an amount in cents (5000 = $50) and post one; it appears
  immediately and the balances update.
- **Account balances**: each account's balance, derived by summing ledger
  entries (never stored). Bars scale to the largest balance.
- **Webhook delivery**: webhook events with their status and attempt counts —
  watch them move from pending to delivered (or retry) as the pump runs.
- **Reconciliation**: run history plus a "Run reconciliation now" button.

The page polls every 4 seconds, so background jobs (webhook pump, scheduled
reconciliation) show up live.

## See the invariant break and get caught — on screen

With all three running, in a fourth terminal:

```bash
bash scripts/inject-mismatch.sh
```

Within 4 seconds the banner flips to **IMBALANCE** in red. Click "Run
reconciliation now" and the run table shows a non-zero mismatch count. Then:

```bash
bash scripts/clean-mismatch.sh
```

The banner returns to BALANCED. This is the whole system — write path, ledger,
reconciliation, and dashboard — working together, and it's exactly what to
capture for the README screenshots.

## Troubleshooting

- **Panels empty / health dots red** — the API isn't running on :3001. Start
  it in `apps/api` with `npm run start:dev`.
- **Port 3000 in use** — change the port: `next dev -p 3002`.
- **`npm install` slow** — Next.js pulls a lot the first time; it's normal.
