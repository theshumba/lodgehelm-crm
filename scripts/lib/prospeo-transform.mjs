// Pure Prospeo-scrape → LodgeHelm lead transform. No I/O.
// Prospeo rows are PERSON-centric (one row per individual). This module groups
// rows by company and emits ONE company-centric lead (matching the CRM model),
// folding each person into contacts[].
import { deriveSegment } from './transform.mjs';

// Strip emoji flags (regional-indicator pairs) and tidy whitespace.
export function stripFlags(s) {
  return (s || '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/️/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "Cape Town, Western Cape, South Africa 🇿🇦" -> { country, region }
// "Kenya 🇰🇪" -> { country: 'Kenya', region: '' }
export function parseLocation(loc) {
  const clean = stripFlags(loc);
  if (!clean) return { country: '', region: '' };
  const parts = clean.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { country: parts[0] || '', region: '' };
  const country = parts[parts.length - 1];
  const region = parts.slice(0, -1).join(', ');
  return { country, region };
}

export function domainOf(url) {
  if (!url) return '';
  return String(url).toLowerCase().trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[\/?#]/)[0]
    .trim();
}

export function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Group key for collapsing person rows into a company.
export function companyKey(row) {
  return domainOf(row.website) || normName(row.company);
}

function hashStr(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }
export function slugId(name) {
  return (name || 'lead').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    + '-' + Math.abs(hashStr(name)).toString(36).slice(0, 6);
}

// Seniority ranking to choose the lead's ownerName / primary contact.
const SENIORITY = [
  /\b(owner|founder|co-?founder|proprietor)\b/i,
  /\b(ceo|chief executive|managing director|\bmd\b|managing partner|director)\b/i,
  /\b(general manager|\bgm\b|operations? manager|head of)\b/i,
  /\b(reservations? manager|sales manager|reservation|sales)\b/i,
  /\b(lodge manager|camp manager|manager)\b/i,
];
function seniorityRank(title) {
  const t = title || '';
  for (let i = 0; i < SENIORITY.length; i++) if (SENIORITY[i].test(t)) return i;
  return SENIORITY.length;
}

// Build a person contact from a Prospeo row.
function rowToContact(row) {
  const c = { name: stripFlags(row.person_name), title: stripFlags(row.person_title) };
  const phone = stripFlags(row.phone);
  const email = (row.email || '').trim();
  if (phone) c.phone = phone;
  if (email) c.email = email;
  if ((row.linkedin || '').trim()) c.linkedin = row.linkedin.trim();
  return c;
}

// Convert one company's grouped person rows into a single CRM lead.
// rows: array of Prospeo CSV rows that share a company.
export function prospeoGroupToLead(rows, { source = 'prospeo-2026-06-25' } = {}) {
  const first = rows[0];
  const businessName = stripFlags(first.company) || stripFlags(first.person_name) || 'Unknown';
  const website = (rows.find((r) => (r.website || '').trim()) || {}).website || '';
  const { country, region } = parseLocation(rows.find((r) => (r.location || '').trim())?.location || '');

  // Contacts: real people (skip nameless rows), most senior first, de-duped by name.
  const seen = new Set();
  const contacts = rows
    .filter((r) => stripFlags(r.person_name))
    .map(rowToContact)
    .filter((c) => { const k = c.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => seniorityRank(a.title) - seniorityRank(b.title));

  const ownerName = contacts[0]?.name || '';

  // Company-level phone/email (de-duped). Prefer revealed company contacts.
  const phoneSet = new Set();
  rows.forEach((r) => { const p = stripFlags(r.phone); if (p) phoneSet.add(p); });
  const phones = [...phoneSet].map((number) => ({ number }));
  const emailSet = new Set();
  rows.forEach((r) => { const e = (r.email || '').trim(); if (e) emailSet.add(e); });
  const emails = [...emailSet].map((address) => ({ address }));

  // Company description: longest available (most informative).
  const description = rows
    .map((r) => (r.description || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || '';

  const industry = (first.industry || '').trim();

  // Reuse the master segment heuristic via a compatible pseudo-row.
  const segment = deriveSegment({
    Type: `${industry} ${businessName}`,
    'Established/Size': `${first.employees || ''} ${first.revenue || ''}`,
    Name: businessName,
    Email: emails.length ? emails[0].address : '',
    Website: website,
  });

  const socials = {};
  ['facebook', 'twitter', 'instagram', 'linkedin'].forEach((k) => {
    const v = (first[k] || '').trim();
    if (v) socials[k] = v;
  });

  const firmographics = {};
  ['founded', 'employees', 'revenue', 'ai_tier'].forEach((k) => {
    const v = (first[k] || '').trim();
    if (v) firmographics[k] = v;
  });
  if (Object.keys(socials).length) firmographics.socials = socials;

  return {
    id: slugId(businessName),
    businessName,
    description,
    industry,
    country,
    region,
    segment,
    website: website.trim(),
    emails,
    phones,
    whatsapp: '',
    ownerName,
    funnelLeak: '',
    outreachAngle: '',
    contacts,
    firmographics,
    activity: [],
    researchChecklist: [],
    source,
    status: 'unqualified',
    qualification: null,
    crm: { notes: [], priority: 'medium', disposition: 'nurture', dealValue: 1200, outcomeReason: '', stage: 1 },
  };
}

// Group an array of Prospeo rows into per-company leads.
export function prospeoRowsToLeads(rows, opts = {}) {
  const groups = new Map();
  for (const row of rows) {
    if (!stripFlags(row.company) && !stripFlags(row.person_name)) continue;
    const key = companyKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((g) => prospeoGroupToLead(g, opts));
}
