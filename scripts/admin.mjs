import { createPgStore } from '../pg-store.mjs';
import { TOTP, Secret } from 'otpauth';
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: npm run admin -- owner@example.com');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (existsSync('data/admin-setup.txt')) throw new Error('A private admin setup file already exists. Secure it before provisioning another administrator. No account was changed.');
const store = await createPgStore(process.env.DATABASE_URL);
try {
  let user = await store.get('SELECT id,role FROM users WHERE email=?',email);
  if (user?.role === 'admin') throw new Error('Already an administrator. Existing credentials and authenticator were not changed.');
  const password = randomBytes(24).toString('base64url');
  if (!user) {
    const salt = randomBytes(16).toString('hex');
    const hash = await promisify(scrypt)(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});
    user = {id:await store.register(email,'Club administrator',hash.toString('hex'),salt)};
  }
  const secret = new Secret({size:20});
  const totp = new TOTP({issuer:'Colour Club',label:email,secret});
  // Write private setup material before enabling access so a file error cannot lose the authenticator key.
  mkdirSync('data',{recursive:true});
  writeFileSync('data/admin-setup.txt',`Administrator email: ${email}\n${user.role ? 'Password: your existing account password' : `Initial password: ${password}`}\nAuthenticator key: ${secret.base32}\nAuthenticator URI: ${totp.toString()}\n\nAdd the key to your authenticator, then sign in at /admin. Protect and remove this local setup file after storing the credentials securely.\n`,{mode:0o600,flag:'wx'});
  await store.run("UPDATE users SET role='admin',verified=TRUE,mfa_secret=? WHERE id=?",secret.base32,user.id);
  await store.run('DELETE FROM sessions WHERE user_id=?',user.id);
  console.log('Administrator configured. Private login/setup details were saved in data/admin-setup.txt; no credentials were printed.');
} finally { await store.close(); }
