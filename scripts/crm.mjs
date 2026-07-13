#!/usr/bin/env node
// scripts/crm.mjs — LodgeHelm CRM terminal CLI. Reads/writes the LIVE Firestore backend
// (`leads` collection) using the exact same field names, activity shapes and timestamps
// as lodgehelm-crm.html, so terminal actions are indistinguishable from app actions.
//
// Usage:  node scripts/crm.mjs <command> [args] [--dry-run]
// Commands: today | search | show | call | wa | note | stage | stats | draft
// See scripts/CRM-CLI-README.md for full docs.

import fs from 'node:fs';
import admin from 'firebase-admin';

// ---------- boot ----------
const KEY_URL = new URL('../serviceAccountKey.json', import.meta.url);
if (!fs.existsSync(KEY_URL)) {
  console.error('ERROR: serviceAccountKey.json not found at repo root.');
  console.error('Download the Firebase service-account key for project "lodgehelm-crm"');
  console.error('and place it at the repo root (it is gitignored — never commit it).');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY_URL))) });
const db = admin.firestore();

// Attribution — matches the live data (every existing write is _modBy: 'Master').
const USER = process.env.CRM_USER || 'Master';

// ---------- arg parsing ----------
const rawArgs = process.argv.slice(2);
const args = [];
const flags = {};
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a.startsWith('--')) {
    const name = a.slice(2);
    const next = rawArgs[i + 1];
    if (next !== undefined && !next.startsWith('--')) { flags[name] = next; i++; }
    else flags[name] = true;
  } else {
    args.push(a);
  }
}
const DRY = !!flags['dry-run'];
const cmd = args.shift();

// ---------- app-mirrored constants (keep in sync with lodgehelm-crm.html) ----------
const STAGES = [
  { num: 1, name: 'New' },
  { num: 2, name: 'Researched' },
  { num: 3, name: 'Contacted' },
  { num: 4, name: 'Follow-up' },
  { num: 5, name: 'Replied' },
  { num: 6, name: 'Won' },
];
const stageName = (n) => STAGES.find((s) => s.num === n)?.name || 'Unknown';
const stageNum = (v) => {
  const n = parseInt(v, 10);
  if (n >= 1 && n <= 6) return n;
  const hit = STAGES.find((s) => s.name.toLowerCase() === String(v).toLowerCase());
  return hit ? hit.num : null;
};

// App CALL_OUTCOMES labels — activity text must match callOutcomeLabel() output exactly.
const CALL_OUTCOMES = {
  connected: 'Connected – spoke to contact',
  gatekeeper: 'Reached gatekeeper',
  voicemail: 'Left voicemail',
  no_answer: 'No answer',
  callback: 'Asked to call back',
  wrong_number: 'Wrong / dead number',
  not_interested: 'Not interested',
};
// CLI-friendly aliases -> app outcome values.
const OUTCOME_ALIASES = {
  'no-answer': 'no_answer', no_answer: 'no_answer',
  gatekeeper: 'gatekeeper',
  spoke: 'connected', connected: 'connected',
  interested: 'connected', // interested = spoke + advance to Replied
  'not-interested': 'not_interested', not_interested: 'not_interested',
  callback: 'callback',
  voicemail: 'voicemail',
  'wrong-number': 'wrong_number', wrong_number: 'wrong_number',
};

