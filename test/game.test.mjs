import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RULES, choices, colour, payout, chooseResult, roundAt, validateBet } from '../game.mjs';
import { createStore } from '../store.mjs';

test('exclusive colour mapping and every payout for every outcome', () => {
  assert.deepEqual(Array.from({ length: 10 }, (_, n) => colour(n)), ['VIOLET', 'GREEN', 'RED', 'GREEN', 'RED', 'VIOLET', 'RED', 'GREEN', 'RED', 'GREEN']);
  const winners = { GREEN: [1, 3, 7, 9], RED: [2, 4, 6, 8], VIOLET: [0, 5], SMALL: [0, 1, 2, 3, 4], BIG: [5, 6, 7, 8, 9] };
  for (const choice of choices) for (let n = 0; n < 10; n++) {
    const wins = (winners[choice] || [Number(choice)]).includes(n);
    assert.equal(payout(choice, 10000, n), wins ? 10000 * (RULES.returns[choice] || 9) : 0);
  }
  assert.equal(payout('BIG', 100, 9), 190);
});
test('the supplied pool example picks Red and leaves 1500 points', () => {
  const audit = chooseResult([{ selection: 'RED', stake: 100000 }, { selection: 'GREEN', stake: 200000 }, { selection: 'VIOLET', stake: 50000 }], () => 0);
  assert.deepEqual(audit.tied, [2, 4, 6, 8]);
  assert.equal(audit.returned, 200000);
  assert.equal(audit.total - audit.returned, 150000);
});
test('all ten outcomes tie in an empty round; tie selection covers each candidate', () => {
  for (let n = 0; n < 10; n++) assert.equal(chooseResult([], () => n).result, n);
});
test('each bet has average liability at most 95%; mixed portfolios keep the 5% bound', () => {
  for (const selection of choices) {
    const average = Array.from({ length: 10 }, (_, n) => payout(selection, 10000, n)).reduce((a, b) => a + b) / 10;
    assert.ok(average <= 9500);
  }
  for (let i = 0; i < 500; i++) {
    const bets = Array.from({ length: 40 }, () => ({ selection: choices[randomInt(choices.length)], stake: randomInt(1, 10001) * 100 }));
    const result = chooseResult(bets);
    assert.equal(result.payouts[result.result], Math.min(...result.payouts));
    assert.ok(result.returned <= result.total * 0.95);
  }
});
test('number and size exposure can change the minimum-payout result', () => {
  const bets = [{ selection: 'GREEN', stake: 200000 }, { selection: 'RED', stake: 100000 }, { selection: 'VIOLET', stake: 50000 }, ...['2','4','6','8'].map(selection => ({ selection, stake: 100000 }))];
  assert.deepEqual(chooseResult(bets, () => 0).tied, [0, 5]);
});
test('unsafe aggregate point arithmetic fails before choosing a result',()=>{
  assert.throws(()=>chooseResult([{selection:'GREEN',stake:Number.MAX_SAFE_INTEGER}]),/supported accounting range/);
});
test('validation rejects invalid stakes, opposing bets, and an eighth distinct number', () => {
  const base = { selection: 'GREEN', base: 10, multiplier: 1 };
  for (const input of [{ ...base, base: -1 }, { ...base, base: 1.5 }, { ...base, base: '10' }, { ...base, multiplier: 2 }, { ...base, base: 1000, multiplier: 100 }, { ...base, selection: 'blue' }]) assert.throws(() => validateBet(input));
  assert.throws(() => validateBet(base, [{ selection: 'RED' }]), /Red and Green/);
  assert.throws(() => validateBet({ ...base, selection: 'SMALL' }, [{ selection: 'BIG' }]), /Big and Small/);
  const previous = Array.from({ length: 7 }, (_, n) => ({ selection: String(n) }));
  assert.throws(() => validateBet({ ...base, selection: '7' }, previous), /seven/);
  assert.equal(validateBet({ ...base, selection: '0' }, previous), 1000);
});
test('all four rooms have stable UTC-epoch boundaries and five-second locks', () => {
  for (const room of RULES.rooms) {
    const r = roundAt(room, 1890000012345);
    assert.equal(r.end - r.start, room * 1000);
    assert.equal(r.end - r.lock, 5000);
    assert.equal(roundAt(room, r.end).start, r.end);
  }
});

