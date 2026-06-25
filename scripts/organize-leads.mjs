// scripts/organize-leads.mjs — triage every lead by DATA COMPLETENESS and SIZE,
// then persist crm.priority, crm.dataScore (+tier) and a realistic crm.dealValue.
// Keeps the app's getDataCompleteness() in sync (same rubric). Non-destructive:
// only writes the crm.* fields it owns.
//
// Usage:  node scripts/organize-leads.mjs --dry-run   (report only)
//         node scripts/organize-leads.mjs             (commit)
import fs from 'node:fs';
import admin from 'firebase-admin';
const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const DRY = process.argv.includes('--dry-run');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

// SAME rubric as getDataCompleteness() in lodgehelm-crm.html — keep in sync.
function completeness(lead) {
  const hasEmail = (lead.emails?.length > 0) || (lead.contacts || []).some((c) => c.email);
  const hasPhone = (lead.phones?.length > 0) || (lead.contacts || []).some((c) => c.phone);
  const hasSite = !!(lead.website && lead.website.trim());
  const desc = (lead.description || '').trim();
  const hasDesc = !!desc;
  const longDesc = desc.length > 120;
  const fg = lead.firmographics || {};
  const hasSize = !!(fg.employees || fg.revenue || fg.founded);
  const hasContacts = (lead.contacts || []).some((c) => c.name);
  const hasOwner = !!(lead.ownerName && lead.ownerName.trim());
  const hasAngle = !!((lead.funnelLeak || '').trim() || (lead.outreachAngle || '').trim());
  const hasLoc = !!(lead.country && lead.country.trim());
  let s = 0;
  if (hasEmail) s += 20;
  if (hasPhone) s += 15;
  if (hasSite) s += 10;
  if (hasDesc) s += 10;
  if (longDesc) s += 5;
  if (hasSize) s += 10;
  if (hasContacts) s += 10;
  if (hasOwner) s += 5;
  if (hasAngle) s += 10;
  if (hasLoc) s += 5;
  s = Math.min(s, 100);
  const tier = s >= 65 ? 'rich' : s >= 35 ? 'partial' : 'bare';
  return { score: s, tier, hasEmail, hasPhone };
}

const PRIORITY_BY_TIER = { rich: 'high', partial: 'medium', bare: 'low' };
const DEAL_BY_SEGMENT = {
  phone_only: 900, small_lodge: 1200, small_operator: 1200,
  large_collection: 3600, large_operator: 3600,
};

const snap = await db.collection('leads').get();
console.log(`Leads: ${snap.size}`);

const tierCount = { rich: 0, partial: 0, bare: 0 };
const reach = { both: 0, emailOnly: 0, phoneOnly: 0, neither: 0 };
const segVal = {};
const updates = [];

for (const doc of snap.docs) {
  const l = doc.data();
  const c = completeness(l);
  tierCount[c.tier]++;
  if (c.hasEmail && c.hasPhone) reach.both++;
  else if (c.hasEmail) reach.emailOnly++;
  else if (c.hasPhone) reach.phoneOnly++;
  else reach.neither++;

  const dealValue = DEAL_BY_SEGMENT[l.segment] ?? 1200;
  segVal[l.segment || '?'] = dealValue;
  const priority = PRIORITY_BY_TIER[c.tier];
  const crm = { ...(l.crm || {}), priority, dataScore: c.score, dataTier: c.tier, dealValue };
  updates.push({ id: doc.id, crm });
}

console.log('\nCompleteness tiers:', JSON.stringify(tierCount));
console.log('Reachability:', JSON.stringify(reach));
console.log('Deal value by segment:', JSON.stringify(segVal));

if (DRY) { console.log('\n[dry-run] no writes.'); process.exit(0); }

let n = 0;
for (let i = 0; i < updates.length; i += 400) {
  const batch = db.batch();
  for (const u of updates.slice(i, i + 400)) { batch.set(db.collection('leads').doc(u.id), { crm: u.crm }, { merge: true }); n++; }
  await batch.commit();
  console.log(`Committed ${n}/${updates.length}`);
}
console.log('Done.');
process.exit(0);
