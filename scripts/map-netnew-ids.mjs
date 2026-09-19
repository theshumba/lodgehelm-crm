// scripts/map-netnew-ids.mjs
// Net-new records are identified by business name, not by id, because they had no lead doc yet.
// Once create-netnew-v2 has run they DO have one. This stamps the live Firestore id onto each
// verified record so import-enrich-v2 can top them up (e.g. with LinkedIn profiles recovered by a
// later recheck pass) instead of trying to create duplicates.
//
// Usage: node scripts/map-netnew-ids.mjs <netnew-verified.json> <out.json>
import fs from 'node:fs';
import admin from 'firebase-admin';

const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const SRC = process.argv[2];
const DEST = process.argv[3];
if (!SRC || !DEST) { console.error('usage: map-netnew-ids.mjs <verified.json> <out.json>'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const domOf = (u) => { try { return new URL(String(u).startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

const snap = await db.collection('leads').get();
const byName = new Map(), byDom = new Map();
for (const d of snap.docs) {
  const l = d.data();
  const n = norm(l.businessName); if (n && !byName.has(n)) byName.set(n, d.id);
  const dm = domOf(l.website); if (dm && !byDom.has(dm)) byDom.set(dm, d.id);
}

const recs = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let matched = 0, unmatched = 0;
const out = [];
for (const r of recs) {
  if (!r || r.status !== 'ok') continue;
  const id = byName.get(norm(r.businessName)) || byDom.get(domOf(r.website)) || null;
  if (!id) { unmatched++; continue; }
  matched++;
  out.push({ ...r, id });
}
fs.writeFileSync(DEST, JSON.stringify(out, null, 2));
console.log(`live CRM: ${snap.size} leads | records in: ${recs.length} | matched to a lead id: ${matched} | no match (skipped): ${unmatched}`);
console.log('written:', DEST);
process.exit(0);
