import pg from 'pg';
import { readFileSync } from 'node:fs';
import { RULES, chooseResult, payout, roundAt, validateBet } from './game.mjs';

pg.types.setTypeParser(20, value => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('Point total exceeds the supported accounting range.');
  return number;
});
const error = (message, status = 400) => Object.assign(new Error(message), { status });
export async function createPgStore(connectionString, { schema = process.env.DATABASE_SCHEMA || 'public', clock = Date.now } = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema.');
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 10000,
    // Session poolers can ignore startup options; initialise each session before it is lent out.
    onConnect: client => client.query(`SET search_path TO ${schema}; SET statement_timeout TO 15000; SET lock_timeout TO 5000`) });
  pool.on('error', err => console.error('Database connection interrupted:', err.code));
  const sql = (client, text, args) => { let i = 0; return client.query(text.replace(/\?/g, () => `$${++i}`), args); };
  const access = client => ({
    run: async (text, ...args) => { const r = await sql(client, text, args); return { changes: r.rowCount, rows: r.rows }; },
    get: async (text, ...args) => (await sql(client, text, args)).rows[0],
    all: async (text, ...args) => (await sql(client, text, args)).rows,
  });
  const q = access(pool);
  async function transaction(fn) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const value = await fn(access(client)); await client.query('COMMIT'); return value; }
    catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  }
  await transaction(async t => {
    await t.run('SELECT pg_advisory_xact_lock(7421901)');
    await t.run('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    if (!await t.get('SELECT version FROM schema_migrations WHERE version=1')) {
      await t.run(readFileSync(new URL('./migrations/001.sql', import.meta.url), 'utf8'));
      await t.run('INSERT INTO schema_migrations(version) VALUES(1)');
    }
  });
  async function register(email, name, password, salt, now = clock()) {
    return transaction(async t => {
      const user = await t.get('INSERT INTO users(email,name,password,salt,balance,created) VALUES(?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING RETURNING id', email, name, password, salt, RULES.welcomePoints * 100, now);
      if (!user) throw error('This email is already registered. Sign in instead.');
      await t.run('INSERT INTO ledger(user_id,reference,amount,kind,created) VALUES(?,?,?,?,?)', user.id, `welcome:${user.id}`, RULES.welcomePoints * 100, 'WELCOME', now);
      return user.id;
    });
  }
  async function tick(now = clock()) {
    await transaction(async t => {
      for (const room of RULES.rooms) {
        const r = roundAt(room, now);
        await t.run('INSERT INTO rounds(id,room,start,"end",lock,version) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING', r.id, room, r.start, r.end, r.lock, RULES.version);
      }
    });
    // Each round commits separately so recovery is bounded and workers can share settlement work.
    while (true) {
      const settled = await transaction(async t => {
        const r = await t.get('SELECT * FROM rounds WHERE result IS NULL AND "end"<=? ORDER BY "end",id LIMIT 1 FOR UPDATE SKIP LOCKED', now);
        if (!r) return false;
        if (r.version !== RULES.version) throw new Error(`Unsupported rules for ${r.id}`);
        const bets = await t.all('SELECT * FROM bets WHERE round_id=? ORDER BY user_id,id', r.id);
        const audit = chooseResult(bets);
        for (const b of bets) {
          const returned = payout(b.selection, b.stake, audit.result);
          await t.run('UPDATE bets SET payout=? WHERE id=?', returned, b.id);
          if (returned) {
            await t.run('UPDATE users SET balance=balance+? WHERE id=?', returned, b.user_id);
            await t.run('INSERT INTO ledger(user_id,reference,amount,kind,created) VALUES(?,?,?,?,?)', b.user_id, `win:${b.id}`, returned, 'RETURN', now);
          }
        }
        await t.run('UPDATE rounds SET result=?,audit=? WHERE id=?', audit.result, JSON.stringify(audit), r.id);
        return true;
      });
      if (!settled) break;
    }
    await q.run('DELETE FROM sessions WHERE expires<=?', now);
    await q.run('DELETE FROM auth_tokens WHERE expires<=?', now);
    await q.run('DELETE FROM rate_limits WHERE expires<=?', now);
  }
  async function place(userId, input) {
    const stake = validateBet(input);
    if (typeof input.key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.key)) throw error('A valid request identifier is required.');
    if (typeof input.round !== 'string') throw error('Choose a valid round.');
    return transaction(async t => {
      const r = await t.get('SELECT * FROM rounds WHERE id=? FOR SHARE', input.round);
      const user = await t.get('SELECT * FROM users WHERE id=? FOR UPDATE', userId);
      if (!user || user.blocked) throw error('Your account is blocked. Contact support.', 403);
      const old = await t.get('SELECT * FROM bets WHERE user_id=? AND request_key=?', userId, input.key);
      if (old) {
        if (old.round_id !== input.round || old.selection !== input.selection || old.stake !== stake) throw error('This request identifier was used for a different prediction.');
        return old;
      }
      // Read time after lock acquisition, never use a timestamp captured before waiting for a wallet lock.
      const now = clock === Date.now ? (await t.get('SELECT (EXTRACT(EPOCH FROM clock_timestamp())*1000)::bigint AS now')).now : clock();
      if (!r || now < r.start || now >= r.lock || r.result !== null) throw error('This round is locked. Please wait for the next round.');
      const previous = await t.all('SELECT selection FROM bets WHERE user_id=? AND round_id=?', userId, r.id);
      if (previous.length >= 100) throw error('Maximum 100 predictions per player per round.');
      validateBet(input, previous);
      const debit = await t.run('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?', stake, userId, stake);
      if (!debit.changes) throw error('Not enough points for this prediction.');
      const b = await t.get('INSERT INTO bets(user_id,round_id,request_key,selection,stake,created) VALUES(?,?,?,?,?,?) RETURNING *', userId, r.id, input.key, input.selection, stake, now);
      await t.run('INSERT INTO ledger(user_id,reference,amount,kind,created) VALUES(?,?,?,?,?)', userId, `stake:${b.id}`, -stake, 'STAKE', now);
      return b;
    });
  }
  async function state(room, userId, now = clock()) {
    const current = roundAt(room, now);
    if (!await q.get('SELECT id FROM rounds WHERE id=?', current.id)) await tick(now);
    return transaction(async t => {
      await t.run('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const user = userId ? await t.get('SELECT id,name,email,balance,role,verified FROM users WHERE id=? AND NOT blocked', userId) : null;
      const history = (await t.all('SELECT id,start,result FROM rounds WHERE room=? AND result IS NOT NULL ORDER BY start DESC LIMIT 20', room));
      const bets = user ? await t.all('SELECT b.*,r.result,r.room FROM bets b JOIN rounds r ON r.id=b.round_id WHERE b.user_id=? ORDER BY b.id DESC LIMIT 100', user.id) : [];
      const ledger = user ? await t.all('SELECT id,amount,kind,created FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30', user.id) : [];
      const pool = await t.get('SELECT COALESCE(SUM(stake),0)::bigint AS stake,COUNT(*)::integer AS count FROM bets WHERE round_id=?', current.id);
      return { rules: RULES, now, round: current, user, history, bets, ledger, pool };
    });
  }
  async function block(actor, target, blocked, reason, now = clock()) {
    return transaction(async t => {
      const admin = await t.get('SELECT role,blocked FROM users WHERE id=? FOR SHARE', actor);
      if (!admin || admin.role !== 'admin' || admin.blocked) throw error('Administrator access required.', 403);
      const user = await t.get('SELECT id,role FROM users WHERE id=? FOR UPDATE', target);
      if (!user) throw error('User not found.', 404);
      if (user.role === 'admin') throw error('Administrator accounts cannot be blocked here.');
      await t.run('UPDATE users SET blocked=?,block_reason=? WHERE id=?', blocked, blocked ? reason : null, target);
      if (blocked) await t.run('DELETE FROM sessions WHERE user_id=?', target);
      await t.run('INSERT INTO admin_events(actor,target,action,reason,created) VALUES(?,?,?,?,?)', actor, target, blocked ? 'BLOCK' : 'UNBLOCK', reason, now);
    });
  }
  let closing;
  return { ...q, transaction, register, tick, place, state, block, pool, close: () => closing ??= pool.end() };
}