// Melusi wants ZERO em/en dashes in any outreach copy. Convert stray dashes
// (from templates or a lead's own angle/funnel-leak text) into natural punctuation.
function stripEmDashes(s) {
  return String(s == null ? '' : s)
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[—–]/g, ', ')
    .replace(/ +,/g, ',')
    .replace(/,\s*,/g, ', ')
    .replace(/,([.!?])/g, '$1')
    .replace(/,\s*$/g, '');
}
// WhatsApp per-segment templates — mirror WA_TEMPLATES in lodgehelm-crm.html (dash-free).
const WA_TEMPLATES = {
  small_lodge: (l) => `Hi ${l.ownerName || 'there'}, quick one about ${l.businessName}. When you're out with guests, do booking enquiries ever sit a while before someone replies? I built a simple tool that catches them instantly. Mind if I share how it works?\n\nMelusi, LodgeHelm`,
  large_collection: (l) => `Hi ${l.ownerName || 'there'}, across a collection like ${l.businessName}, even a few-hour delay on enquiries quietly costs bookings at the busiest camps. I run LodgeHelm and I'm happy to show how it keeps response instant across properties.\n\nMelusi`,
  small_operator: (l) => `Hi ${l.ownerName || 'there'}, in safari the operator who sends the first solid quote usually wins it. LodgeHelm helps ${l.businessName} reply instantly 24/7. Worth a 2-min look?\n\nMelusi`,
  large_operator: (l) => `Hi ${l.ownerName || 'there'}, at ${l.businessName}'s enquiry volume, nights, weekends and time-zones are where bookings leak. LodgeHelm covers those automatically. Could I send a short demo?\n\nMelusi`,
  phone_only: (l) => `Hi ${l.ownerName || 'there'}, bet a few enquiries slip past when you're on a game drive. There's a simple fix. Mind if I show you?\n\nMelusi, LodgeHelm`,
};
const waMessageFor = (l) => stripEmDashes((WA_TEMPLATES[l.segment] || WA_TEMPLATES.small_lodge)(l));
const waLink = (l) => {
  const num = (l.whatsapp || (l.phones && l.phones[0] && l.phones[0].number) || '').replace(/[^0-9]/g, '');
  return num ? `https://wa.me/${num}?text=${encodeURIComponent(waMessageFor(l))}` : '';
};

// ---------- date helpers (UTC ISO, exactly like the app's todayISO) ----------
const todayISO = new Date().toISOString().split('T')[0];
function daysUntil(iso) {
  if (!iso) return null;
  const target = new Date(iso); target.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}
const isTodayISO = (iso) => !!iso && String(iso).slice(0, 10) === todayISO;
function isTodayLead(l) {
  if (!l || !l.crm) return false;
  const fu = daysUntil(l.crm.followUpDate);
  const fuMatch = fu !== null && fu <= 0;
  const meetingToday = l.crm.meetingBooked && l.crm.meetingDate && isTodayISO(l.crm.meetingDate);
  return fuMatch || meetingToday;
}

// ---------- lead helpers ----------
function bestPhone(l) {
  return (l.phones && l.phones[0] && l.phones[0].number)
    || (l.contacts && l.contacts.find((c) => c && c.phone)?.phone) || '';
}
function bestEmail(l) {
  return (l.emails && l.emails[0] && l.emails[0].address)
    || (l.contacts && l.contacts.find((c) => c && c.email)?.email) || '';
}
function bestChannel(l) {
  const p = bestPhone(l), e = bestEmail(l);
  const w = l.whatsapp && String(l.whatsapp).trim();
  if (w) return `wa:${w}`;
  if (p) return `tel:${p}`;
  if (e) return e;
  return '(no channel)';
}
const PRIO_RANK = { high: 0, medium: 1, low: 2 };

async function loadAllLeads() {
  const snap = await db.collection('leads').get();
  const leads = [];
  snap.forEach((d) => {
    const l = d.data();
    if (l._deleted) return; // tombstoned — the app drops these too
    leads.push(l);
  });
  return leads;
}

async function getLead(idOrName) {
  // Exact id first.
  const doc = await db.collection('leads').doc(String(idOrName)).get();
  if (doc.exists && !doc.data()._deleted) return doc.data();
  // Fall back to a name search over the collection.
  const q = String(idOrName).toLowerCase();
  const leads = await loadAllLeads();
  const hits = leads.filter((l) => (l.businessName || '').toLowerCase().includes(q));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) { console.error(`No lead matches "${idOrName}".`); process.exit(1); }
  console.error(`"${idOrName}" is ambiguous — ${hits.length} matches:`);
  hits.slice(0, 15).forEach((l) => console.error(`  ${l.id}  ${l.businessName} (${l.country})`));
  process.exit(1);
}