function fixture() {
  const store = createStore(':memory:');
  const now = 1800000000000;
  const user = store.register('test@example.com', 'Test', 'hash', 'salt', now);
  store.tick(now);
  return { store, now, user, round: roundAt(30, now), bet: { key: 'test-request-key-001', selection: 'GREEN', base: 10, multiplier: 1, round: roundAt(30, now).id } };
}
test('a boundary snapshot makes the advertised round ready before the scheduler runs', t => {
  const { store, user, round, bet } = fixture(); t.after(() => store.close());
  const snapshot = store.state(30, user, round.end);
  assert.equal(snapshot.round.start, round.end);
  assert.notEqual(store.get('SELECT result FROM rounds WHERE id=?', round.id).result, null);
  assert.doesNotThrow(() => store.place(user, { ...bet, round: snapshot.round.id }, round.end));
});
test('welcome grant is atomic and unique; duplicate email cannot create another grant', t => {
  const { store, user } = fixture(); t.after(() => store.close());
  assert.equal(store.get('SELECT balance FROM users WHERE id=?', user).balance, 1000000);
  assert.throws(() => store.register('test@example.com', 'Again', 'hash', 'salt'), /already registered/);
  assert.equal(store.get('SELECT COUNT(*) AS count FROM ledger').count, 1);
});
test('idempotent retry debits once, even after lock; altered retry is rejected', t => {
  const { store, user, now, round, bet } = fixture(); t.after(() => store.close());
  const first = store.place(user, bet, now);
  assert.equal(store.place(user, bet, round.end + 1000).id, first.id);
  assert.equal(store.get('SELECT balance FROM users WHERE id=?', user).balance, 999000);
  assert.throws(() => store.place(user, { ...bet, base: 20 }, now), /different prediction/);
});
test('lock boundary, insufficient balance, conflict and stale period do not debit', t => {
  const { store, user, now, round, bet } = fixture(); t.after(() => store.close());
  assert.throws(() => store.place(user, bet, round.lock), /locked/);
  assert.throws(() => store.place(user, bet, round.start - 1), /locked/);
  store.place(user, { ...bet, base: 1000, multiplier: 10 }, now);
  assert.throws(() => store.place(user, { ...bet, key: 'another-request-key' }, now), /Not enough/);
  assert.equal(store.get('SELECT balance FROM users WHERE id=?', user).balance, 0);
  assert.equal(store.get('SELECT COUNT(*) AS count FROM bets').count, 1);
});
test('restrictions accumulate across separate requests and remain isolated per room', t => {
  const { store, user, now, bet } = fixture(); t.after(() => store.close());
  store.place(user, bet, now);
  assert.throws(() => store.place(user, { ...bet, selection: 'RED', key: 'opposing-request-key' }, now), /Red and Green/);
  store.place(user, { ...bet, selection: 'RED', key: 'other-room-request', round: roundAt(60, now).id }, now);
  assert.equal(store.get('SELECT COUNT(*) AS count FROM bets').count, 2);
});
test('settlement is exactly once, includes all liabilities, and balances reconcile', t => {
  const { store, user, now, round, bet } = fixture(); t.after(() => store.close());
  const second = store.register('other@example.com', 'Other', 'hash', 'salt', now);
  store.place(user, { ...bet, base: 100, selection: 'SMALL' }, now);
  store.place(second, { ...bet, base: 100, selection: 'BIG' }, now);
  store.tick(round.end);
  const settled = store.get('SELECT * FROM rounds WHERE id=?', round.id);
  assert.notEqual(settled.result, null);
  assert.equal(JSON.parse(settled.audit).returned, 19000);
  const before = store.all('SELECT * FROM ledger');
  store.tick(round.end + 1000);
  assert.deepEqual(store.all('SELECT * FROM ledger'), before);
  for (const u of store.all('SELECT * FROM users')) assert.equal(u.balance, store.get('SELECT SUM(amount) AS balance FROM ledger WHERE user_id=?', u.id).balance);
  assert.equal(store.get('SELECT COUNT(*) AS count FROM bets WHERE payout IS NULL').count, 0);
});
test('downtime settles pending rounds and starts current rooms without invented history', t => {
  const { store, user, now, round, bet } = fixture(); t.after(() => store.close());
  store.place(user, bet, now);
  store.tick(now + 86400000);
  assert.notEqual(store.get('SELECT result FROM rounds WHERE id=?', round.id).result, null);
  assert.equal(store.get('SELECT COUNT(*) AS count FROM rounds').count, 8);
});
test('a failed ledger write rolls back the wallet debit and bet insertion', t => {
  const { store, user, now, bet } = fixture(); t.after(() => store.close());
  store.db.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON ledger WHEN NEW.kind='STAKE' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(() => store.place(user, bet, now), /injected failure/);
  assert.equal(store.get('SELECT balance FROM users WHERE id=?', user).balance, 1000000);
  assert.equal(store.get('SELECT COUNT(*) AS count FROM bets').count, 0);
});
test('on-disk restart preserves balances and recovers unfinished settlement exactly once', t => {
  const directory = mkdtempSync(join(tmpdir(), 'colour-test-'));
  const path = join(directory, 'restart.db');
  let store = createStore(path);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const now = 1800000000000;
  const id = store.register('restart@example.test', 'Restart', 'hash', 'salt', now);
  store.tick(now);
  store.place(id, { selection: 'VIOLET', base: 100, multiplier: 1, round: roundAt(30, now).id, key: 'restart-request-001' }, now);
  store.close();
  store = createStore(path);
  assert.equal(store.get('SELECT balance FROM users WHERE id=?', id).balance, 990000);
  store.tick(now + 60000);
  const before = store.all('SELECT * FROM ledger');
  store.close();
  store = createStore(path);
  store.tick(now + 60001);
  assert.deepEqual(store.all('SELECT * FROM ledger'), before);
  assert.equal(store.get('SELECT COUNT(*) AS count FROM bets WHERE payout IS NULL').count, 0);
});
