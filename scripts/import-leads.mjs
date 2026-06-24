// scripts/import-leads.mjs — batch-import the master CSV into Firestore.
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import admin from 'firebase-admin';
import { csvRowToLead } from './lib/transform.mjs';

const CSV = process.env.CSV_PATH
  || '/Users/theshumba/Desktop/Projects/LodgeHelm/leads/lodgehelm_leads_master.csv';
const KEY = new URL('../serviceAccountKey.json', import.meta.url);

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

const rows = parse(fs.readFileSync(CSV), { columns: true, skip_empty_lines: true, trim: true });
const rawLeads = rows.map(csvRowToLead).filter((l) => l.businessName);
console.log(`Parsed ${rawLeads.length} leads from CSV`);

// ID-collision de-duplication: if two leads produce the same id, append -2, -3, etc.
const seenIds = new Set();
let collisions = 0;
const leads = rawLeads.map((lead) => {
  if (!seenIds.has(lead.id)) {
    seenIds.add(lead.id);
    return lead;
  }
  // Find a unique suffix
  collisions++;
  let suffix = 2;
  while (seenIds.has(`${lead.id}-${suffix}`)) suffix++;
  const newId = `${lead.id}-${suffix}`;
  seenIds.add(newId);
  console.log(`  [de-dup] "${lead.businessName}" id collision: ${lead.id} → ${newId}`);
  return { ...lead, id: newId };
});

if (collisions > 0) {
  console.log(`De-duped ${collisions} id collision(s).`);
} else {
  console.log('No id collisions detected.');
}

let n = 0;
for (let i = 0; i < leads.length; i += 400) {
  const batch = db.batch();
  for (const lead of leads.slice(i, i + 400)) {
    batch.set(db.collection('leads').doc(lead.id), lead, { merge: true });
    n++;
  }
  await batch.commit();
  console.log(`Committed ${n}/${leads.length}`);
}
console.log('Done.');
process.exit(0);
