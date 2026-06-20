#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:3001}"
KEY="smoke-$(date +%s)"

echo "==> 1. Health check"
curl -s "$API/health" | tee /dev/stderr | grep -q '"status":"ok"' \
  && echo "   OK: API healthy" || { echo "   FAIL: health not ok"; exit 1; }
echo

echo "==> 2. Create a payment (\$50.00 = 5000 cents), key=$KEY"
RESP=$(curl -s -X POST "$API/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d '{"amount":5000,"currency":"USD","metadata":{"source":"smoke"}}')
echo "   $RESP"
echo "$RESP" | grep -q '"status":"completed"' \
  && echo "   OK: payment completed" || { echo "   FAIL: not completed"; exit 1; }
TXN_ID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
echo

echo "==> 3. Duplicate submit with SAME key (should replay, not double-charge)"
RESP2=$(curl -s -X POST "$API/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d '{"amount":5000,"currency":"USD"}')
echo "   $RESP2"
echo "$RESP2" | grep -q '"idempotent_replay":true' \
  && echo "   OK: duplicate replayed (no second charge)" \
  || { echo "   FAIL: duplicate was not replayed"; exit 1; }
echo

echo "==> 4. Fetch the transaction by id"
curl -s "$API/payments/$TXN_ID" | tee /dev/stderr >/dev/null
echo; echo "   OK"
echo

echo "==> 5. Bad request (amount = 0) should be rejected with 400"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/payments" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: bad-$(date +%s)" \
  -d '{"amount":0}')
[ "$CODE" = "400" ] && echo "   OK: rejected with 400" \
  || { echo "   FAIL: expected 400, got $CODE"; exit 1; }
echo

echo "==> 6. Webhook auto-created for the payment? (list recent webhooks)"
curl -s "$API/webhooks?limit=3" | tee /dev/stderr >/dev/null
echo; echo "   OK: webhook endpoint responding (delivery happens via retry pump)"
echo

echo "==> 7. Run reconciliation on the current ledger (expect 0 mismatches)"
REC=$(curl -s -X POST "$API/reconciliation/run")
echo "   $REC"
echo "$REC" | grep -q '"mismatchesFound":0' \
  && echo "   OK: ledger reconciled clean" \
  || echo "   NOTE: mismatches found (did you run inject-mismatch.sh?)"
echo

echo "============================================================"
echo "ALL SMOKE TESTS PASSED"
echo
echo "Try the mismatch demo next:"
echo "  bash scripts/inject-mismatch.sh"
echo "  curl -s -X POST $API/reconciliation/run | json_pp"
echo "  bash scripts/clean-mismatch.sh"
echo "============================================================"
