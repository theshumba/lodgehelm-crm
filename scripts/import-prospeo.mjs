// scripts/import-prospeo.mjs — import the Prospeo person-scrape into Firestore as
// company-centric leads. Dedups against existing leads: NOVEL companies are added
// as new leads; companies ALREADY in the CRM are enriched with the people Prospeo
// found (ownerName + contacts + firmographics) without clobbering existing fields.
//
// Usage:  node scripts/import-prospeo.mjs            (commit)
//         node scripts/import-prospeo.mjs --dry-run  (report only, no writes)
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import admin from 'firebase-admin';
import { prospeoRowsToLeads, domainOf, normName } from './lib/prospeo-transform.mjs';

const DRY = process.argv.includes('--dry-run');
const CSV = process.env.PROSPEO_CSV || '/Users/theshumba/Desktop/prospeo-scrape/prospeo_leads.csv';
const KEY = new URL('../serviceAccountKey.json', import.meta.url);

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

// 1. Parse + group Prospeo rows into per-company leads.
const rows = parse(fs.readFileSync(CSV), { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
const leads = prospeoRowsToLeads(rows).filter((l) => l.businessName);
console.log(`Prospeo: ${rows.length} person-rows -> ${leads.length} company leads`);

// 2. Snapshot existing leads -> match maps (domain + normalised name).
const snap = await db.collection('leads').get();
console.log(`Existing leads in Firestore: ${snap.size}`);
const byDomain = new Map();
const byName = new Map();
const existingIds = new Set();
for (const doc of snap.docs) {
  const l = doc.data();
  existingIds.add(doc.id);
  const d = domainOf(l.website);
  if (d && !byDomain.has(d)) byDomain.set(d, doc);
  const n = normName(l.businessName);
  if (n && !byName.has(n)) byName.set(n, doc);
}

function findExisting(lead) {
  const d = domainOf(lead.website);
  if (d && byDomain.has(d)) return byDomain.get(d);
  const n = normName(lead.businessName);
  if (n && byName.has(n)) return byName.get(n);
  return null;
}

// 3. Split into enrich (existing) vs new, resolving id collisions for new ones.
const seenNewIds = new Set();
const enrichments = []; // { docId, patch }
const inserts = [];     // full lead objects with unique ids

for (const lead of leads) {
  const match = findExisting(lead);
  if (match) {
    const cur = match.data();
    const patch = {};
    if (lead.contacts.length) patch.contacts = lead.contacts;
    if (lead.ownerName && !cur.ownerName) patch.ownerName = lead.ownerName;
    if (lead.firmographics && Object.keys(lead.firmographics).length && !cur.firmographics) {
      patch.firmographics = lead.firmographics;
    }
    // Backfill website/phones only if the existing lead lacks them.
    if (lead.website && !cur.website) patch.website = lead.website;
    if (lead.phones.length && !(cur.phones && cur.phones.length)) patch.phones = lead.phones;
    if (Object.keys(patch).length) enrichments.push({ docId: match.id, businessName: cur.businessName, patch });
    continue;
  }
  // New lead — ensure id is unique against existing + this batch.
  let id = lead.id;
  if (existingIds.has(id) || seenNewIds.has(id)) {
    let s = 2; while (existingIds.has(`${lead.id}-${s}`) || seenNewIds.has(`${lead.id}-${s}`)) s++;
    id = `${lead.id}-${s}`;
  }
  seenNewIds.add(id);
  inserts.push({ ...lead, id });
}

console.log(`\nPlan: ${inserts.length} NEW leads, ${enrichments.length} existing leads ENRICHED`);
console.log(`Projected total: ${snap.size + inserts.length} leads`);

// Segment + country breakdown of the new leads.
const seg = {}, ctry = {};
for (const l of inserts) { seg[l.segment] = (seg[l.segment] || 0) + 1; ctry[l.country || '(unknown)'] = (ctry[l.country || '(unknown)'] || 0) + 1; }
console.log('\nNew-lead segments:', JSON.stringify(seg));
console.log('New-lead top countries:', JSON.stringify(Object.fromEntries(Object.entries(ctry).sort((a, b) => b[1] - a[1]).slice(0, 8))));
console.log('\nSample new leads:');
inserts.slice(0, 8).forEach((l) => console.log(`  - ${l.businessName} [${l.segment}] ${l.country} | ${l.contacts.length} contact(s), owner="${l.ownerName}"`));
console.log('\nSample enrichments:');
enrichments.slice(0, 8).forEach((e) => console.log(`  - ${e.businessName}: +${(e.patch.contacts || []).length} contact(s), owner="${e.patch.ownerName || '(kept)'}"`));

if (DRY) { console.log('\n[dry-run] no writes performed.'); process.exit(0); }

// 4. Commit (Firestore batch cap = 500 ops).
const ops = [
  ...inserts.map((l) => ({ ref: db.collection('leads').doc(l.id), data: l })),
  ...enrichments.map((e) => ({ ref: db.collection('leads').doc(e.docId), data: e.patch })),
];
let n = 0;
for (let i = 0; i < ops.length; i += 400) {
  const batch = db.batch();
  for (const op of ops.slice(i, i + 400)) { batch.set(op.ref, op.data, { merge: true }); n++; }
  await batch.commit();
  console.log(`Committed ${n}/${ops.length}`);
}
console.log('Done.');
process.exit(0);
