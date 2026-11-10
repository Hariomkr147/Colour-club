import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const data = join(root, 'data', 'postgres');
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const ext = process.platform === 'win32' ? '.exe' : '';
function run(program, args, allowFailure = false) {
  const result = spawnSync(join(bin, program + ext), args, { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: args.includes('start') ? 'ignore' : 'pipe' });
  if (result.error) throw result.error;
  if (result.status && !allowFailure) throw new Error(result.stderr || result.stdout);
  return result;
}
mkdirSync(join(root, 'data'), { recursive: true });
if (!existsSync(join(data, 'PG_VERSION'))) {
  if (existsSync(join(root, '.env'))) throw new Error('Existing .env found. Configure DATABASE_URL explicitly instead of overwriting it.');
  const password = randomBytes(32).toString('hex');
  const passwordFile = join(root, 'data', 'init-password');
  writeFileSync(passwordFile, password, { mode: 0o600 });
  try { run('initdb', ['-D', data, '-U', 'colour_owner', '--pwfile', passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']); }
  finally { unlinkSync(passwordFile); }
  writeFileSync(join(root, '.env'), `DATABASE_URL=postgresql://colour_owner:${password}@127.0.0.1:55432/postgres\nAPP_ORIGIN=http://127.0.0.1:3000\n`, { mode: 0o600 });
}
if (run('pg_ctl', ['-D', data, 'status'], true).status !== 0) {
  run('pg_ctl', ['-D', data, '-l', join(root, 'data', 'postgres.log'), '-o', '-p 55432 -h 127.0.0.1', '-w', 'start']);
}
console.log('Project PostgreSQL is running on localhost:55432. Credentials are stored only in .env.');
