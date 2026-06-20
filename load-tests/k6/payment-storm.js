// payment-storm.js - dup-charge prevention under a retry storm
//   k6 run load-tests/k6/payment-storm.js
// many VUs hammer the SAME small pool of keys concurrently. correct system
// creates each payment exactly once. assert: only 201 (original/replay) or 409,
// never a second distinct id. distinct txns in db == key pool size, not # requests
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const replays = new Counter('idempotent_replays');
const conflicts = new Counter('conflicts_409');
const firstWrites = new Counter('first_writes_201_new');

export const options = {
  scenarios: {
    storm: {
      executor: 'constant-vus',
      vus: 50,          // 50 concurrent clients
      duration: '30s',  // hammer the same small key pool
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{expected_response:true}': ['p(95)<400'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
// tiny pool so thousands of requests collide
const KEY_POOL_SIZE = 20;

export default function () {
  // one of a small shared set => heavy collision
  const keyId = Math.floor(Math.random() * KEY_POOL_SIZE);
  const key = `storm-key-${keyId}`;

  const res = http.post(
    `${BASE}/payments`,
    JSON.stringify({ amount: 5000, currency: 'USD' }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
    },
  );

  check(res, {
    'no server error': (r) => r.status < 500,
    'is 201 or 409': (r) => r.status === 201 || r.status === 409,
  });

  if (res.status === 409) {
    conflicts.add(1);
  } else if (res.status === 201) {
    if (res.body && res.body.includes('idempotent_replay')) {
      replays.add(1);
    } else {
      firstWrites.add(1);
    }
  }
}

export function handleSummary(data) {
  const replayCount = data.metrics.idempotent_replays?.values?.count || 0;
  const conflictCount = data.metrics.conflicts_409?.values?.count || 0;
  const firstCount = data.metrics.first_writes_201_new?.values?.count || 0;
  const total = replayCount + conflictCount + firstCount;
  return {
    stdout:
      '\n========================================================\n' +
      'RETRY STORM RESULT\n' +
      '========================================================\n' +
      `Total counted responses : ${total}\n` +
      `First writes (new txn)  : ${firstCount}\n` +
      `Idempotent replays      : ${replayCount}\n` +
      `Conflicts (409, in-flt) : ${conflictCount}\n` +
      `\nKey pool size           : ${KEY_POOL_SIZE}\n` +
      'Expectation: distinct transactions in DB == key pool size,\n' +
      'regardless of how many thousands of requests were sent.\n' +
      'Verify in psql:\n' +
      "  SELECT count(*) FROM transactions WHERE idempotency_key LIKE 'storm-key-%';\n" +
      '========================================================\n',
  };
}
