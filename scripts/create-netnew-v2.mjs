// scripts/create-netnew-v2.mjs
// Create net-new discovered leads from a SINGLE source-verified records file.
//
// Supersedes create-netnew-leads.mjs (which needed a separate candidates file to carry
// the firmographics). Here each verified record is already complete.
//
// - Authoritative de-dupe against LIVE Firestore by domain and normalised name, at run time.
// - Also de-dupes within the run, and by phone/email overlap with the live CRM (the same
//   lodge often appears under two spellings across two directories).
// - Builds the exact CRM lead shape (mirrors lib/transform.mjs + organize-leads.mjs scoring).
//
// Usage: node scripts/create-netnew-v2.mjs <netnew-verified.json> [--dry-run]
import fs from 'node:fs';
import admin from 'firebase-admin';

const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const RESULTS = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const DRY = process.argv.includes('--dry-run');
const NOW = new Date().toISOString();
const SOURCE_TAG = 'web-discovery-2026-08-01';
if (!RESULTS) { console.error('usage: create-netnew-v2.mjs <verified.json> [--dry-run]'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dig = (s) => String(s || '').replace(/\D/g, '');
const tailKey = (s) => { const d = dig(s); return d.length >= 9 ? d.slice(-9) : ''; };
const domOf = (u) => { try { return new URL(String(u).startsWith('http') ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
function hashStr(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
const slugId = (name) => (name || 'lead').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + Math.abs(hashStr(name)).toString(36).slice(0, 6);

const KNOWN_SEG = new Set(['small_lodge', 'large_collection', 'small_operator', 'large_operator', 'phone_only']);
const normSeg = (s) => (s === 'camp' ? 'small_lodge' : KNOWN_SEG.has(s) ? s : 'small_lodge');
const DEAL_BY_SEGMENT = { phone_only: 900, small_lodge: 1200, small_operator: 1200, large_collection: 3600, large_operator: 3600 };
const PRIORITY_BY_TIER = { rich: 'high', partial: 'medium', bare: 'low' };

function completeness(l) {
  const hasEmail = (l.emails?.length > 0) || (l.contacts || []).some((c) => c.email);
  const hasPhone = (l.phones?.length > 0) || (l.contacts || []).some((c) => c.phone);
  const desc = (l.description || '').trim();
  let s = 0;
  if (hasEmail) s += 20; if (hasPhone) s += 15; if (l.website?.trim()) s += 10;
  if (desc) s += 10; if (desc.length > 120) s += 5;
  if ((l.contacts || []).some((c) => c.name)) s += 10;
  if (l.ownerName?.trim()) s += 5;
  if ((l.funnelLeak || '').trim() || (l.outreachAngle || '').trim()) s += 10;
  if (l.country?.trim()) s += 5;
  s = Math.min(s, 100);
  return { score: s, tier: s >= 65 ? 'rich' : s >= 35 ? 'partial' : 'bare' };
}
function qualify(l) {
  const hasEmail = (l.emails?.length > 0) || (l.contacts || []).some((c) => c.email);
  const hasPhone = (l.phones?.length > 0) || (l.contacts || []).some((c) => c.phone);
  const hasWhats = !!(l.whatsapp && String(l.whatsapp).trim());
  const hasName = !!(l.ownerName && l.ownerName.trim()) || (l.contacts || []).some((c) => c.name);
  const hasAngle = !!((l.funnelLeak || '').trim() || (l.outreachAngle || '').trim());
  const hasCountry = !!(l.country && l.country.trim());
  const reachable = hasEmail || hasPhone || hasWhats;
  const qualified = reachable && hasCountry && (hasName || (hasEmail && hasAngle));
  return { qualified, reason: qualified ? (hasName ? 'Has named contact' : 'Email + outreach angle') : 'incomplete' };
}

const results = JSON.parse(fs.readFileSync(RESULTS, 'utf8')).filter((r) => r && r.status === 'ok' && (r.businessName || '').trim());
console.log(`Verified net-new records (ok): ${results.length}`);

// Authoritative de-dupe vs LIVE Firestore
const snap = await db.collection('leads').get();
const exN = new Set(), exD = new Set(), exIds = new Set(), exPhone = new Set(), exEmail = new Set();
for (const d of snap.docs) {
  const l = d.data(); exIds.add(d.id);
  if (l.businessName) exN.add(norm(l.businessName));
  const dm = domOf(l.website); if (dm) exD.add(dm);
  for (const p of l.phones || []) { const k = tailKey(p.number); if (k) exPhone.add(k); }
  for (const e of l.emails || []) { const a = String(e.address || '').toLowerCase().trim(); if (a) exEmail.add(a); }
}
console.log(`Live CRM: ${snap.size} leads (${exD.size} domains, ${exN.size} names, ${exPhone.size} phones)`);

let created = 0, dupName = 0, dupDomain = 0, dupContact = 0, qCount = 0;
const tierC = { rich: 0, partial: 0, bare: 0 }; const byCountry = {}; const docs = [];

for (const r of results) {
  const name = String(r.businessName).trim();
  const website = (r.website || '').trim();
  const n = norm(name), dm = domOf(website);
  if (n && exN.has(n)) { dupName++; continue; }
  if (dm && exD.has(dm)) { dupDomain++; continue; }
  const phoneKeys = (r.phones || []).map(tailKey).filter(Boolean);
  const emailKeys = (r.emails || []).map((a) => String(a).toLowerCase().trim()).filter(Boolean);
  if (phoneKeys.some((k) => exPhone.has(k)) || emailKeys.some((k) => exEmail.has(k))) { dupContact++; continue; }

  if (n) exN.add(n); if (dm) exD.add(dm);
  phoneKeys.forEach((k) => exPhone.add(k)); emailKeys.forEach((k) => exEmail.add(k));

  let id = slugId(name); while (exIds.has(id)) id += '-n'; exIds.add(id);
  const segment = normSeg(r.segment);
  const country = (r.country || '').trim();
  const lead = {
    id, businessName: name, description: (r.description || '').trim(), industry: (r.segment || '').trim(),
    country, region: (r.region || '').trim(), segment, website,
    emails: (r.emails || []).map((a) => ({ address: a })),
    phones: (r.phones || []).map((p) => ({ number: p })),
    whatsapp: r.whatsapp || '', ownerName: (r.ownerName || '').trim(),
    linkedin: (r.companyLinkedin || '').trim(),
    firmographics: r.companyLinkedin ? { socials: { linkedin: r.companyLinkedin } } : {},
    funnelLeak: r.funnelLeak || '', outreachAngle: r.outreachAngle || '',
    contacts: (r.contacts || []).filter((c) => c && c.name).map((c) => ({ name: c.name, title: c.title || '', email: c.email || '', phone: c.phone || '', linkedin: c.linkedin || '' })),
    activity: [], researchChecklist: [], qualification: null,
    source: SOURCE_TAG, enrichedFrom: 'web-discovery', enrichedAt: NOW,
    enrichSources: (r.sources || []).slice(0, 8), dateAdded: NOW,
  };
  const c = completeness(lead); tierC[c.tier]++;
  const q = qualify(lead); if (q.qualified) qCount++;
  lead.crm = { notes: [], priority: PRIORITY_BY_TIER[c.tier], disposition: 'nurture', dealValue: DEAL_BY_SEGMENT[segment] ?? 1200, outcomeReason: '', stage: 1, dataScore: c.score, dataTier: c.tier };
  lead.status = q.qualified ? 'qualified' : 'unqualified';
  lead.qualReason = q.reason;
  byCountry[country || 'Unknown'] = (byCountry[country || 'Unknown'] || 0) + 1;
  docs.push(lead); created++;
}

console.log(`
To CREATE: ${created}
  skipped as dupes: ${dupName} by name · ${dupDomain} by domain · ${dupContact} by shared phone/email
  qualified: ${qCount}   bank: ${created - qCount}
  tier: rich ${tierC.rich} / partial ${tierC.partial} / bare ${tierC.bare}
  by country: ${Object.entries(byCountry).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);

if (DRY) {
  fs.writeFileSync(RESULTS.replace(/[^/]+$/, 'netnew-to-create.preview.json'), JSON.stringify(docs, null, 2));
  console.log('\n[dry-run] wrote netnew-to-create.preview.json, no writes.');
  process.exit(0);
}
let n = 0;
for (let i = 0; i < docs.length; i += 400) {
  const batch = db.batch();
  for (const d of docs.slice(i, i + 400)) { const { id, ...rest } = d; batch.set(db.collection('leads').doc(id), rest); n++; }
  await batch.commit();
  console.log(`Committed ${n}/${docs.length}`);
}
console.log('Done.');
process.exit(0);
