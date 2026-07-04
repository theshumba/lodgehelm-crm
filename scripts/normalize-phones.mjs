// scripts/normalize-phones.mjs — normalize every lead's phones[].number and whatsapp
// to E.164 (e.g. "083 330 3920" [South Africa] -> "+27833303920") so the app's waLink()
// produces working wa.me links. Non-destructive: the previous value is preserved at
// phones[i].original / whatsappOriginal (only set once), and unfixable values are left
// untouched and reported. Never invents digits — only reformats, drops trunk zeros and
// prepends the country calling code derived from the lead's `country` field.
//
// Usage:  node scripts/normalize-phones.mjs --dry-run   (full change table, no writes)
//         node scripts/normalize-phones.mjs             (commit changed leads only)
import fs from 'node:fs';
import admin from 'firebase-admin';
const KEY = new URL('../serviceAccountKey.json', import.meta.url);
const DRY = process.argv.includes('--dry-run');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

// Attribution — same stamping as scripts/crm.mjs so app sync ordering stays correct.
const USER = 'Master';

// ---------- country -> calling code ----------
// Core map from the outreach territories, plus countries observed in the live data
// where dropping a national trunk "0" is standard practice. Deliberately EXCLUDES
// Italy (keeps its leading 0 in E.164), Spain/US/Canada/Singapore (no trunk 0) —
// their nationally-formatted numbers are skipped rather than guessed at.
const CC_BY_COUNTRY = {
  'south africa': '27', 'kenya': '254', 'tanzania': '255', 'botswana': '267',
  'namibia': '264', 'zambia': '260', 'zimbabwe': '263', 'uganda': '256',
  'rwanda': '250', 'mozambique': '258', 'malawi': '265',
  'united kingdom': '44', 'eswatini': '268', 'madagascar': '261', 'ethiopia': '251',
  'netherlands': '31', 'germany': '49', 'sweden': '46', 'denmark': '45',
  'switzerland': '41', 'australia': '61', 'india': '91', 'sri lanka': '94',
};
// Region-style values seen in the live `country` field.
const COUNTRY_ALIASES = {
  'western cape': 'south africa', 'gauteng': 'south africa', 'mpumalanga': 'south africa',
  'arusha region': 'tanzania', 'ne madagascar': 'madagascar',
};
// Countries whose national format uses a trunk "0" that must be dropped in E.164.
// (Everything in the map above except Botswana, which has no trunk prefix.)
const NO_TRUNK_ZERO = new Set(['267']);
const ALL_CCS = Object.values(CC_BY_COUNTRY).sort((a, b) => b.length - a.length);

function countryCC(country) {
  let c = (country || '').trim().toLowerCase();
  if (!c) return null;
  c = COUNTRY_ALIASES[c] || c;
  if (CC_BY_COUNTRY[c]) return CC_BY_COUNTRY[c];
  // "Southern Mozambique", "Malkerns HQ; parks across Eswatini", etc.
  for (const key of Object.keys(CC_BY_COUNTRY)) if (c.includes(key)) return CC_BY_COUNTRY[key];
  return null;
}

// ---------- normalization core ----------
// Raw strings can contain several numbers plus notes:
//   "+27 41 450 5658 / +27 82 659 1796", "a-h +27 73 197 8694",
//   "+27 87 820 7233 / +27 83 287 2885 (24/7)", "FLAG: none on own site"
// splitCandidates() returns the plausible number-bearing parts; normalizeOne()
// turns one part into E.164 or a {skip} reason.
function splitCandidates(raw) {
  let s = String(raw || '');
  s = s.replace(/https?:\/\/\S+|www\.\S+/gi, ' '); // URLs would split badly on "/"
  s = s.replace(/\(0\)/g, '0'); // "+27 (0)71 ..." -> trunk zero, handled after CC
  return s.split(/[\/;,|]| or | and /i).map((p) => {
    // Drop parenthetical notes — "(res)", "(Greg)", "(WhatsApp only)" — including
    // groups left unclosed/unopened by the split ("(24/7)" -> "(24" + "7)").
    return p.replace(/\([^)]*\)/g, ' ').replace(/\([^)]*$/, ' ').replace(/^[^(]*?\)/, ' ');
  }).filter((p) => /\d/.test(p));
}

function normalizeOne(part, cc) {
  // Keep digits and a leading "+" only; if a "+" appears mid-string the number starts there.
  let s = part.trim();
  const plusAt = s.indexOf('+');
  if (plusAt > 0) s = s.slice(plusAt);
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/[^\d]/g, '');
  if (!digits) return { skip: 'no digits' };

  let e164 = null;
  if (hasPlus) {
    e164 = '+' + digits; // already international — keep
  } else if (digits.startsWith('00') && digits.length > 4) {
    e164 = '+' + digits.slice(2); // 00 international prefix -> +
  } else if (digits.startsWith('0')) {
    if (!cc) return { skip: 'leading 0 but country unknown' };
    e164 = '+' + cc + digits.slice(1); // national trunk 0 -> +CC
  } else if (cc && digits.startsWith(cc) && digits.length >= 10) {
    e164 = '+' + digits; // own country code present, just missing "+"
  } else {
    // Missing "+" with some OTHER known CC (e.g. a Botswana mobile stored on a
    // South Africa lead as "26771418423"). Require >= 11 digits so short national
    // numbers can't false-match a 2-digit CC.
    const other = digits.length >= 11 ? ALL_CCS.find((c) => digits.startsWith(c)) : null;
    if (other) e164 = '+' + digits;
    else return { skip: cc ? 'no rule (no leading 0/+/CC prefix)' : 'country unknown' };
  }

  // Drop a retained trunk zero right after the CC ("+27 (0)71...", "270215561157").
  const ccUsed = ALL_CCS.find((c) => e164.startsWith('+' + c));
  if (ccUsed && !NO_TRUNK_ZERO.has(ccUsed) && e164[ccUsed.length + 1] === '0' && e164.length - 1 - ccUsed.length > 9) {
    e164 = '+' + ccUsed + e164.slice(ccUsed.length + 2);
  }

  const n = e164.length - 1; // digit count
  if (n < 9) return { skip: `too short (${n} digits): ${e164}` };
  if (n > 15) return { skip: `too long (${n} digits): ${e164}` };
  return { e164 };
}

