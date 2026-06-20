// verify payment idempotency decision logic by reimplementing the branch
// structure from payments.service.ts against in-memory fakes

class FakeRedis {
  constructor() { this.keys = new Map(); this.resp = new Map(); }
  async claim(key, ttl) {            // SET NX semantics
    if (this.keys.has(`idem:${key}`)) return false;
    this.keys.set(`idem:${key}`, '1');
    return true;
  }
  async getResp(key) { return this.resp.get(`idemresp:${key}`) ?? null; }
  async storeResp(key, v) { this.resp.set(`idemresp:${key}`, v); }
  async release(key) { this.keys.delete(`idem:${key}`); }
}

class FakeDb {
  constructor() { this.txns = new Map(); this.byIdem = new Map(); this.entries = []; this.audit = []; }
  async withTransaction(fn) {
    // emulate BEGIN/COMMIT/ROLLBACK with a snapshot
    const snapshot = {
      txns: new Map(this.txns), byIdem: new Map(this.byIdem),
      entries: [...this.entries], audit: [...this.audit],
    };
    try { return await fn(this); }
    catch (e) {
      this.txns = snapshot.txns; this.byIdem = snapshot.byIdem;
      this.entries = snapshot.entries; this.audit = snapshot.audit;
      throw e;
    }
  }
  insertTxn(idem, amount, currency) {
    if (this.byIdem.has(idem)) { const e = new Error('dup'); e.code = '23505'; throw e; }
    const id = 'txn-' + (this.txns.size + 1);
    this.txns.set(id, { id, idem, amount, currency, status: 'pending' });
    this.byIdem.set(idem, id);
    return id;
  }
  postEntries(txnId, lines) {
    const sum = lines.reduce((a, l) => a + l.amount, 0);
    if (sum !== 0) throw new Error(`unbalanced sum=${sum}`);
    lines.forEach(l => this.entries.push({ txnId, ...l }));
  }
  complete(id) { this.txns.get(id).status = 'completed'; }
  addAudit(id) { this.audit.push({ id, action: 'created' }); }
}

const TTL = 86400;

// The service flow, faithfully reproduced.
async function createPayment(redis, db, idem, dto) {
  // validate
  if (!idem) throw { kind: 'BadRequest', msg: 'idem required' };
  if (!Number.isInteger(dto.amount) || dto.amount <= 0)
    throw { kind: 'BadRequest', msg: 'amount must be positive int' };

  // Step 1: fast path
  const claimed = await redis.claim(idem, TTL);
  if (!claimed) {
    const cached = await redis.getResp(idem);
    if (cached) return { ...cached, idempotent_replay: true };
    throw { kind: 'Conflict', msg: 'in flight' };
  }

  // Step 2: atomic write
  let response;
  try {
    response = await db.withTransaction(async (c) => {
      const id = c.insertTxn(idem, dto.amount, dto.currency ?? 'USD');
      c.postEntries(id, [
        { accountId: 'CASH', amount: dto.amount },
        { accountId: 'REVENUE', amount: -dto.amount },
      ]);
      c.complete(id);
      c.addAudit(id);
      return { id, status: 'completed', amount: dto.amount, currency: dto.currency ?? 'USD' };
    });
  } catch (err) {
    await redis.release(idem);
    if (err.code === '23505') throw { kind: 'Conflict', msg: 'duplicate key' };
    throw err;
  }

  // Step 3: cache
  await redis.storeResp(idem, response);
  return response;
}

// ---- scenarios ----
let pass = 0, fail = 0;
function check(name, cond, detail='') {
  if (cond) { console.log(`  PASS: ${name}`); pass++; }
  else { console.log(`  FAIL: ${name} ${detail}`); fail++; }
}

console.log('='.repeat(60));
console.log('SCENARIO 1: first-time payment writes and caches');
console.log('='.repeat(60));
{
  const r = new FakeRedis(), d = new FakeDb();
  const res = await createPayment(r, d, 'key-1', { amount: 5000 });
  check('returns completed', res.status === 'completed');
  check('one transaction written', d.txns.size === 1);
  check('two balanced entries written', d.entries.length === 2);
  check('entries net to zero', d.entries.reduce((a,e)=>a+e.amount,0) === 0);
  check('audit row written', d.audit.length === 1);
  check('response cached', (await r.getResp('key-1')) !== null);
}

console.log('\n' + '='.repeat(60));
console.log('SCENARIO 2: duplicate after completion replays cached response');
console.log('='.repeat(60));
{
  const r = new FakeRedis(), d = new FakeDb();
  await createPayment(r, d, 'key-1', { amount: 5000 });
  const before = d.txns.size;
  const res2 = await createPayment(r, d, 'key-1', { amount: 5000 });
  check('replay flag set', res2.idempotent_replay === true);
  check('no second transaction', d.txns.size === before);
  check('no extra entries', d.entries.length === 2);
}

console.log('\n' + '='.repeat(60));
console.log('SCENARIO 3: duplicate while original in flight -> Conflict');
console.log('='.repeat(60));
{
  const r = new FakeRedis(), d = new FakeDb();
  await r.claim('key-1', TTL);          // simulate claim taken, no resp cached
  try { await createPayment(r, d, 'key-1', { amount: 5000 }); check('should have thrown', false); }
  catch (e) { check('throws Conflict', e.kind === 'Conflict'); check('nothing written', d.txns.size === 0); }
}

console.log('\n' + '='.repeat(60));
console.log('SCENARIO 4: race past Redis -> DB unique violation -> Conflict + release');
console.log('='.repeat(60));
{
  const r = new FakeRedis(), d = new FakeDb();
  // Pre-existing txn with this idem key already in the DB (the "winner").
  d.byIdem.set('key-1', 'txn-pre');
  // Force Redis to allow the claim (simulating eviction / race).
  try { await createPayment(r, d, 'key-1', { amount: 5000 }); check('should have thrown', false); }
  catch (e) {
    check('throws Conflict', e.kind === 'Conflict');
    check('redis claim released', !r.keys.has('idem:key-1'));
    check('no duplicate txn committed (rolled back)', d.txns.size === 0);
  }
}

console.log('\n' + '='.repeat(60));
console.log('SCENARIO 5: invalid input rejected before any side effect');
console.log('='.repeat(60));
{
  const r = new FakeRedis(), d = new FakeDb();
  try { await createPayment(r, d, 'key-1', { amount: 0 }); check('should have thrown', false); }
  catch (e) {
    check('throws BadRequest', e.kind === 'BadRequest');
    check('redis never touched', r.keys.size === 0);
    check('db never touched', d.txns.size === 0);
  }
}

console.log('\n' + '='.repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(60));
process.exit(fail === 0 ? 0 : 1);