// ---------- write layer (app-identical stamping) ----------
// The app pushes whole lead docs stamped with _modAt (ISO string), _modBy (canonical rep)
// and _srvAt (serverTimestamp). We do exactly the same so the app's merge/echo logic and
// the Activity Monitor treat CLI writes as ordinary rep writes.
function addActivity(lead, action) {
  if (!Array.isArray(lead.activity)) lead.activity = [];
  lead.activity.unshift({ action, by: USER, date: new Date().toISOString() });
}
async function saveLead(lead, summary) {
  lead._modAt = new Date().toISOString();
  lead._modBy = USER;
  if (DRY) {
    console.log(`[dry-run] would write lead ${lead.id}:`);
    console.log('  ' + summary.join('\n  '));
    return;
  }
  // Strip undefined values (Firestore rejects them; the app never writes them either).
  const clean = Object.fromEntries(Object.entries(lead).filter(([, v]) => v !== undefined));
  const payload = { ...clean, _srvAt: admin.firestore.FieldValue.serverTimestamp() };
  await db.collection('leads').doc(String(lead.id)).set(payload);
  console.log(`Saved ${lead.id}:`);
  console.log('  ' + summary.join('\n  '));
}
// Ensure the lead is in the CRM pipeline before pipeline actions (mirrors moveToCRM()).
function ensureInCRM(lead, summary) {
  if (lead.status === 'crm') return;
  lead.status = 'crm';
  lead.movedToCRMBy = USER;
  if (!lead.crm) {
    lead.crm = {
      stage: 1, disposition: 'nurture', priority: 'medium',
      dateFirstContact: '', dateLastContact: '', followUpDate: '',
      meetingBooked: false, meetingDate: '', meetingNotes: '',
      notes: [], dateMovedToCRM: todayISO, dealValue: 1200, outcomeReason: '',
    };
  } else {
    if (lead.crm.dealValue == null) lead.crm.dealValue = 1200;
    if (!lead.crm.dateMovedToCRM) lead.crm.dateMovedToCRM = todayISO;
  }
  addActivity(lead, 'moved to CRM');
  summary.push(`status -> crm (moved to CRM pipeline)`);
}
function setStage(lead, num, summary) {
  if (lead.crm.stage === num) return;
  lead.crm.stage = num;
  lead.crm.dateLastContact = todayISO;
  addActivity(lead, 'changed stage to ' + stageName(num)); // exact app text
  summary.push(`stage -> ${num} (${stageName(num)})`);
}

// ---------- printing ----------
function line(l) {
  const st = l.crm ? `${l.crm.stage}:${stageName(l.crm.stage)}` : '-';
  const prio = (l.crm && l.crm.priority) || '-';
  return [
    l.id.padEnd(44).slice(0, 44),
    (l.businessName || 'Unnamed').padEnd(34).slice(0, 34),
    (l.country || '').padEnd(13).slice(0, 13),
    (l.segment || '').padEnd(17),
    prio.padEnd(7),
    st.padEnd(13),
    bestChannel(l),
  ].join(' ');
}
const HEADER = ['ID'.padEnd(44), 'NAME'.padEnd(34), 'COUNTRY'.padEnd(13), 'SEGMENT'.padEnd(17), 'PRIO'.padEnd(7), 'STAGE'.padEnd(13), 'BEST CHANNEL'].join(' ');

// ---------- commands ----------
async function cmdToday() {
  const leads = await loadAllLeads();
  const followUpsDue = leads.filter((l) => {
    if (!l.crm || !l.crm.followUpDate) return false;
    const d = daysUntil(l.crm.followUpDate);
    if (d === null || d > 0) return false;
    if (l.crm.stage === 6) return false;
    const disp = l.crm.disposition || '';
    return disp !== 'not_interested' && disp !== 'archived';
  });
  const callbacks = leads.filter((l) => isTodayLead(l));
  const limit = parseInt(flags.limit, 10) || 25;
  const fresh = leads
    .filter((l) => (l.status === 'qualified' || l.status === 'crm')
      && l.crm && l.crm.stage <= 2
      && (!l.activity || l.activity.length === 0)
      && (!l.crm.dateFirstContact))
    .sort((a, b) => (PRIO_RANK[a.crm.priority] ?? 9) - (PRIO_RANK[b.crm.priority] ?? 9)
      || (b.crm.dataScore || 0) - (a.crm.dataScore || 0)
      || (a.businessName || '').localeCompare(b.businessName || ''))
    .slice(0, limit);

  const group = (title, arr, empty) => {
    console.log(`\n== ${title} (${arr.length}) ==`);
    if (!arr.length) { console.log(empty); return; }
    console.log(HEADER);
    arr.forEach((l) => console.log(line(l)));
  };
  console.log(`TODAY — ${todayISO}`);
  group('Follow-ups due / overdue', followUpsDue, 'No overdue follow-ups.');
  group('Callbacks & meetings today', callbacks.filter((l) => !followUpsDue.includes(l)), 'Nothing scheduled for today.');
  group(`Top not-yet-contacted qualified leads (by priority, top ${limit})`, fresh, 'All leads contacted.');
}

