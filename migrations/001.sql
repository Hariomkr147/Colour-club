CREATE TABLE IF NOT EXISTS users (
 id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 password TEXT NOT NULL, salt TEXT NOT NULL,
 balance BIGINT NOT NULL CHECK(balance BETWEEN 0 AND 9007199254740991), created BIGINT NOT NULL,
 role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin')),
 blocked BOOLEAN NOT NULL DEFAULT FALSE, block_reason TEXT,
 verified BOOLEAN NOT NULL DEFAULT FALSE, mfa_secret TEXT, mfa_counter BIGINT NOT NULL DEFAULT -1
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), expires BIGINT NOT NULL,
 created BIGINT NOT NULL DEFAULT 0, admin_until BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rounds (
 id TEXT PRIMARY KEY, room INTEGER NOT NULL CHECK(room IN (30,60,180,300)),
 start BIGINT NOT NULL, "end" BIGINT NOT NULL, lock BIGINT NOT NULL,
 version TEXT NOT NULL, result INTEGER CHECK(result BETWEEN 0 AND 9), audit TEXT,
 UNIQUE(room,start)
);
CREATE TABLE IF NOT EXISTS bets (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), round_id TEXT NOT NULL REFERENCES rounds(id),
 request_key TEXT NOT NULL, selection TEXT NOT NULL CHECK(selection IN ('GREEN','RED','VIOLET','BIG','SMALL','0','1','2','3','4','5','6','7','8','9')),
 stake BIGINT NOT NULL CHECK(stake>0 AND stake<=1000000), payout BIGINT CHECK(payout>=0),
 created BIGINT NOT NULL, UNIQUE(user_id,request_key)
);
CREATE TABLE IF NOT EXISTS ledger (
 id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id), reference TEXT NOT NULL UNIQUE,
 amount BIGINT NOT NULL, kind TEXT NOT NULL, created BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_events (
 id BIGSERIAL PRIMARY KEY, actor BIGINT NOT NULL REFERENCES users(id), target BIGINT REFERENCES users(id),
 action TEXT NOT NULL, reason TEXT NOT NULL, created BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
 token TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('verify','reset')), expires BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS bets_round ON bets(round_id);
CREATE INDEX IF NOT EXISTS bets_user ON bets(user_id,id DESC);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id,id DESC);
CREATE INDEX IF NOT EXISTS rounds_history ON rounds(room,start DESC);
CREATE INDEX IF NOT EXISTS rounds_unsettled ON rounds("end") WHERE result IS NULL;
