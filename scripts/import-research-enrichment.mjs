// scripts/import-research-enrichment.mjs
// Merge web-research enrichment (owner names, emails, phones, WhatsApp, contacts,
// funnelLeak/outreachAngle, country) back into Firestore, then re-qualify.
//
// Non-destructive: only FILLS EMPTY fields — never overwrites existing data.
// Every merged record was adversarially source-verified upstream (status:'ok').
//
// Usage:  node scripts/import-research-enrichment.mjs <results.json> --dry-run
//         node scripts/import-research-enrichment.mjs <results.json>
//         node scripts/import-research-enrichment.mjs <results.json> --no-requalify-passers
import fs from 'node:fs';
import admin from 'firebase-admin';

const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const RESULTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2]
  : '/private/tmp/claude-501/-Users-theshumba/a7332d30-d133-4124-98ff-8bae0c21d830/scratchpad/enrich-results.json';
const DRY = process.argv.includes('--dry-run');
const REQUALIFY_PASSERS = !process.argv.includes('--no-requalify-passers');
const NOW = new Date().toISOString();

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

const records = JSON.parse(fs.readFileSync(RESULTS, 'utf8')).filter((r) => r && r.status === 'ok');
const byId = new Map(records.map((r) => [r.id, r]));
console.log(`Verified enrichment records (status=ok): ${records.length}`);

const snap = await db.collection('leads').where('status', '==', 'unqualified').get();
console.log(`Unqualified leads in Firestore: ${snap.size}`);

let enriched = 0, addedEmail = 0, addedPhone = 0, addedWa = 0, addedName = 0, addedContacts = 0,
  addedAngle = 0, addedCountry = 0, newlyQualifiedByEnrich = 0, requalifiedPassers = 0, stillBank = 0;
const updates = [];
const requalifiedList = [];

for (const doc of snap.docs) {
  const l = doc.data();
  const r = byId.get(doc.id);
  const patch = {};

  if (r) {
    const hasEmail = (l.emails?.length > 0) || (l.contacts || []).some((c) => c.email);
    const hasPhone = (l.phones?.length > 0) || (l.contacts || []).some((c) => c.phone);
    if (!hasEmail && r.emails?.length) { patch.emails = r.emails.map((a) => ({ address: a })); addedEmail++; }
    if (!hasPhone && r.phones?.length) { patch.phones = r.phones.map((n) => ({ number: n })); addedPhone++; }
    if (!(l.whatsapp && String(l.whatsapp).trim()) && r.whatsapp) { patch.whatsapp = r.whatsapp; addedWa++; }
    if (!(l.ownerName && l.ownerName.trim()) && r.ownerName && r.ownerName.trim()) { patch.ownerName = r.ownerName.trim(); addedName++; }
    if (!(l.contacts?.length) && r.contacts?.length) {
      const cs = r.contacts.filter((c) => c.name && c.name.trim())
        .map((c) => ({ name: c.name, title: c.title || '', email: c.email || '', phone: c.phone || '', linkedin: c.linkedin || '' }));
      if (cs.length) { patch.contacts = cs; addedContacts++; }
    }
    if (!((l.funnelLeak || '').trim()) && r.funnelLeak) { patch.funnelLeak = r.funnelLeak; }
    if (!((l.outreachAngle || '').trim()) && r.outreachAngle) { patch.outreachAngle = r.outreachAngle; addedAngle++; }
    if (!((l.country || '').trim()) && r.country && r.country.trim()) { patch.country = r.country.trim(); addedCountry++; }
    if (Object.keys(patch).length) {
      patch.enrichedFrom = 'web-research';
      patch.enrichedAt = NOW;
      if (r.sources?.length) patch.enrichSources = r.sources.slice(0, 8);
      enriched++;
    }
  }

  // Re-qualify against the merged (post-patch) state.
  const merged = { ...l, ...patch };
  const q = qualify(merged);
  const wasEnriched = Object.keys(patch).length > 0;

  if (q.qualified) {
    if (merged.status !== 'crm' && merged.status !== 'archive') {
      if (wasEnriched) {
        patch.status = 'qualified'; patch.qualReason = q.reason; newlyQualifiedByEnrich++;
      } else if (REQUALIFY_PASSERS) {
        patch.status = 'qualified'; patch.qualReason = q.reason; requalifiedPassers++;
        requalifiedList.push({ id: doc.id, name: l.businessName });
      }
    }
  } else {
    stillBank++;
    if (wasEnriched) patch.qualReason = q.reason; // refresh reason if we touched it
  }

  if (Object.keys(patch).length) updates.push({ id: doc.id, patch });
}

console.log(`
--- ENRICHMENT MERGE ---
Leads enriched (fields filled):        ${enriched}
  +email ${addedEmail}  +phone ${addedPhone}  +whatsapp ${addedWa}  +ownerName ${addedName}  +contacts ${addedContacts}  +angle ${addedAngle}  +country ${addedCountry}

--- RE-QUALIFICATION ---
Newly QUALIFIED via enrichment:        ${newlyQualifiedByEnrich}
Re-qualified 'passers' (rule already met, no research needed): ${requalifiedPassers}${REQUALIFY_PASSERS ? '' : ' [SKIPPED via --no-requalify-passers]'}
Still in Lead Bank after this pass:    ${stillBank}
Total Firestore writes queued:         ${updates.length}
`);

if (requalifiedList.length) {
  fs.writeFileSync(RESULTS.replace(/[^/]+$/, 'requalified-passers.json'), JSON.stringify(requalifiedList, null, 2));
  console.log(`(list of ${requalifiedList.length} re-qualified passers written next to results file — review to re-bank any deliberately parked)`);
}

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