async function cmdSearch() {
  const q = (args.join(' ') || '').toLowerCase();
  const leads = await loadAllLeads();
  const limit = parseInt(flags.limit, 10) || 20;
  let out = leads.filter((l) => !q
    || (l.businessName || '').toLowerCase().includes(q)
    || (l.country || '').toLowerCase().includes(q)
    || (l.segment || '').toLowerCase().includes(q)
    || (l.ownerName || '').toLowerCase().includes(q));
  if (flags.country) out = out.filter((l) => (l.country || '').toLowerCase().includes(String(flags.country).toLowerCase()));
  if (flags.segment) out = out.filter((l) => (l.segment || '') === flags.segment);
  if (flags.stage) out = out.filter((l) => l.crm && l.crm.stage === parseInt(flags.stage, 10));
  if (flags.status) out = out.filter((l) => l.status === flags.status);
  out.sort((a, b) => (PRIO_RANK[a.crm?.priority] ?? 9) - (PRIO_RANK[b.crm?.priority] ?? 9)
    || (a.businessName || '').localeCompare(b.businessName || ''));
  console.log(`${out.length} match(es)${out.length > limit ? `, showing ${limit}` : ''}`);
  console.log(HEADER);
  out.slice(0, limit).forEach((l) => console.log(line(l)));
}

async function cmdShow() {
  const l = await getLead(args[0]);
  const c = l.crm || {};
  console.log(`\n${l.businessName}  [${l.id}]`);
  console.log('-'.repeat(70));
  console.log(`Status:      ${l.status}${l.qualReason ? `  (${l.qualReason})` : ''}`);
  console.log(`Stage:       ${c.stage != null ? `${c.stage} — ${stageName(c.stage)}` : '—'}   Disposition: ${c.disposition || '—'}`);
  console.log(`Priority:    ${c.priority || '—'}   Data tier: ${c.dataTier || '—'} (score ${c.dataScore ?? '—'})   Deal value: £${c.dealValue ?? '—'}`);
  console.log(`Country:     ${l.country || '—'}   Region: ${l.region || '—'}   Segment: ${l.segment || '—'}`);
  console.log(`Owner:       ${l.ownerName || '—'}`);
  console.log(`Website:     ${l.website || '—'}`);
  console.log(`WhatsApp:    ${l.whatsapp || '—'}`);
  (l.phones || []).forEach((p, i) => console.log(`Phone ${i + 1}:     ${p.number}`));
  (l.emails || []).forEach((e, i) => console.log(`Email ${i + 1}:     ${e.address}`));
  (l.contacts || []).forEach((ct, i) => console.log(`Contact ${i + 1}:   ${[ct.name, ct.role, ct.email, ct.phone].filter(Boolean).join(' · ')}`));
  console.log(`Funnel leak: ${l.funnelLeak || '—'}`);
  console.log(`Angle:       ${l.outreachAngle || '—'}`);
  console.log(`First/last contact: ${c.dateFirstContact || '—'} / ${c.dateLastContact || '—'}   Follow-up: ${c.followUpDate || '—'}`);
  if (c.meetingBooked) console.log(`Meeting:     ${c.meetingDate || '(booked, no date)'} ${c.meetingNotes || ''}`);
  if (c.outcomeReason) console.log(`Outcome reason: ${c.outcomeReason}`);
  const notes = c.notes || [];
  if (notes.length) {
    console.log(`\nNotes (${notes.length}):`);
    notes.slice(0, 5).forEach((n) => console.log(`  [${(n.timestamp || '').slice(0, 16)}] ${n.addedBy || '?'}: ${n.text}`));
  }
  const acts = l.activity || [];
  console.log(`\nActivity (${acts.length}):`);
  if (!acts.length) console.log('  (none)');
  acts.slice(0, 10).forEach((a) => console.log(`  [${(a.date || '').slice(0, 16)}] ${a.by} ${a.action}`));
}

