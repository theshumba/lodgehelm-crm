// One-off: prepare owner-only auth for LodgeHelm HQ.
//  1) Enables the Email/Password sign-in provider (Identity Toolkit admin API).
//  2) Creates (or updates) the single owner account.
//  3) Prints the owner UID — paste it into firestore.rules, then run deploy-rules.mjs.
// Usage: node scripts/setup-owner-auth.mjs <email> <password>
// No secrets live in this file; the service-account key at the repo root authenticates it.
import admin from 'firebase-admin';
import fs from 'node:fs';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/setup-owner-auth.mjs <email> <password>');
  process.exit(1);
}

const sa = JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url)));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const PROJECT = sa.project_id;
const { access_token } = await admin.app().options.credential.getAccessToken();
const H = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

// 1) Enable the email/password provider (idempotent).
const cfg = await (await fetch(
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=signIn.email`,
  { method: 'PATCH', headers: H, body: JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }) }
)).json();
if (cfg.error) { console.error('PROVIDER ENABLE FAILED:', JSON.stringify(cfg.error)); process.exit(1); }
console.log('email/password provider:', cfg.signIn && cfg.signIn.email && cfg.signIn.email.enabled ? 'ENABLED' : JSON.stringify(cfg.signIn));

// 2) Create or update the owner user.
let user;
try {
  user = await admin.auth().getUserByEmail(email);
  await admin.auth().updateUser(user.uid, { password });
  console.log('existing user updated:', user.uid);
} catch {
  user = await admin.auth().createUser({ email, password, emailVerified: true });
  console.log('user created:', user.uid);
}

console.log('\nOWNER_UID=' + user.uid);
console.log('Next: put this UID in firestore.rules, deploy the app, then node scripts/deploy-rules.mjs');
process.exit(0);