// Normalize a raw field value -> { numbers: [e164...], skips: [reason...] }
function normalizeRaw(raw, cc) {
  const numbers = []; const skips = [];
  for (const part of splitCandidates(raw)) {
    const r = normalizeOne(part, cc);
    if (r.e164) { if (!numbers.includes(r.e164)) numbers.push(r.e164); }
    else skips.push(`"${part.trim()}" — ${r.skip}`);
  }
  if (!numbers.length && !skips.length) skips.push(`"${String(raw).trim()}" — no digits`);
  return { numbers, skips };
}

// ---------- run ----------
const snap = await db.collection('leads').get();
console.log(`Leads: ${snap.size}${DRY ? '  [dry-run]' : ''}`);

const changes = [];   // { name, field, before, after }
const skipped = [];   // { name, field, reason }
const updates = [];   // { id, payload }
let numbersNormalized = 0;

for (const doc of snap.docs) {
  const l = doc.data();
  if (l._deleted) continue;
  const name = l.businessName || l.id;
  const cc = countryCC(l.country);
  const payload = {};

  // --- phones[] ---
  if (Array.isArray(l.phones) && l.phones.length) {
    const newPhones = [];
    let phonesChanged = false;
    for (const p of l.phones) {
      const raw = p && p.number;
      if (!raw || !String(raw).trim()) { newPhones.push(p); continue; }
      const { numbers, skips } = normalizeRaw(raw, cc);
      skips.forEach((reason) => skipped.push({ name, field: 'phones', reason }));
      if (!numbers.length) { newPhones.push(p); continue; } // unfixable — leave untouched
      const [first, ...extras] = numbers;
      if (first !== raw) {
        newPhones.push({ ...p, number: first, ...(p.original ? {} : { original: raw }) });
        changes.push({ name, field: 'phones', before: raw, after: numbers.join('  +  ') });
        numbersNormalized += numbers.length;
        phonesChanged = true;
      } else {
        newPhones.push(p);
      }
      // A raw string holding several numbers becomes several phones[] entries —
      // one number per field, or waLink()'s digit-strip would glue them together.
      for (const extra of extras) newPhones.push({ number: extra, original: raw });
    }
    // De-dupe expanded entries against numbers already present on the lead.
    const seen = new Set();
    const deduped = newPhones.filter((p) => {
      const k = p && p.number; if (!k) return true;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    if (phonesChanged) payload.phones = deduped;
  }

  // --- whatsapp (string; may also hold notes or several numbers — keep the first) ---
  const wa = typeof l.whatsapp === 'string' ? l.whatsapp : '';
  if (wa.trim()) {
    const { numbers, skips } = normalizeRaw(wa, cc);
    if (numbers.length) {
      if (numbers[0] !== wa) {
        payload.whatsapp = numbers[0];
        if (!l.whatsappOriginal) payload.whatsappOriginal = wa;
        changes.push({ name, field: 'whatsapp', before: wa, after: numbers[0] });
        numbersNormalized += 1;
      }
    } else {
      skips.forEach((reason) => skipped.push({ name, field: 'whatsapp', reason }));
    }
  }

  if (Object.keys(payload).length) {
    // Same stamping as scripts/crm.mjs saveLead() so the app's merge/echo logic
    // and Activity Monitor order this write correctly.
    payload._modAt = new Date().toISOString();
    payload._modBy = USER;
    updates.push({ id: doc.id, payload });
  }
}

// ---------- report ----------
console.log(`\nChange table (${changes.length} field changes):`);
console.log('  ' + 'Lead'.padEnd(38) + 'Field'.padEnd(10) + 'Before  ->  After');
for (const c of changes) {
  console.log('  ' + c.name.padEnd(38).slice(0, 38) + c.field.padEnd(10) + `"${c.before}"  ->  "${c.after}"`);
}
console.log(`\nSkipped (${skipped.length} — left unchanged):`);
for (const s of skipped) console.log(`  ${s.name.padEnd(38).slice(0, 38)}${s.field.padEnd(10)}${s.reason}`);

console.log(`\nSummary: ${updates.length} leads to write, ${numbersNormalized} numbers normalized, ${changes.length} field changes, ${skipped.length} skipped parts.`);

if (DRY) { console.log('[dry-run] no writes.'); process.exit(0); }

let n = 0;
for (let i = 0; i < updates.length; i += 400) {
  const batch = db.batch();
  for (const u of updates.slice(i, i + 400)) {
    batch.set(db.collection('leads').doc(u.id), { ...u.payload, _srvAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    n++;
  }
  await batch.commit();
  console.log(`Committed ${n}/${updates.length}`);
}
console.log('Done.');
process.exit(0);
