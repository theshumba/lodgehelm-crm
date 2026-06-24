// Pure CSV-row → LodgeHelm lead transform. No I/O. Mirrors normalizeLead's shape.
const BIG_MARKERS = [/collection/i, /\bgroup\b/i, /portfolio/i, /category\s*[abc]\b/i, /\b(100|hundreds|multi-?propert)/i];

export function deriveSegment(row) {
  const type = (row.Type || '').toLowerCase();
  const size = (row['Established/Size'] || '');
  const name = (row.Name || '');
  const hasEmail = !!(row.Email || '').trim();
  const hasSite = !!(row.Website || '').trim();
  if (!hasEmail && !hasSite) return 'phone_only';
  const isBig = BIG_MARKERS.some((re) => re.test(size) || re.test(name) || re.test(type));
  const isOperator = /operator|dmc|tour|travel|safaris?\b(?!.*lodge)/.test(type) || /tour|dmc/i.test(type);
  if (isOperator) return isBig ? 'large_operator' : 'small_operator';
  return isBig ? 'large_collection' : 'small_lodge';
}

function slugId(name) {
  return (name || 'lead').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    + '-' + Math.abs(hashStr(name)).toString(36).slice(0, 6);
}
function hashStr(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }

export function csvRowToLead(row) {
  const emails = (row.Email || '').trim() ? [row.Email.trim()] : [];
  const phones = (row.Phone || '').trim() ? [row.Phone.trim()] : [];
  return {
    id: slugId(row.Name),
    businessName: (row.Name || '').trim(),
    description: (row.Description || '').trim(),
    industry: (row.Type || '').trim(),
    country: (row.Country || '').trim(),
    region: (row['Region/Park'] || '').trim(),
    segment: deriveSegment(row),
    website: (row.Website || '').trim(),
    emails, phones,
    whatsapp: (row.WhatsApp || '').trim(),
    ownerName: '',
    funnelLeak: (row['FunnelLeak/Audit'] || '').trim(),
    outreachAngle: (row['OutreachAngle/Message'] || '').trim(),
    contacts: [], activity: [], researchChecklist: [],
    source: (row.Source || 'import').trim(),
    status: 'unqualified',
    qualification: null,
    crm: { notes: [], priority: 'medium', disposition: 'nurture', dealValue: 1200, outcomeReason: '', stage: 1 },
  };
}
