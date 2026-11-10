import { DatabaseSync } from 'node:sqlite';
import { RULES, chooseResult, payout, roundAt, validateBet } from './game.mjs';

export function createStore(path) {
  // shortcut: synchronous SQLite is for one local process, migrate to PostgreSQL before public multi-instance hosting.
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password TEXT NOT NULL, salt TEXT NOT NULL, balance INTEGER NOT NULL CHECK(balance>=0), created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY, room INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
      lock INTEGER NOT NULL, version TEXT NOT NULL, result INTEGER CHECK(result BETWEEN 0 AND 9), audit TEXT);
    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), round_id TEXT NOT NULL REFERENCES rounds(id),
      request_key TEXT NOT NULL, selection TEXT NOT NULL, stake INTEGER NOT NULL CHECK(stake>0),
      payout INTEGER CHECK(payout>=0), created INTEGER NOT NULL, UNIQUE(user_id,request_key));
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), reference TEXT NOT NULL UNIQUE,
      amount INTEGER NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS bets_round ON bets(round_id);
    CREATE INDEX IF NOT EXISTS bets_user ON bets(user_id,id DESC);
    CREATE INDEX IF NOT EXISTS rounds_history ON rounds(room,start DESC);
    CREATE INDEX IF NOT EXISTS rounds_unsettled ON rounds(end) WHERE result IS NULL;
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id,id DESC);`);
  for (const [table, columns] of Object.entries({users: {role: "TEXT NOT NULL DEFAULT 'player'", blocked: 'INTEGER NOT NULL DEFAULT 0', verified: 'INTEGER NOT NULL DEFAULT 0'}, sessions: {created: 'INTEGER NOT NULL DEFAULT 0', admin_until: 'INTEGER NOT NULL DEFAULT 0'}})) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const [name, type] of Object.entries(columns)) if (!existing.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function register(email, name, password, salt, now = Date.now()) {
    // shortcut: the grant is unique per email account, add verified identity and abuse controls before real customer onboarding.
    return transaction(() => {
      if (get('SELECT id FROM users WHERE email=?', email)) throw new Error('This email is already registered. Sign in instead.');
      const id = Number(run('INSERT INTO users(email,name,password,salt,balance,created) VALUES(?,?,?,?,?,?)', email, name, password, salt, RULES.welcomePoints * 100, now).lastInsertRowid);
      run('INSERT INTO ledger(user_id,reference,amount,kind,created) VALUES(?,?,?,?,?)', id, `welcome:${id}`, RULES.welcomePoints * 100, 'WELCOME', now);
      return id;
    });
  }
  function settle(round, now) {
    if (round.version !== RULES.version) throw new Error(`Unsupported rules for round ${round.id}`);
    const bets = all('SELECT * FROM bets WHERE round_id=?', round.id);
    const audit = chooseResult(bets);
    for (const bet of bets) {
      const returned = payout(bet.selection, bet.stake, audit.result);
      run('UPDATE bets SET payout=? WHERE id=?', returned, bet.id);
      if (returned) {
        run('UPDATE users SET balance=balance+? WHERE id=?', returned, bet.user_id);
        run('INSERT INTO ledger(user_id,reference,amount,kind,created) VALUES(?,?,?,?,?)', bet.user_id, `win:${bet.id}`, returned, 'RETURN', now);
      }
    }
    run('UPDATE rounds SET result=?,audit=? WHERE id=?', audit.result, JSON.stringify(audit), round.id);
  }
  function tick(now = Date.now()) {
    transaction(() => {
      for (const round of all('SELECT * FROM rounds WHERE result IS NULL AND end<=? ORDER BY end', now)) settle(round, now);
      for (const room of RULES.rooms) {
        const r = roundAt(room, now);
        run('INSERT OR IGNORE INTO rounds(id,room,start,end,lock,version) VALUES(?,?,?,?,?,?)', r.id, room, r.start, r.end, r.lock, RULES.version);
      }
      run('DELETE FROM sessions WHERE expires<=?', now);
    });
  }
  function place(userId, input, now = Date.now()) {
    return transaction(() => {
      if (typeof input.key !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.key)) throw new Error('A valid request identifier is required.');
      const old = get('SELECT * FROM bets WHERE user_id=? AND request_key=?', userId, input.key);
      const stake = validateBet(input);
      if (old) {
        if (old.round_id !== input.round || old.selection !== input.selection || old.stake !== stake) throw new Error('This request identifier was used for a different prediction.');
        return old;
      }
      const round = typeof input.round === 'string' && get('SELECT * FROM rounds WHERE id=?', input.round);
      if (!round || now < round.start || now >= round.lock || round.result !== null) throw new Error('This round is locked. Please wait for the next round.');
      const previous = all('SELECT selection FROM bets WHERE user_id=? AND round_id=?', userId, round.id);
      if (previous.length >= 100) throw new Error('Maximum 100 predictions per player per round.');
      validateBet(input, previous);
      const debit = run('UPDATE users SET balance=balance-? WHERE id=? AND balance>=?', stake, userId, stake);
      if (debit.changes !== 1) throw new Error('Not enough points for this prediction.');
      const id = Number(run('INSERT INTO bets(user_id,round_id,request_key,selection,stake,created) VALUES(?,?,?,?,?,?)', userId, round.id, input.key, input.selection, stake, now).lastInsertRowid);
      run('INSERT INTO ledger(user_id,reference,amount,kind,created) VALUES(?,?,?,?,?)', userId, `stake:${id}`, -stake, 'STAKE', now);
      return get('SELECT * FROM bets WHERE id=?', id);
    });
  }
  function state(room, userId, now = Date.now()) {
    const current = roundAt(room, now);
    if (!get('SELECT id FROM rounds WHERE id=?', current.id)) tick(now);
    const user = userId ? get('SELECT id,name,email,balance FROM users WHERE id=?', userId) : null;
    const history = all('SELECT id,start,result FROM rounds WHERE room=? AND result IS NOT NULL ORDER BY start DESC LIMIT 20', room);
    const bets = user ? all('SELECT b.*,r.result,r.room FROM bets b JOIN rounds r ON r.id=b.round_id WHERE b.user_id=? ORDER BY b.id DESC LIMIT 100', user.id) : [];
    const ledger = user ? all('SELECT id,amount,kind,created FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 30', user.id) : [];
    const pool = get('SELECT COALESCE(SUM(stake),0) AS stake,COUNT(*) AS count FROM bets WHERE round_id=?', current.id);
    return { rules: RULES, now, round: current, user, history, bets, ledger, pool };
  }
  return { db, run, get, all, transaction, register, tick, place, state, close: () => db.close() };
}
