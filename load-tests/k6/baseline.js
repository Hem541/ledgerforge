// baseline.js - payment endpoint latency under sustained concurrent load
//   k6 run load-tests/k6/baseline.js
// ramp VUs up/hold/down. each VU submits a unique payment (unique key) so we
// measure the real write path: redis claim -> pg txn -> ledger insert -> webhook
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const created = new Counter('payments_created');

export const options = {
  stages: [
    { duration: '20s', target: 20 },  // ramp to 20
    { duration: '40s', target: 20 },  // hold
    { duration: '10s', target: 0 },   // ramp down
  ],
  thresholds: {
    // fails the run if missed -> benchmark doubles as a gate
    http_req_duration: ['p(95)<250', 'p(99)<500'],
    http_req_failed: ['rate<0.01'], // <1% errors
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3001';

export default function () {
  // unique key per iter => every request is a real new payment
  const key = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${BASE}/payments`,
    JSON.stringify({ amount: Math.floor(Math.random() * 9900) + 100, currency: 'USD' }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
    },
  );

  const ok = check(res, {
    'status is 201': (r) => r.status === 201,
    'body has completed status': (r) => r.body && r.body.includes('completed'),
  });
  if (ok) created.add(1);
}
