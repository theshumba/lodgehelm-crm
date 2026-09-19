// scripts/import-enrich-byid.mjs
// Generalized enrichment merge: iterate the verified result records BY ID (any status),
// fill EMPTY fields only, append new contacts, re-qualify, stamp provenance. Non-destructive.
//
// Usage:  node scripts/import-enrich-byid.mjs <results.json> [--dry-run]
import fs from 'node:fs';
import admin from 'firebase-admin';

const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const RESULTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const DRY = process.argv.includes('--dry-run');
const NOW = new Date().toISOString();
if (!RESULTS) { console.error('need results.json path'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

function qualify(lead) {
  const hasEmail = (lead.emails?.length > 0) || !!lead.email || (lead.contacts || []).some((c) => c.email);
  const hasPhone = (lead.phones?.length > 0) || !!lead.phone || (lead.contacts || []).some((c) => c.phone);
  const hasWhats = !!(lead.whatsapp && String(lead.whatsapp).trim());
  const hasName = !!(lead.ownerName && lead.ownerName.trim()) || (lead.contacts || []).some((c) => c.name);
  const hasAngle = !!((lead.funnelLeak || '').trim() || (lead.outreachAngle || '').trim());
  const hasCountry = !!(lead.country && lead.country.trim());
  const reachable = hasEmail || hasPhone || hasWhats;
  const qualified = reachable && hasCountry && (hasName || (hasEmail && hasAngle));
  return { qualified, reason: qualified ? (hasName ? 'Has named contact' : 'Email + outreach angle') : 'incomplete' };
}

// Merge helpers for arrays of strings -> field shapes, de-duping against existing.
const norm = (s) => String(s || '').trim().toLowerCase();

const records = JSON.parse(fs.readFileSync(RESULTS, 'utf8')).filter((r) => r && r.status === 'ok' && r.id);
console.log(`Verified records (ok): ${records.length}`);

let touched = 0, aEmail = 0, aPhone = 0, aWa = 0, aOwner = 0, aContacts = 0, aLi = 0, aAngle = 0, aCountry = 0, newlyQ = 0;
const updates = [];

for (const r of records) {
  const ref = db.collection('leads').doc(r.id);
  const doc = await ref.get();
  if (!doc.exists) continue;
  const l = doc.data();
  const wasQ = l.status === 'qualified';
  const patch = {};

  const existEmails = new Set((l.emails || []).map((e) => norm(e.address)));
  const existPhones = new Set((l.phones || []).map((p) => norm(p.number)));
  const newEmails = (r.emails || []).filter((a) => a && !existEmails.has(norm(a)));
  const newPhones = (r.phones || []).filter((n) => n && !existPhones.has(norm(n)));
  if (newEmails.length) { patch.emails = [...(l.emails || []), ...newEmails.map((a) => ({ address: a }))]; aEmail++; }
  if (newPhones.length) { patch.phones = [...(l.phones || []), ...newPhones.map((n) => ({ number: n }))]; aPhone++; }
  if (!(l.whatsapp && String(l.whatsapp).trim()) && r.whatsapp) { patch.whatsapp = r.whatsapp; aWa++; }
  if (!(l.ownerName && l.ownerName.trim()) && r.ownerName && r.ownerName.trim()) { patch.ownerName = r.ownerName.trim(); aOwner++; }

  // contacts: append any with a name not already present; also captures linkedin
  const existNames = new Set((l.contacts || []).map((c) => norm(c.name)));
  const incoming = (r.contacts || []).filter((c) => c.name && c.name.trim() && !existNames.has(norm(c.name)))
    .map((c) => ({ name: c.name, title: c.title || '', email: c.email || '', phone: c.phone || '', linkedin: c.linkedin || '' }));
  if (incoming.length) { patch.contacts = [...(l.contacts || []), ...incoming]; aContacts++; if (incoming.some((c) => c.linkedin)) aLi++; }

  if (!((l.funnelLeak || '').trim()) && r.funnelLeak) patch.funnelLeak = r.funnelLeak;
  if (!((l.outreachAngle || '').trim()) && r.outreachAngle) { patch.outreachAngle = r.outreachAngle; aAngle++; }
  if (!((l.country || '').trim()) && r.country && r.country.trim()) { patch.country = r.country.trim(); aCountry++; }

  if (!Object.keys(patch).length) continue;
  patch.enrichedFrom = l.enrichedFrom ? l.enrichedFrom : 'web-research';
  patch.deepenedAt = NOW;
  if (r.sources?.length) patch.enrichSources = r.sources.slice(0, 8);

  const merged = { ...l, ...patch };
  const q = qualify(merged);
  if (merged.status !== 'crm' && merged.status !== 'archive') { patch.status = q.qualified ? 'qualified' : 'unqualified'; patch.qualReason = q.reason; }
  if (!wasQ && q.qualified) newlyQ++;
  touched++;
  updates.push({ id: r.id, patch });
}

console.log(`
Leads touched: ${touched}
  +email ${aEmail}  +phone ${aPhone}  +whatsapp ${aWa}  +ownerName ${aOwner}  +contacts ${aContacts} (with LinkedIn ${aLi})  +angle ${aAngle}  +country ${aCountry}
  newly qualified: ${newlyQ}
Writes queued: ${updates.length}`);

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