async function cmdCall() {
  const l = await getLead(args[0]);
  const rawOutcome = flags.outcome;
  const outcome = OUTCOME_ALIASES[rawOutcome];
  if (!outcome) {
    console.error(`--outcome required. One of: ${Object.keys(OUTCOME_ALIASES).join(', ')}`);
    process.exit(1);
  }
  const summary = [];
  ensureInCRM(l, summary);
  // Mirrors logCall(): stamp last/first contact + activity with the app's exact label.
  l.crm.dateLastContact = todayISO;
  if (!l.crm.dateFirstContact) { l.crm.dateFirstContact = todayISO; summary.push(`dateFirstContact -> ${todayISO}`); }
  summary.push(`dateLastContact -> ${todayISO}`);
  if (USER !== 'Master') l.assignedTo = USER; // tagWorker() skips Master/CEO identities
  addActivity(l, 'logged call (' + CALL_OUTCOMES[outcome] + ')');
  summary.push(`activity: logged call (${CALL_OUTCOMES[outcome]})`);

  // Stage advancement rules.
  if (rawOutcome === 'interested') {
    if (l.crm.stage < 5) setStage(l, 5, summary); // Replied
    if (!flags.callback && !l.crm.followUpDate) {
      l.crm.followUpDate = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
      summary.push(`followUpDate -> ${l.crm.followUpDate} (auto, interested)`);
    }
  } else if (outcome === 'callback') {
    if (l.crm.stage < 4) setStage(l, 4, summary); // Follow-up
  } else if (l.crm.stage < 3) {
    setStage(l, 3, summary); // any dial attempt = Contacted
  }
  if (outcome === 'not_interested') {
    l.crm.disposition = 'not_interested';
    summary.push(`disposition -> not_interested`);
  }
  if (flags.callback) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(flags.callback)) { console.error('--callback must be YYYY-MM-DD'); process.exit(1); }
    l.crm.followUpDate = flags.callback;
    summary.push(`followUpDate -> ${flags.callback}`);
  } else if (outcome === 'callback' && !l.crm.followUpDate) {
    l.crm.followUpDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    summary.push(`followUpDate -> ${l.crm.followUpDate} (default: tomorrow)`);
  }
  if (flags.note) {
    l.crm.notes = l.crm.notes || [];
    l.crm.notes.unshift({ text: String(flags.note), timestamp: new Date().toISOString(), addedBy: USER });
    addActivity(l, 'added note');
    summary.push(`note: ${flags.note}`);
  }
  await saveLead(l, summary);
}

async function cmdWa() {
  const l = await getLead(args[0]);
  const link = waLink(l);
  if (!link) { console.error(`${l.businessName} has no WhatsApp/phone number.`); process.exit(1); }
  console.log(`\n${l.businessName} — segment: ${l.segment || 'small_lodge'}`);
  console.log(`\nMessage:\n${waMessageFor(l)}`);
  console.log(`\nLink:\n${link}\n`);
  if (flags.sent) {
    const summary = [];
    addActivity(l, 'WhatsApp opened with template'); // exact app text (logWhatsApp)
    summary.push('activity: WhatsApp opened with template');
    await saveLead(l, summary);
  } else {
    console.log('(not logged — pass --sent to log a WhatsApp activity)');
  }
}

