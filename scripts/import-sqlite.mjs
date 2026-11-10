import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPgStore } from '../pg-store.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const source = resolve(process.argv[2] || 'data/colour.db');
if (!existsSync(source)) throw new Error('The source SQLite database does not exist.');
const sqlite = new DatabaseSync(source,{readOnly:true});
const store = await createPgStore(process.env.DATABASE_URL);
try {
  await store.transaction(async t => {
    if ((await t.get('SELECT COUNT(*)::integer AS count FROM users')).count) throw new Error('Destination already contains users; import refused. Source is unchanged.');
    for (const table of ['users','rounds','bets','ledger']) {
      for (const row of sqlite.prepare(`SELECT * FROM ${table}`).all()) {
        const keys = Object.keys(row).filter(key => !['role','blocked','verified'].includes(key));
        const names = keys.map(key=>`"${key}"`).join(',');
        await t.run(`INSERT INTO ${table}(${names}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(key=>row[key]));
      }
    }
    for (const table of ['users','bets','ledger']) await t.run(`SELECT setval(pg_get_serial_sequence('${table}','id'),COALESCE(MAX(id),1),COUNT(*)>0) FROM ${table}`);
    const mismatch = await t.get('SELECT COUNT(*)::integer AS count FROM users u WHERE balance<>(SELECT COALESCE(SUM(amount),0) FROM ledger WHERE user_id=u.id)');
    if (mismatch.count) throw new Error('Ledger reconciliation failed. Import rolled back.');
  });
  console.log('Imported all users, rounds, bets and ledger entries. Balances reconcile. Old sessions were intentionally not imported; sign in again. Original SQLite file is unchanged.');
} finally { sqlite.close(); await store.close(); }
