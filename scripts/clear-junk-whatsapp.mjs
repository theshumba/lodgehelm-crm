// scripts/clear-junk-whatsapp.mjs — follow-up to normalize-phones.mjs. Leads whose
// `whatsapp` field holds a researcher NOTE instead of a number ("None listed",
// "FLAG (not published)", "available via form", ...) never get a WhatsApp button:
// waLink() in lodgehelm-crm.html does `(l.whatsapp || phones[0].number || '')`, so a
// truthy junk string blocks the phones[0] fallback, strips to zero digits and kills
// the link. This pass sets those junk values to '' (falsy -> fallback works) and
// preserves the note at `whatsappOriginal` (only if not already set).
//
// SAFETY: a value is only "junk" if, after stripping URLs, NO part of it contains a
// run of 7+ digits — anything that might be a real number (even one our E.164 rules
// couldn't confirm, like a bare UAE "971547991152") is left untouched.
//
// Usage:  node scripts/clear-junk-whatsapp.mjs --dry-run   (report only)
//         node scripts/clear-junk-whatsapp.mjs             (commit)
import fs from 'node:fs';
import admin from 'firebase-admin';
const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const DRY = process.argv.includes('--dry-run');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();
const USER = 'Master'; // same stamping as scripts/crm.mjs

// True when the string cannot plausibly contain a phone number.
function isJunkWhatsapp(raw) {
  let s = String(raw || '');
  if (!s.trim()) return false; // already empty — nothing to do
  s = s.replace(/https?:\/\/\S+|www\.\S+/gi, ' '); // URL digits don't count
  // Within each note fragment, would any digit run (ignoring separators) reach 7?
  for (const part of s.split(/[\/;,|]| or | and /i)) {
    const digits = part.replace(/[^\d]/g, '');
    if (digits.length >= 7) return false; // might be a number — do not touch
  }
  return true;
}

const snap = await db.collection('leads').get();
console.log(`Leads: ${snap.size}${DRY ? '  [dry-run]' : ''}`);

const updates = [];
const kept = [];
for (const doc of snap.docs) {
  const l = doc.data();
  if (l._deleted) continue;
  const wa = typeof l.whatsapp === 'string' ? l.whatsapp : '';
  if (!wa.trim()) continue;
  if (/^\+\d{9,15}$/.test(wa)) continue; // already clean E.164 — skip fast
  if (!isJunkWhatsapp(wa)) { kept.push({ name: l.businessName || doc.id, wa }); continue; }
  const fallback = (l.phones && l.phones[0] && l.phones[0].number) || '(no phone)';
  const payload = { whatsapp: '', _modAt: new Date().toISOString(), _modBy: USER };
  if (!l.whatsappOriginal) payload.whatsappOriginal = wa;
  updates.push({ id: doc.id, name: l.businessName || doc.id, wa, fallback, payload });
}

console.log(`\nClearing ${updates.length} junk whatsapp values (note kept in whatsappOriginal):`);
for (const u of updates) {
  console.log(`  ${u.name.padEnd(38).slice(0, 38)}"${u.wa}"  ->  ''   [waLink falls back to: ${u.fallback}]`);
}
console.log(`\nLeft untouched — non-E.164 but may contain a real number (${kept.length}):`);
for (const k of kept) console.log(`  ${k.name.padEnd(38).slice(0, 38)}"${k.wa}"`);

if (DRY) { console.log('\n[dry-run] no writes.'); process.exit(0); }

let n = 0;
for (let i = 0; i < updates.length; i += 400) {
  const batch = db.batch();
  for (const u of updates.slice(i, i + 400)) {
    batch.set(db.collection('leads').doc(u.id), { ...u.payload, _srvAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    n++;
  }
  await batch.commit();
  console.log(`Committed ${n}/${updates.length}`);
}
console.log('Done.');
process.exit(0);
