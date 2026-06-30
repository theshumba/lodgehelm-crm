// Export site-only Lead Bank leads (unreachable but have a website) for first-party enrichment.
import fs from 'node:fs';
import admin from 'firebase-admin';
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(new URL('../serviceAccountKey.json', import.meta.url)))) });
const db = admin.firestore();
const snap = await db.collection('leads').get();
const out = [];
for (const d of snap.docs) {
  const l = d.data();
  if (l.status !== 'unqualified') continue;
  const hasE = (l.emails?.length>0) || !!l.email || (l.contacts||[]).some(c=>c.email);
  const hasP = (l.phones?.length>0) || !!l.phone || (l.contacts||[]).some(c=>c.phone);
  const hasW = !!(l.whatsapp && String(l.whatsapp).trim());
  const site = (l.website||'').trim();
  if (!hasE && !hasP && !hasW && site) out.push({ id: d.id, businessName: l.businessName, website: site, country: l.country||'' });
}
fs.writeFileSync('/Users/theshumba/Desktop/prospeo-scrape/enrich-targets.json', JSON.stringify(out, null, 2));
console.log('Exported', out.length, 'site-only targets to prospeo-scrape/enrich-targets.json');
console.log('Sample:', out.slice(0,3).map(x=>x.website));
process.exit(0);
