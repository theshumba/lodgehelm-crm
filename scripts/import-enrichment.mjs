// scripts/import-enrichment.mjs — merge first-party contact data from the website
// enrichment scrape back into Firestore, then re-qualify the affected leads.
// Non-destructive: only FILLS EMPTY fields (never overwrites existing contacts).
//
// Usage:  node scripts/import-enrichment.mjs --dry-run
//         node scripts/import-enrichment.mjs
import fs from 'node:fs';
import admin from 'firebase-admin';
const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const RESULTS = '/Users/theshumba/Desktop/prospeo-scrape/enrich-results.json';
const DRY = process.argv.includes('--dry-run');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

// --- qualification rule (mirror of computeQualification in the app) ---
function qualify(lead) {
  const hasEmail = (lead.emails?.length > 0) || !!lead.email || (lead.contacts || []).some((c) => c.email);
  const hasPhone = (lead.phones?.length > 0) || !!lead.phone || (lead.contacts || []).some((c) => c.phone);
  const hasWhats = !!(lead.whatsapp && String(lead.whatsapp).trim());
  const hasName = !!(lead.ownerName && lead.ownerName.trim()) || (lead.contacts || []).some((c) => c.name);
  const hasAngle = !!((lead.funnelLeak || '').trim() || (lead.outreachAngle || '').trim());
  const hasCountry = !!(lead.country && lead.country.trim());
  const reachable = hasEmail || hasPhone || hasWhats;
  const qualified = reachable && hasCountry && (hasName || (hasEmail && hasAngle));
  if (qualified) return { qualified, reason: hasName ? 'Has named contact' : 'Email + outreach angle' };
  const missing = [];
  if (!reachable) missing.push('no contact channel');
  if (!hasCountry) missing.push('country unknown');
  if (!(hasName || (hasEmail && hasAngle))) missing.push('no contact name or angle');
  return { qualified, reason: missing.join(' · ') };
}

const results = JSON.parse(fs.readFileSync(RESULTS, 'utf8')).filter(r => r.status === 'ok');
console.log(`Enrichment results with data: ${results.length}`);

let enriched = 0, newlyQualified = 0, addedEmail = 0, addedPhone = 0, addedWa = 0;
const updates = [];

for (const r of results) {
  const ref = db.collection('leads').doc(r.id);
  const doc = await ref.get();
  if (!doc.exists) continue;
  const l = doc.data();
  const before = qualify(l).qualified;

  const patch = {};
  const hasEmail = (l.emails?.length > 0) || (l.contacts || []).some(c => c.email);
  const hasPhone = (l.phones?.length > 0) || (l.contacts || []).some(c => c.phone);
  if (!hasEmail && r.emails?.length) { patch.emails = r.emails.map(a => ({ address: a })); addedEmail++; }
  if (!hasPhone && r.phones?.length) { patch.phones = r.phones.map(n => ({ number: n })); addedPhone++; }
  if (!(l.whatsapp && l.whatsapp.trim()) && r.whatsapp) { patch.whatsapp = r.whatsapp; addedWa++; }
  if (Object.keys(patch).length === 0) continue;
  patch.enrichedFrom = 'website'; // provenance: first-party scrape

  const merged = { ...l, ...patch };
  const q = qualify(merged);
  patch.status = merged.status === 'crm' || merged.status === 'archive' ? merged.status : (q.qualified ? 'qualified' : 'unqualified');
  patch.qualReason = q.reason;
  enriched++;
  if (!before && q.qualified) newlyQualified++;
  updates.push({ id: r.id, patch });
}

console.log(`\nLeads to enrich: ${enriched}  (+${addedEmail} email, +${addedPhone} phone, +${addedWa} whatsapp)`);
console.log(`Newly QUALIFIED by enrichment: ${newlyQualified}`);

if (DRY) { console.log('\n[dry-run] no writes.'); process.exit(0); }

let n = 0;
for (let i = 0; i < updates.length; i += 400) {
  const batch = db.batch();
  for (const u of updates.slice(i, i + 400)) { batch.set(db.collection('leads').doc(u.id), u.patch, { merge: true }); n++; }
  await batch.commit();
  console.log(`Committed ${n}/${updates.length}`);
}
console.log('Done.');
process.exit(0);
