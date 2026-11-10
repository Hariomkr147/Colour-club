import pg from 'pg';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const file=resolve(process.argv[2] || '');
if (!process.argv[2] || !existsSync(file)) throw new Error('Pass the path to a pg_dump custom-format backup.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const original=new URL(process.env.DATABASE_URL);
const control=new pg.Pool({connectionString:original.toString()});
const name=`colour_restore_${randomBytes(6).toString('hex')}`;
assert.match(name,/^colour_restore_[a-f0-9]{12}$/);
await control.query(`CREATE DATABASE ${name}`);
try {
  const program=process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe':'pg_restore';
  const result=spawnSync(program,['--no-owner','--exit-on-error','--dbname',name,file],{env:{...process.env,PGHOST:original.hostname,PGPORT:original.port||'5432',PGUSER:decodeURIComponent(original.username),PGPASSWORD:decodeURIComponent(original.password)},encoding:'utf8',windowsHide:true,timeout:120000});
  if(result.error || result.status) throw new Error(result.error?.message || result.stderr);
  const restored=new URL(original);restored.pathname=`/${name}`;
  const pool=new pg.Pool({connectionString:restored.toString()});
  try {
    const {rows}=await pool.query('SELECT COUNT(*)::integer AS mismatches FROM users u WHERE balance<>(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=u.id)');
    assert.equal(rows[0].mismatches,0,'Restored wallet balances must reconcile to the ledger');
    const counts=(await pool.query('SELECT (SELECT COUNT(*)::integer FROM users) AS users,(SELECT COUNT(*)::integer FROM bets) AS bets')).rows[0];
    console.log(`Restore drill passed: ${counts.users} accounts, ${counts.bets} bets, zero ledger differences. Live database was not changed.`);
  } finally { await pool.end(); }
} finally { await control.query(`DROP DATABASE ${name}`);await control.end(); }
