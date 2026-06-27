// scripts/backfill-qualification.mjs — split the Lead Bank into Qualified vs not,
// and re-score data completeness for EVERY lead (fixes leads the earlier triage missed).
//
// Qualification rule (keep in sync with computeQualification() in lodgehelm-crm.html):
//   QUALIFIED when ALL hold:
//     1. Reachable      — email OR phone OR WhatsApp
//     2. ICP fit        — country is known (foreign operators included; only blank fails)
//     3. Decision-maker — has a named owner/contact, OR has email + a written outreach angle
//
// Writes (merge, non-destructive otherwise):
//   - status            'qualified' | 'unqualified'   (never touches 'crm' / 'archive' leads)
//   - qualReason        short human label of why qualified / why parked in the bank
//   - crm.{priority,dataScore,dataTier,dealValue}      (completeness triage, all leads)
//
// Usage:  node scripts/backfill-qualification.mjs --dry-run   (report only)
//         node scripts/backfill-qualification.mjs             (commit)
import fs from 'node:fs';
import admin from 'firebase-admin';
const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const DRY = process.argv.includes('--dry-run');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

// --- data completeness (same rubric as getDataCompleteness / organize-leads) ---
function completeness(lead) {
  const hasEmail = (lead.emails?.length > 0) || !!lead.email || (lead.contacts || []).some((c) => c.email);
  const hasPhone = (lead.phones?.length > 0) || !!lead.phone || (lead.contacts || []).some((c) => c.phone);
  const hasSite = !!(lead.website && lead.website.trim());
  const desc = (lead.description || '').trim();
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
  if (desc) s += 10;
  if (desc.length > 120) s += 5;
  if (hasSize) s += 10;
  if (hasContacts) s += 10;
  if (hasOwner) s += 5;
  if (hasAngle) s += 10;
  if (hasLoc) s += 5;
  s = Math.min(s, 100);
  const tier = s >= 65 ? 'rich' : s >= 35 ? 'partial' : 'bare';
  return { score: s, tier };
}

// --- qualification rule (mirror of computeQualification in the app) ---
function qualify(lead) {
  const hasEmail = (lead.emails?.length > 0) || !!lead.email || (lead.contacts || []).some((c) => c.email);
  const hasPhone = (lead.phones?.length > 0) || !!lead.phone || (lead.contacts || []).some((c) => c.phone);
  const hasWhats = !!(lead.whatsapp && String(lead.whatsapp).trim());
  const hasName = !!(lead.ownerName && lead.ownerName.trim()) || (lead.contacts || []).some((c) => c.name);
  const hasAngle = !!((lead.funnelLeak || '').trim() || (lead.outreachAngle || '').trim());
  const hasCountry = !!(lead.country && lead.country.trim());

  const reachable = hasEmail || hasPhone || hasWhats;
  const icpFit = hasCountry;
  const decisionMaker = hasName || (hasEmail && hasAngle);
  const qualified = reachable && icpFit && decisionMaker;

  if (qualified) return { qualified, reason: hasName ? 'Has named contact' : 'Email + outreach angle' };
  const missing = [];
  if (!reachable) missing.push('no contact channel');
  if (!icpFit) missing.push('country unknown');
  if (!decisionMaker) missing.push('no contact name or angle');
  return { qualified, reason: missing.join(' · ') };
}

const PRIORITY_BY_TIER = { rich: 'high', partial: 'medium', bare: 'low' };
const DEAL_BY_SEGMENT = {
  phone_only: 900, small_lodge: 1200, small_operator: 1200,
  large_collection: 3600, large_operator: 3600,
};

const snap = await db.collection('leads').get();
console.log(`Leads: ${snap.size}`);

const tierCount = { rich: 0, partial: 0, bare: 0 };
const statusCount = { qualified: 0, unqualified: 0, skipped: 0 };
const updates = [];

for (const doc of snap.docs) {
  const l = doc.data();
  const c = completeness(l);
  tierCount[c.tier]++;
  const crm = {
    ...(l.crm || {}),
    priority: PRIORITY_BY_TIER[c.tier],
    dataScore: c.score,
    dataTier: c.tier,
    dealValue: DEAL_BY_SEGMENT[l.segment] ?? (l.crm?.dealValue ?? 1200),
  };

  // Never override leads already advanced into the pipeline or archived.
  if (l.status === 'crm' || l.status === 'archive') {
    statusCount.skipped++;
    updates.push({ id: doc.id, data: { crm } });
    continue;
  }
  const q = qualify(l);
  const status = q.qualified ? 'qualified' : 'unqualified';
  statusCount[status]++;
  updates.push({ id: doc.id, data: { status, qualReason: q.reason, crm } });
}

console.log('\nCompleteness tiers:', JSON.stringify(tierCount));
console.log('Qualification split:', JSON.stringify(statusCount));

if (DRY) { console.log('\n[dry-run] no writes.'); process.exit(0); }

let n = 0;
for (let i = 0; i < updates.length; i += 400) {
  const batch = db.batch();
  for (const u of updates.slice(i, i + 400)) { batch.set(db.collection('leads').doc(u.id), u.data, { merge: true }); n++; }
  await batch.commit();
  console.log(`Committed ${n}/${updates.length}`);
}
console.log('Done.');
process.exit(0);
