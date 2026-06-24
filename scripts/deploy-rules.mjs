// One-off: publish firestore.rules to the project via the Firebase Rules REST API,
// authenticating with the service-account key (bypasses the firebase CLI serviceusage precheck).
import admin from 'firebase-admin';
import fs from 'node:fs';

const sa = JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url)));
admin.initializeApp({ credential: admin.credential.cert(sa) });
const PROJECT = sa.project_id;
const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const { access_token } = await admin.app().options.credential.getAccessToken();
const H = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

// 1) create ruleset
const rs = await (await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rules }] } }),
})).json();
if (!rs.name) { console.error('RULESET FAILED:', JSON.stringify(rs)); process.exit(1); }
console.log('ruleset created:', rs.name);

// 2) point the cloud.firestore release at it (patch existing; create if absent)
const relName = `projects/${PROJECT}/releases/cloud.firestore`;
let rel = await (await fetch(`https://firebaserules.googleapis.com/v1/${relName}`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ release: { name: relName, rulesetName: rs.name } }),
})).json();
if (rel.error) {
  rel = await (await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: relName, rulesetName: rs.name }),
  })).json();
}
if (rel.error) { console.error('RELEASE FAILED:', JSON.stringify(rel.error)); process.exit(1); }
console.log('rules published. release ->', rel.rulesetName || rel.name);
process.exit(0);