async function cmdNote() {
  const l = await getLead(args[0]);
  const text = args.slice(1).join(' ');
  if (!text) { console.error('Usage: crm note <id> "text"'); process.exit(1); }
  const summary = [];
  if (!l.crm) l.crm = { stage: 1, disposition: 'nurture', priority: 'medium', notes: [], dealValue: 1200, outcomeReason: '' };
  l.crm.notes = l.crm.notes || [];
  // Mirrors addNote(): unshift {text, timestamp, addedBy} + 'added note' activity.
  l.crm.notes.unshift({ text, timestamp: new Date().toISOString(), addedBy: USER });
  addActivity(l, 'added note');
  summary.push(`note: ${text}`);
  await saveLead(l, summary);
}

async function cmdStage() {
  const l = await getLead(args[0]);
  const summary = [];
  if (flags.lost) {
    // "Lost" is a disposition, not a stage — mirrors archiveLead(id, 'not_interested').
    ensureInCRM(l, summary);
    l.status = 'archive';
    l.crm.disposition = 'not_interested';
    l.crm.outcomeReason = String(flags.lost);
    addActivity(l, 'archived (not_interested)'); // exact app text
    summary.push(`status -> archive, disposition -> not_interested, reason: ${flags.lost}`);
    await saveLead(l, summary);
    return;
  }
  const num = stageNum(args[1]);
  if (!num) { console.error(`Usage: crm stage <id> <1-6|${STAGES.map((s) => s.name).join('|')}> [--lost "reason"]`); process.exit(1); }
  ensureInCRM(l, summary);
  if (l.crm.stage === num) { console.log(`Already at stage ${num} (${stageName(num)}).`); return; }
  setStage(l, num, summary);
  await saveLead(l, summary);
}

async function cmdStats() {
  const leads = await loadAllLeads();
  const inCRM = leads.filter((l) => l.status === 'crm');
  console.log(`\nLEADS: ${leads.length} total`);
  const statuses = {};
  leads.forEach((l) => { statuses[l.status] = (statuses[l.status] || 0) + 1; });
  console.log(`Split: ${Object.entries(statuses).map(([k, v]) => `${k}=${v}`).join('  ')}  (unqualified = Lead Bank)`);
  console.log(`\nPIPELINE (status=crm, ${inCRM.length} leads):`);
  STAGES.forEach((s) => {
    const n = inCRM.filter((l) => l.crm && l.crm.stage === s.num).length;
    console.log(`  ${s.num}. ${s.name.padEnd(11)} ${n}`);
  });
  const lost = leads.filter((l) => l.crm && l.crm.disposition === 'not_interested').length;
  console.log(`  Lost (disposition=not_interested): ${lost}`);
  const weekAgo = Date.now() - 7 * 86400000;
  let acts7 = 0, callsToday = 0, actsToday = 0;
  leads.forEach((l) => (l.activity || []).forEach((a) => {
    const t = new Date(a.date).getTime();
    if (t >= weekAgo) acts7++;
    if (isTodayISO(a.date)) {
      actsToday++;
      if (String(a.action).startsWith('logged call')) callsToday++;
    }
  }));
  console.log(`\nACTIVITY: last 7 days=${acts7}   today=${actsToday}   calls today=${callsToday}`);
  const fuDue = leads.filter((l) => l.crm && l.crm.followUpDate && daysUntil(l.crm.followUpDate) <= 0 && l.crm.stage !== 6).length;
  console.log(`Follow-ups due/overdue: ${fuDue}`);
}

