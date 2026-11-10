import { createServer } from 'node:http';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStore } from './store.mjs';
import { createPgStore } from './pg-store.mjs';
import { RULES } from './game.mjs';
import nodemailer from 'nodemailer';
import { TOTP } from 'otpauth';

const root = dirname(fileURLToPath(import.meta.url));
const derive = promisify(scrypt);
const digest = token => createHash('sha256').update(token).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sessionAge = 7 * 24 * 60 * 60 * 1000;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
]);

export async function createApp({ dbPath = ':memory:', databaseUrl, dbSchema, clock = Date.now, origin, secure = false, mailer, requireVerification = false, registrationEnabled = true } = {}) {
  const store = databaseUrl ? await createPgStore(databaseUrl, { schema: dbSchema, clock }) : createStore(dbPath);
  const limits = new Map();
  let hashing = 0;
  let healthy = true;
  let ticking;
  async function tick() {
    if (ticking) return ticking;
    ticking = (async () => {
      try { await store.tick(clock()); healthy = true; }
      catch (error) { healthy = false; console.error('Round processing failed:', error.message); }
    })();
    try { await ticking; } finally { ticking = null; }
  }
  await tick();
  const timer = setInterval(tick, 500);
  timer.unref();
  async function rate(key, max, window = 60000) {
    const now = Date.now();
    if (store.pool) {
      const limit = await store.get('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires<=? THEN 1 ELSE rate_limits.count+1 END, expires=CASE WHEN rate_limits.expires<=? THEN ? ELSE rate_limits.expires END RETURNING count', key, now+window, now, now, now+window);
      if (limit.count > max) throw fail('Too many requests. Please wait a minute and try again.', 429);
      return;
    }
    for (const [k, value] of limits) if (value.until <= now) limits.delete(k);
    const current = limits.get(key) || { count: 0, until: now + window };
    if (current.count >= max || limits.size > 10000) throw fail('Too many requests. Please wait a minute and try again.', 429);
    current.count++;
    limits.set(key, current);
  }
  async function hashPassword(password, salt) {
    if (hashing >= 2) throw fail('Sign-in is busy. Please try again in a moment.', 503);
    hashing++;
    try { return await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }); }
    finally { hashing--; }
  }
  function tokenFrom(req) { return /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]; }
  async function userFrom(req) {
    const token = tokenFrom(req);
    return token && (await store.get('SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND NOT u.blocked', digest(token), clock()))?.user_id;
  }
  async function setSession(res, userId, expectedPassword) {
    const token = randomBytes(32).toString('hex');
    if (store.pool) await store.transaction(async t => {
      const user = await t.get('SELECT password,blocked FROM users WHERE id=? FOR SHARE',userId);
      if (!user || user.blocked || user.password!==expectedPassword) throw fail('Account access changed. Please sign in again.',401);
      await t.run('INSERT INTO sessions(token,user_id,expires,created) VALUES(?,?,?,?)',digest(token),userId,clock()+sessionAge,clock());
    });
    else await store.run('INSERT INTO sessions(token,user_id,expires,created) VALUES(?,?,?,?)', digest(token), userId, clock() + sessionAge, clock());
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionAge / 1000}${secure ? '; Secure' : ''}`);
  }
  async function sendToken(user, kind) {
    if (!store.pool || !mailer) return;
    const token = randomBytes(32).toString('hex');
    await store.run('INSERT INTO auth_tokens(token,user_id,kind,expires) VALUES(?,?,?,?)', digest(token), user.id, kind, clock() + (kind === 'reset' ? 1800000 : 86400000));
    const url = `${origin || 'http://127.0.0.1:3000'}/#${kind}=${token}`;
    await mailer({ to: user.email, subject: kind === 'reset' ? 'Reset your Colour Club password' : 'Verify your Colour Club email', text: `${kind === 'reset' ? 'Reset your password' : 'Verify your email'} using this link: ${url}\nIf you did not request this, ignore this email.` });
  }
  async function requireAdmin(req) {
    if (!store.pool) throw fail('Administrator service requires PostgreSQL.', 503);
    const token = tokenFrom(req);
    const session = token && await store.get('SELECT s.*,u.role,u.blocked FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?', digest(token), clock());
    if (!session || session.blocked || session.role !== 'admin') throw fail('Administrator access required.', 403);
    if (session.admin_until <= clock()) throw fail('Verify your authenticator code to open the admin dashboard.', 428);
    return session.user_id;
  }
  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw fail('Request is too large.', 413);
      chunks.push(chunk);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw fail('Send a valid JSON request.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Send a JSON object.');
    return value;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const port = server.address()?.port;
      const allowed = origin ? [new URL(origin).host] : [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowed.includes(req.headers.host)) throw fail('Unrecognised host.', 403);
      const url = new URL(req.url, 'http://localhost');
      const ip = req.socket.remoteAddress;
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        res.writeHead(200, { 'Content-Type': type });
        res.end(readFileSync(join(root, 'public', file)));
        return;
      }
      if (!url.pathname.startsWith('/api/')) throw fail('Page not found.', 404);
      await rate(`all:${ip}`, 3000);
      if (url.pathname === '/api/health' && req.method === 'GET') return json(healthy ? 200 : 503, { ok: healthy });
      if (!healthy) throw fail('Rounds are temporarily paused while the server recovers. Your points are saved.', 503);
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(200, { ...await store.state(Number(url.searchParams.get('room') || 30), await userFrom(req), clock()), registrationEnabled, verificationRequired: requireVerification, emailAvailable: !!mailer });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/admin/')) {
        await requireAdmin(req);
        const page = Number(url.searchParams.get('page') || 1);
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw fail('Invalid page.');
        const offset = (page - 1) * 25;
        if (url.pathname === '/api/admin/overview') {
          const users = await store.get('SELECT COUNT(*)::integer AS total, COUNT(*) FILTER(WHERE blocked)::integer AS blocked, COALESCE(SUM(balance),0)::bigint AS points FROM users');
          const bets = await store.get('SELECT COUNT(*)::integer AS total, COALESCE(SUM(stake),0)::bigint AS staked, COALESCE(SUM(payout),0)::bigint AS returned, COUNT(*) FILTER(WHERE payout IS NULL)::integer AS pending FROM bets');
          const reconciliation = await store.get('SELECT COUNT(*)::integer AS mismatches FROM users u WHERE balance<>(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=u.id)');
          return json(200, { users, bets, reconciliation, healthy, database: 'PostgreSQL', mode: 'points', rules: RULES });
        }
        if (url.pathname === '/api/admin/users') {
          const search = (url.searchParams.get('q') || '').trim().slice(0,100);
          const pattern = `%${search}%`;
          const total = await store.get('SELECT COUNT(*)::integer AS count FROM users WHERE email ILIKE ? OR name ILIKE ?', pattern, pattern);
          const rows = await store.all('SELECT u.id,u.email,u.name,u.role,u.blocked,u.block_reason,u.verified,u.balance,u.created,(SELECT COUNT(*)::integer FROM bets WHERE user_id=u.id) AS bet_count FROM users u WHERE email ILIKE ? OR name ILIKE ? ORDER BY id DESC LIMIT 25 OFFSET ?', pattern, pattern, offset);
          return json(200, { rows, total: total.count, page });
        }
        const detail = /^\/api\/admin\/users\/(\d+)$/.exec(url.pathname);
        if (detail) {
          const user = await store.get('SELECT id,email,name,role,blocked,block_reason,verified,balance,created FROM users WHERE id=?', Number(detail[1]));
          if (!user) throw fail('User not found.',404);
          return json(200, { user, bets: await store.all('SELECT * FROM bets WHERE user_id=? ORDER BY id DESC LIMIT 100', user.id), ledger: await store.all('SELECT * FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 100', user.id) });
        }
        if (url.pathname === '/api/admin/bets') {
          return json(200, { rows: await store.all('SELECT b.*,u.email,r.room,r.result FROM bets b JOIN users u ON u.id=b.user_id JOIN rounds r ON r.id=b.round_id ORDER BY b.id DESC LIMIT 25 OFFSET ?', offset), total: (await store.get('SELECT COUNT(*)::integer AS count FROM bets')).count, page });
        }
        if (url.pathname === '/api/admin/rounds') return json(200, { rows: await store.all('SELECT * FROM rounds ORDER BY start DESC,room LIMIT 25 OFFSET ?', offset), total: (await store.get('SELECT COUNT(*)::integer AS count FROM rounds')).count, page });
        if (url.pathname === '/api/admin/events') return json(200, { rows: await store.all('SELECT e.*,u.email AS actor_email FROM admin_events e JOIN users u ON u.id=e.actor ORDER BY e.id DESC LIMIT 25 OFFSET ?', offset), total: (await store.get('SELECT COUNT(*)::integer AS count FROM admin_events')).count, page });
        throw fail('Endpoint not found.',404);
      }
      if (req.method !== 'POST') throw fail('Endpoint not found.', 404);
      const validOrigins = origin ? [origin] : allowed.map(host => `http://${host}`);
      if (!validOrigins.includes(req.headers.origin)) throw fail('This action must come from the game website.', 403);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('JSON content is required.', 415);
      const input = await body(req);
      if (['/api/register', '/api/login'].includes(url.pathname)) {
        if (url.pathname === '/api/register' && !registrationEnabled) throw fail('New registrations are temporarily unavailable. Please try again later.',503);
        await rate(`auth:${ip}`, 10);
        if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw fail('Enter a valid email address.');
        if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) throw fail('Use a password between 12 and 128 characters.');
        const email = input.email.trim().toLowerCase();
        let userId, expectedPassword;
        if (url.pathname === '/api/register') {
          if (input.accepted !== true) throw fail('Please acknowledge the free-play and house-controlled rules.');
          if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 30) throw fail('Use a display name between 2 and 30 characters.');
          const salt = randomBytes(16).toString('hex');
          const hash = await hashPassword(input.password, salt);
          expectedPassword=hash.toString('hex');
          userId = await store.register(email, input.name.trim(), hash.toString('hex'), salt, clock());
          if (mailer && requireVerification) { try { await sendToken({id:userId,email}, 'verify'); } catch { console.error('Verification delivery failed; player can request another email.'); } }
        } else {
          const user = await store.get('SELECT * FROM users WHERE email=?', email);
          const hash = await hashPassword(input.password, user?.salt || '00000000000000000000000000000000');
          const matches = timingSafeEqual(hash, user ? Buffer.from(user.password, 'hex') : Buffer.alloc(64));
          if (!user || !matches) throw fail('The email or password is incorrect.', 401);
          if (user.blocked) throw fail('Your account is blocked. Contact support.',403);
          userId = user.id;
          expectedPassword=user.password;
        }
        const old = tokenFrom(req);
        if (old) await store.run('DELETE FROM sessions WHERE token=?', digest(old));
        await setSession(res, userId, expectedPassword);
        return json(200, { ok: true });
      }
      if (url.pathname === '/api/forgot-password') {
        if (!mailer) throw fail('Email recovery is temporarily unavailable. Please try again later.',503);
        await rate(`recovery:${ip}`, 5);
        if (typeof input.email !== 'string' || input.email.length>254) throw fail('Enter an email address.');
        const user = await store.get('SELECT id,email FROM users WHERE email=?', input.email.trim().toLowerCase());
        if (user) { try { await sendToken(user,'reset'); } catch { console.error('Password recovery delivery failed.'); } }
        return json(200, {ok:true,message:'If the address is registered, a recovery link will be sent.'});
      }
      if (url.pathname === '/api/reset-password' || url.pathname === '/api/verify-email') {
        if (!store.pool) throw fail('Account recovery requires PostgreSQL.',503);
        await rate(`token:${ip}`, 10);
        if (typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) throw fail('Invalid or expired link.');
        const reset = url.pathname === '/api/reset-password';
        let salt, hash;
        if (reset) {
          if (typeof input.password !== 'string' || input.password.length<12 || input.password.length>128) throw fail('Use a password between 12 and 128 characters.');
          salt = randomBytes(16).toString('hex'); hash = (await hashPassword(input.password,salt)).toString('hex');
        }
        await store.transaction(async t => {
          const candidate = await t.get('SELECT user_id FROM auth_tokens WHERE token=? AND kind=? AND expires>?',digest(input.token),reset?'reset':'verify',clock());
          if (!candidate) throw fail('Invalid or expired link.');
          await t.run('SELECT id FROM users WHERE id=? FOR UPDATE',candidate.user_id);
          const token = await t.get('DELETE FROM auth_tokens WHERE token=? AND kind=? AND expires>? RETURNING user_id', digest(input.token), reset?'reset':'verify', clock());
          if (!token) throw fail('Invalid or expired link.');
          if (reset) { await t.run('UPDATE users SET password=?,salt=? WHERE id=?',hash,salt,token.user_id); await t.run('DELETE FROM sessions WHERE user_id=?',token.user_id); }
          else await t.run('UPDATE users SET verified=TRUE WHERE id=?',token.user_id);
          await t.run('DELETE FROM auth_tokens WHERE user_id=? AND kind=?',token.user_id,reset?'reset':'verify');
        });
        return json(200,{ok:true});
      }
      const userId = await userFrom(req);
      if (!userId) throw fail('Please sign in to continue.', 401);
      if (url.pathname === '/api/logout') {
        await store.run('DELETE FROM sessions WHERE token=?', digest(tokenFrom(req)));
        res.setHeader('Set-Cookie', `session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
        return json(200, { ok: true });
      }
      if (url.pathname === '/api/resend-verification') {
        if (!mailer) throw fail('Verification email is temporarily unavailable. Please try again later.',503);
        await rate(`verify:${userId}`, 2);
        const user = await store.get('SELECT id,email,verified FROM users WHERE id=?',userId);
        if (!user.verified) await sendToken(user,'verify');
        return json(200,{ok:true});
      }
      if (url.pathname === '/api/admin/verify') {
        await rate(`admin:${userId}`, 5);
        const user = await store.get('SELECT * FROM users WHERE id=?',userId);
        if (user.role!=='admin' || !user.mfa_secret || typeof input.code!=='string') throw fail('Administrator authenticator setup is required.',403);
        const totp = new TOTP({secret:user.mfa_secret});
        const delta = totp.validate({token:input.code,timestamp:clock(),window:1,afterCounter:user.mfa_counter});
        if (delta===null) throw fail('Invalid or already used authenticator code.',403);
        const counter = Math.floor(clock()/30000)+delta;
        await store.transaction(async t => {
          const changed = await t.run('UPDATE users SET mfa_counter=? WHERE id=? AND mfa_counter<?', counter,userId,counter);
          if (!changed.changes) throw fail('This authenticator code was already used.',403);
          await t.run('UPDATE sessions SET admin_until=? WHERE token=?',clock()+600000,digest(tokenFrom(req)));
        });
        return json(200,{ok:true});
      }
      const blockMatch = /^\/api\/admin\/users\/(\d+)\/status$/.exec(url.pathname);
      if (blockMatch) {
        const actor = await requireAdmin(req);
        if (typeof input.blocked!=='boolean' || typeof input.reason!=='string' || input.reason.trim().length<5 || input.reason.length>500) throw fail('Provide a reason between 5 and 500 characters.');
        await store.block(actor,Number(blockMatch[1]),input.blocked,input.reason.trim());
        return json(200,{ok:true});
      }
      if (url.pathname === '/api/bets') {
        await rate(`bets:${userId}`, 60);
        if (requireVerification && !(await store.get('SELECT verified FROM users WHERE id=?',userId)).verified) throw fail('Verify your email before placing predictions.',403);
        return json(200, { bet: await store.place(userId, input, clock()) });
      }
      throw fail('Endpoint not found.', 404);
    } catch (error) {
      const internal = error.code || !(error instanceof Error);
      if (internal) console.error('Request failed:', error.message);
      if (!res.headersSent && !res.destroyed) json(internal ? 500 : (error.status || 400), { error: internal ? 'The request could not be completed. Please try again.' : error.message });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let storeClosing;
  function closeStore() {
    clearInterval(timer);
    return storeClosing ??= (async () => { await ticking; await store.close(); })();
  }
  server.on('close', () => { void closeStore(); });
  async function close() { clearInterval(timer); await new Promise(resolve => server.close(resolve)); await closeStore(); }
  return { server, store, tick, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.env.DB_PATH || join(root, 'data', 'colour.db');
  if (!process.env.DATABASE_URL) mkdirSync(dirname(path), { recursive: true });
  const origin = process.env.APP_ORIGIN;
  const secure = origin?.startsWith('https://') || false;
  if (process.env.NODE_ENV === 'production' && !secure) throw new Error('Production requires an HTTPS APP_ORIGIN and a TLS reverse proxy.');
  const production = process.env.NODE_ENV === 'production';
  const registrationEnabled = process.env.REGISTRATION_ENABLED !== 'false';
  const requireVerification = process.env.REQUIRE_VERIFICATION === undefined ? production : process.env.REQUIRE_VERIFICATION === 'true';
  if (production && !process.env.DATABASE_URL) throw new Error('Production requires DATABASE_URL.');
  if (production && registrationEnabled && requireVerification && (!process.env.SMTP_URL || !process.env.MAIL_FROM)) throw new Error('Verified registration requires SMTP_URL and MAIL_FROM. Configure email, pause registration, or explicitly set REQUIRE_VERIFICATION=false.');
  const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  const mailer = transport ? mail => transport.sendMail({ ...mail, from: process.env.MAIL_FROM }) : production ? undefined : async mail => {
    mkdirSync(join(root,'data','mail'),{recursive:true});
    writeFileSync(join(root,'data','mail',`${Date.now()}-${randomBytes(4).toString('hex')}.json`),JSON.stringify(mail,null,2),{mode:0o600});
  };
  const app = await createApp({ dbPath: path, databaseUrl: process.env.DATABASE_URL, origin, secure, mailer, requireVerification, registrationEnabled });
  const port = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Colour Club is running at ${origin || `http://127.0.0.1:${port}`}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
