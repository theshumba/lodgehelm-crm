// scripts/import-enrich-v2.mjs
// Merge source-VERIFIED enrichment into existing leads, by id, any status.
//
// Supersedes import-enrich-byid.mjs. What it adds:
//   - company LinkedIn (top-level `linkedin` + firmographics.socials.linkedin)
//   - enriches EXISTING contacts in place (old script only appended brand-new names,
//     so a known contact could never gain a LinkedIn URL or a phone)
//   - phone de-dupe by digits, not exact string ("+27 82 555 1234" == "+27825551234")
//
// Non-destructive: fills empty fields and appends new values. Never overwrites.
//
// Usage:  node scripts/import-enrich-v2.mjs <verified.json> [--dry-run]
import fs from 'node:fs';
import admin from 'firebase-admin';

const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const RESULTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const DRY = process.argv.includes('--dry-run');
const NOW = new Date().toISOString();
if (!RESULTS) { console.error('usage: import-enrich-v2.mjs <verified.json> [--dry-run]'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

const norm = (s) => String(s || '').trim().toLowerCase();
const dig = (s) => String(s || '').replace(/\D/g, '');
const tailKey = (s) => { const d = dig(s); return d.length >= 9 ? d.slice(-9) : d; };
const liKey = (s) => String(s || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').replace(/\?.*$/, '');

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

const records = JSON.parse(fs.readFileSync(RESULTS, 'utf8')).filter((r) => r && r.status === 'ok' && r.id);
console.log(`Verified records (ok): ${records.length}`);

let touched = 0, aEmail = 0, aPhone = 0, aWa = 0, aOwner = 0, aNewContacts = 0, aContactLi = 0,
  aCompanyLi = 0, aAngle = 0, aCountry = 0, newlyQ = 0, missing = 0;
const updates = [];

for (const r of records) {
  const doc = await db.collection('leads').doc(r.id).get();
  if (!doc.exists) { missing++; continue; }
  const l = doc.data();
  const wasQ = l.status === 'qualified';
  const patch = {};

  // --- phones / emails: append what is genuinely new ---
  const haveP = new Set((l.phones || []).map((p) => tailKey(p.number)).filter(Boolean));
  const haveE = new Set((l.emails || []).map((e) => norm(e.address)).filter(Boolean));
  const newP = [], newE = [];
  for (const n of r.phones || []) { const k = tailKey(n); if (n && k && !haveP.has(k)) { haveP.add(k); newP.push(n); } }
  for (const a of r.emails || []) { const k = norm(a); if (a && k && !haveE.has(k)) { haveE.add(k); newE.push(a); } }
  if (newP.length) { patch.phones = [...(l.phones || []), ...newP.map((n) => ({ number: n }))]; aPhone++; }
  if (newE.length) { patch.emails = [...(l.emails || []), ...newE.map((a) => ({ address: a }))]; aEmail++; }

  if (!(l.whatsapp && String(l.whatsapp).trim()) && r.whatsapp) { patch.whatsapp = r.whatsapp; aWa++; }
  if (!(l.ownerName && l.ownerName.trim()) && r.ownerName && r.ownerName.trim()) { patch.ownerName = r.ownerName.trim(); aOwner++; }

  // --- contacts: enrich matching names IN PLACE, append the rest ---
  const existing = (l.contacts || []).map((c) => ({ ...c }));
  const byName = new Map(existing.map((c, i) => [norm(c.name), i]));
  let contactsChanged = false, gainedLi = false;
  for (const c of r.contacts || []) {
    if (!c || !c.name || !c.name.trim()) continue;
    const k = norm(c.name);
    if (byName.has(k)) {
      const t = existing[byName.get(k)];
      for (const f of ['title', 'email', 'phone', 'linkedin']) {
        if (!String(t[f] || '').trim() && String(c[f] || '').trim()) {
          t[f] = c[f]; contactsChanged = true; if (f === 'linkedin') gainedLi = true;
        }
      }
    } else {
      existing.push({ name: c.name.trim(), title: c.title || '', email: c.email || '', phone: c.phone || '', linkedin: c.linkedin || '' });
      byName.set(k, existing.length - 1);
      contactsChanged = true; aNewContacts++;
      if (c.linkedin) gainedLi = true;
    }
  }
  if (contactsChanged) { patch.contacts = existing; if (gainedLi) aContactLi++; }

  // --- company LinkedIn: top-level `linkedin` (what the UI reads) + firmographics.socials ---
  if (r.companyLinkedin && String(r.companyLinkedin).trim()) {
    const cur = liKey(l.linkedin || l.firmographics?.socials?.linkedin);
    if (!cur) {
      patch.linkedin = String(r.companyLinkedin).trim();
      patch.firmographics = { ...(l.firmographics || {}), socials: { ...(l.firmographics?.socials || {}), linkedin: String(r.companyLinkedin).trim() } };
      aCompanyLi++;
    }
  }

  if (!((l.funnelLeak || '').trim()) && r.funnelLeak) patch.funnelLeak = r.funnelLeak;
  if (!((l.outreachAngle || '').trim()) && r.outreachAngle) { patch.outreachAngle = r.outreachAngle; aAngle++; }
  if (!((l.country || '').trim()) && r.country && r.country.trim()) { patch.country = r.country.trim(); aCountry++; }

  if (!Object.keys(patch).length) continue;
  patch.enrichedFrom = l.enrichedFrom || 'web-research';
  patch.deepenedAt = NOW;
  if (r.sources?.length) patch.enrichSources = r.sources.slice(0, 8);

  const merged = { ...l, ...patch };
  const q = qualify(merged);
  // Promote only. A lead he force-qualified by hand must never be demoted by a rule re-run,
  // and crm/archive leads keep their status regardless.
  if (q.qualified && !wasQ && merged.status !== 'crm' && merged.status !== 'archive') {
    patch.status = 'qualified';
    patch.qualReason = q.reason;
    newlyQ++;
  }
  touched++;
  updates.push({ id: r.id, patch });
}

console.log(`
Leads touched: ${touched}   (record id not in Firestore: ${missing})
  +phone ${aPhone}  +email ${aEmail}  +whatsapp ${aWa}  +ownerName ${aOwner}
  +new contacts ${aNewContacts}  leads gaining a contact LinkedIn ${aContactLi}  +company LinkedIn ${aCompanyLi}
  +angle ${aAngle}  +country ${aCountry}
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