// Draft — mirrors getAngleLine()/generateEmail() tone from the app. No emojis, no hype,
// never the word "free". Signed Melusi / LodgeHelm / lodgehelm.app.
function angleLine(lead) {
  const angle = (lead.outreachAngle || '').trim();
  if (angle.length > 5) {
    const first = angle.split('\n')[0].replace(/^[-*\s]+/, '').trim();
    return first.charAt(0).toUpperCase() + first.slice(1) + (/[.!?]$/.test(first) ? '' : '.');
  }
  const leak = (lead.funnelLeak || '').trim();
  if (leak.length > 5) {
    const first = leak.split('\n')[0].replace(/^[-*\s]+/, '').trim();
    return 'I noticed ' + first.charAt(0).toLowerCase() + first.slice(1) + (/[.!?]$/.test(first) ? '' : '.');
  }
  return '';
}
async function cmdDraft() {
  const l = await getLead(args[0]);
  const channel = flags.channel || 'email';
  if (channel === 'whatsapp') {
    console.log(`\nWhatsApp draft for ${l.businessName} (${l.segment || 'small_lodge'}):\n`);
    console.log(waMessageFor(l));
    const link = waLink(l);
    if (link) console.log(`\n${link}`);
    return;
  }
  const seg = ['small_lodge', 'large_collection', 'small_operator', 'large_operator', 'phone_only'].includes(l.segment) ? l.segment : 'small_lodge';
  const contactName = (l.ownerName && l.ownerName.trim().split(' ')[0])
    || (l.contacts && l.contacts[0] && l.contacts[0].name && l.contacts[0].name.split(' ')[0]) || 'there';
  const biz = l.businessName;
  const valueProp = {
    small_lodge: "When you're out with guests, booking enquiries can sit for hours before anyone replies, and that's often where a booking quietly slips away.",
    large_collection: 'Across a collection like ' + biz + ', even a few-hour delay on enquiries quietly costs bookings at your busiest camps.',
    small_operator: 'In safari, the operator who sends the first solid quote usually wins it, so speed of reply matters more than almost anything.',
    large_operator: 'At ' + biz + "'s enquiry volume, nights, weekends and time-zones are where bookings quietly leak.",
    phone_only: 'A few booking enquiries always slip past when you\'re on a game drive or off-grid.',
  }[seg];
  const opener = angleLine(l) ? angleLine(l) + '\n\n' : '';
  const sign = 'Melusi\nLodgeHelm\nlodgehelm.app';
  console.log(`\nEmail draft for ${biz} (${seg})${angleLine(l) ? ' (personalised with angle)' : ' (generic, no angle on file)'}`);
  console.log(`To: ${bestEmail(l) || '(no email on file)'}`);
  console.log(`\nSubject: Quick one about ${biz}\n`);
  console.log(stripEmDashes(`Hi ${contactName},\n\nI came across ${biz} and wanted to reach out. ${opener}${valueProp}\n\nI built LodgeHelm to catch every booking enquiry and reply instantly, 24/7, so fewer slip away and more turn into confirmed bookings.\n\nHappy to show you a 2-minute example using your own enquiry flow. Worth a look?\n\nRegards,\n${sign}`));
  console.log(`\n--- Follow-up (if no reply) ---\n`);
  console.log(`Subject: Re: Quick one about ${biz}\n`);
  console.log(stripEmDashes(`Hi ${contactName},\n\nJust following up on my note about ${biz}.\n\nIf catching booking enquiries faster is useful, I can send a short demo, no obligation. No worries at all if the timing isn't right.\n\nRegards,\n${sign}`));
}

// ---------- dispatch ----------
const HELP = `LodgeHelm CRM CLI — live Firestore access

  crm today                                     Day's worklist (follow-ups, callbacks, fresh leads)
  crm search <query> [--country X] [--segment Y] [--stage N] [--status S] [--limit N]
  crm show <id-or-name>                         Full lead card + activity
  crm call <id> --outcome <no-answer|gatekeeper|spoke|interested|not-interested|callback|voicemail|wrong-number>
                [--note "..."] [--callback YYYY-MM-DD]
  crm wa <id> [--sent]                          Print wa.me link + template; --sent logs it
  crm note <id> "text"                          Add a note
  crm stage <id> <1-6|name> [--lost "reason"]   Move stage / mark lost
  crm stats                                     Pipeline + activity stats
  crm draft <id> [--channel email|whatsapp]     Ready-to-send outreach draft

  Global: --dry-run (print writes, change nothing).  Env: CRM_USER (default "Master").`;

const commands = { today: cmdToday, search: cmdSearch, show: cmdShow, call: cmdCall, wa: cmdWa, note: cmdNote, stage: cmdStage, stats: cmdStats, draft: cmdDraft };
if (!cmd || !commands[cmd]) {
  console.log(HELP);
  process.exit(cmd ? 1 : 0);
}
try {
  await commands[cmd]();
  process.exit(0);
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
