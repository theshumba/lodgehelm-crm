# LodgeHelm CRM — Phase 1 (Calling CRM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a re-branded clone of the Crescendo CRM for LodgeHelm, loaded with the 500-lead master list, with call/WhatsApp logging and a daily worklist — usable for outreach immediately. No email/AI backend (that is Phase 2).

**Architecture:** Copy the proven single-file `crescendo-crm.html` into a new repo, point it at a NEW dedicated Firebase project, re-skin branding, adapt the lead schema + pipeline to safari outreach, and bulk-import the master CSV into Firestore via a tested Node importer. Deploy as a static page on GitHub Pages.

**Tech Stack:** Vanilla HTML/CSS/JS (single file) · Firebase Auth (anonymous) + Firestore (CDN v10.12.2) · Node 20+ with `firebase-admin` for the importer · `node:test` for importer unit tests · GitHub Pages for hosting.

## Global Constraints

- **Single-user app.** No team/consultant features; "consultant" concepts from Crescendo are hidden/removed where they surface in the UI.
- **Collection name stays `leads`** (Firestore), matching Crescendo's `collection(db, 'leads')` so the existing sync/render code is untouched.
- **Lead shape is whatever `normalizeLead` coerces** — new safari fields are added through `normalizeLead`, never assumed elsewhere.
- **Brand:** product name is exactly `LodgeHelm` (one word, capital L and H). Replace every `Crescendo` occurrence (51 in the HTML).
- **Source repo (read-only reference):** `~/Documents/GitHub/crescendo-crm/crescendo-crm.html`.
- **New repo (work here):** `~/Documents/GitHub/lodgehelm-crm/`.
- **Master leads CSV (read-only source):** `~/Desktop/Projects/LodgeHelm/leads/lodgehelm_leads_master.csv` (501 lines incl. header; columns: Name,Country,Region/Park,Type,Website,Email,Phone,WhatsApp,Established/Size,Description,BookingChannels,FunnelLeak/Audit,OutreachAngle/Message,Source).
- **Pipeline stages (LodgeHelm):** 6 numeric stages, labels `1 New → 2 Researched → 3 Contacted → 4 Follow-up → 5 Replied → 6 Won` (matches the existing 6-entry STAGES array where stage 6 is the terminal Win). **Lost is NOT a stage** — it is tracked via the existing `crm.disposition`/`crm.outcomeReason` (the app already handles Lost this way). Re-label only; never change stage numeric logic.
- **Segments:** `small_lodge | large_collection | small_operator | large_operator | phone_only`.
- **Secrets never committed:** service-account JSON and any keys are gitignored.

---

## Task 1: Clone Crescendo into the new repo

**Files:**
- Create: `~/Documents/GitHub/lodgehelm-crm/lodgehelm-crm.html` (copy of source)
- Create: `~/Documents/GitHub/lodgehelm-crm/index.html` (redirect to the app)
- Create: `~/Documents/GitHub/lodgehelm-crm/firestore.rules`
- Create: `~/Documents/GitHub/lodgehelm-crm/README.md`

**Interfaces:**
- Produces: a loadable `lodgehelm-crm.html` byte-identical to Crescendo except filename, still pointing at the OLD Firebase project (config swapped in Task 2).

- [ ] **Step 1: Copy the source file**

```bash
cd ~/Documents/GitHub/lodgehelm-crm
cp ~/Documents/GitHub/crescendo-crm/crescendo-crm.html ./lodgehelm-crm.html
cp ~/Documents/GitHub/crescendo-crm/firestore.rules ./firestore.rules
```

- [ ] **Step 2: Create `index.html` redirect**

```html
<!doctype html>
<meta charset="utf-8">
<title>LodgeHelm CRM</title>
<meta http-equiv="refresh" content="0; url=./lodgehelm-crm.html">
<a href="./lodgehelm-crm.html">Open LodgeHelm CRM</a>
```

- [ ] **Step 3: Create `README.md`**

```markdown
# LodgeHelm CRM
Founder outreach CRM for LodgeHelm. Cloned from Crescendo CRM, re-skinned, backed by Firebase (Firestore + anonymous auth). Phase 1 = calling/pipeline + 500 imported leads. Phase 2 = Gmail + AI email engine.

- App: `lodgehelm-crm.html`
- Lead importer: `scripts/import-leads.mjs`
- Spec: `docs/superpowers/specs/2026-06-24-lodgehelm-crm-design.md`
```

- [ ] **Step 4: Verify it loads**

Run: `open ~/Documents/GitHub/lodgehelm-crm/lodgehelm-crm.html`
Expected: the CRM UI renders (login screen with "Crescendo" branding — rebranded in Task 3). No console errors except possibly Firebase (old project). 

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/lodgehelm-crm
git add lodgehelm-crm.html index.html firestore.rules README.md
git commit -m "chore: clone Crescendo CRM into LodgeHelm repo"
```

---

## Task 2: Point at a new dedicated Firebase project

**Files:**
- Modify: `lodgehelm-crm.html:29-34` (the `apiKey`/`projectId` config object)
- Create: `.firebaserc`
- Create: `firebase.json`

**Interfaces:**
- Consumes: a Firebase project the founder creates (manual console step below).
- Produces: the app reads/writes the NEW project's `leads` collection.

- [ ] **Step 1: Founder creates the Firebase project (manual, guided)**

In the Firebase console (https://console.firebase.google.com): create project `lodgehelm-crm` → add a Web app → copy the config object → enable **Authentication → Anonymous** → create **Firestore Database** (production mode). Paste the config values into the next step.

- [ ] **Step 2: Swap the config block**

Find the config object near `lodgehelm-crm.html:29` (currently `apiKey: "AIzaSyDd2_q4ZKw8bOPhCYj8wNB1mbeco7UFKYY" ... projectId: "crescendocrm-5de1b"`). Replace ALL of its fields with the new project's values. Do not rename the surrounding `window.*_FIREBASE_CONFIG` variable — only the field values change.

- [ ] **Step 3: Create `.firebaserc`**

```json
{ "projects": { "default": "lodgehelm-crm" } }
```

- [ ] **Step 4: Create `firebase.json`**

```json
{ "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" } }
```

- [ ] **Step 5: Create empty indexes file**

```bash
echo '{ "indexes": [], "fieldOverrides": [] }' > firestore.indexes.json
```

- [ ] **Step 6: Verify connection**

Run: `open ./lodgehelm-crm.html`
Expected: app loads, anonymous sign-in succeeds (no auth error in console), lead list is empty (new project). Add a test lead via the UI → reload → it persists (confirms Firestore write/read against the new project). Delete the test lead.

- [ ] **Step 7: Commit**

```bash
git add lodgehelm-crm.html .firebaserc firebase.json firestore.indexes.json
git commit -m "feat: point CRM at new lodgehelm-crm Firebase project"
```

---

## Task 3: Re-brand Crescendo → LodgeHelm

**Files:**
- Modify: `lodgehelm-crm.html` (brand strings, `<title>`, logo SVG, footer version, theme colours)

**Interfaces:**
- Produces: a visually LodgeHelm-branded app. No data-shape changes.

- [ ] **Step 1: Replace all textual brand occurrences**

Replace every `Crescendo` with `LodgeHelm` (51 occurrences), including `<title>Crescendo CRM</title>` → `<title>LodgeHelm CRM</title>`, the `localStorage` key `crescendo-custom-reps` → `lodgehelm-custom-reps`, and the footer `Crescendo CRM v1.0` → `LodgeHelm CRM v1.0`. Also rename the config variable references from `CRESCENDO_FIREBASE_CONFIG` to `LODGEHELM_FIREBASE_CONFIG` (both the assignment and the `initializeApp(...)` read at line ~1035).

```bash
# verify count after edit — expect 0
grep -c "Crescendo\|crescendo" lodgehelm-crm.html
```
Expected: `0`.

- [ ] **Step 2: Swap the logo SVG + set brand colour**

Replace the inline logo `<svg ... aria-label="Crescendo logo">…</svg>` (around line 767) with a simple LodgeHelm mark: an ochre helm/compass glyph. Use this SVG body:

```html
<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="LodgeHelm logo">
  <circle cx="14" cy="14" r="11" stroke="currentColor" stroke-width="2"/>
  <path d="M14 3v5M14 20v5M3 14h5M20 14h5M14 14l6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <circle cx="14" cy="14" r="2.5" fill="currentColor"/>
</svg>
```

- [ ] **Step 3: Set the brand/primary colour to LodgeHelm ochre**

In the `:root` CSS variables block, set `--color-primary` to `#C9821E` (ochre) and its hover/darker variant (if present, e.g. `--color-primary-hover`) to `#A66A14`. Leave layout/spacing variables untouched.

- [ ] **Step 4: Verify branding**

Run: `open ./lodgehelm-crm.html`
Expected: title bar, login card, and footer all read "LodgeHelm"; logo is the new ochre mark; primary buttons/accents are ochre. No layout breakage.

- [ ] **Step 5: Commit**

```bash
git add lodgehelm-crm.html
git commit -m "feat: re-skin CRM branding to LodgeHelm"
```

---

## Task 4: Adapt lead schema + pipeline for safari outreach

**Files:**
- Modify: `lodgehelm-crm.html` (`normalizeLead` ~line 1771; stage/disposition labels; default dealValue)

**Interfaces:**
- Produces: leads carry safari fields (`country`, `region`, `segment`, `funnelLeak`, `outreachAngle`, `whatsapp`, `ownerName`) guaranteed by `normalizeLead`; pipeline stage labels reflect LodgeHelm stages.

- [ ] **Step 1: Extend `normalizeLead` with safari fields**

Inside `normalizeLead`, after the existing string coercions, add (keep idempotent style):

```javascript
  if (typeof l.country !== 'string') l.country = l.country == null ? '' : String(l.country);
  if (typeof l.region !== 'string') l.region = l.region == null ? '' : String(l.region);
  if (typeof l.segment !== 'string') l.segment = l.segment == null ? '' : String(l.segment);
  if (typeof l.funnelLeak !== 'string') l.funnelLeak = l.funnelLeak == null ? '' : String(l.funnelLeak);
  if (typeof l.outreachAngle !== 'string') l.outreachAngle = l.outreachAngle == null ? '' : String(l.outreachAngle);
  if (typeof l.whatsapp !== 'string') l.whatsapp = l.whatsapp == null ? '' : String(l.whatsapp);
  if (typeof l.ownerName !== 'string') l.ownerName = l.ownerName == null ? '' : String(l.ownerName);
```

- [ ] **Step 2: Lower the default deal value for the safari market**

In `normalizeLead`, change `if (l.crm.dealValue == null) l.crm.dealValue = 15000;` to `= 1200;` (annual SaaS-ish value, GBP). This only sets a default; existing values are preserved.

- [ ] **Step 3: Map pipeline stage labels**

Find the UI stage label map (stages keyed by the numeric `crm.stage`; Crescendo uses 1..N with labels like Qualified/Contacted/Nurturing/Follow-up). Re-label the displayed stage names to the LodgeHelm set in order: `1 New, 2 Researched, 3 Contacted, 4 Follow-up, 5 Replied, 6 Won, 7 Lost`. Change only the human-readable labels, not the numeric stage logic.

- [ ] **Step 4: Verify**

Run: `open ./lodgehelm-crm.html`
Expected: add a lead, open it, confirm the stage dropdown shows the LodgeHelm stage names; no console errors; default deal value shows 1200.

- [ ] **Step 5: Commit**

```bash
git add lodgehelm-crm.html
git commit -m "feat: adapt lead schema and pipeline stages for safari outreach"
```

---

## Task 5: Tested CSV→lead transform (pure logic)

**Files:**
- Create: `scripts/lib/transform.mjs`
- Create: `scripts/lib/transform.test.mjs`
- Create: `package.json`

**Interfaces:**
- Produces: `csvRowToLead(row)` → normalized lead object; `deriveSegment(row)` → segment string. Consumed by Task 6's importer.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lodgehelm-crm-scripts",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test", "import": "node scripts/import-leads.mjs" },
  "dependencies": { "firebase-admin": "^12.0.0", "csv-parse": "^5.5.0" }
}
```

- [ ] **Step 2: Write the failing test**

Create `scripts/lib/transform.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRowToLead, deriveSegment } from './transform.mjs';

const lodgeRow = {
  Name: 'Emdoneni Lodge', Country: 'South Africa', 'Region/Park': 'KwaZulu-Natal',
  Type: 'Lodge', Website: 'https://emdonenilodge.com', Email: 'info@emdonenilodge.com',
  Phone: '+27 35 562 7000', WhatsApp: '', 'Established/Size': '',
  Description: 'Family lodge', BookingChannels: 'Email',
  'FunnelLeak/Audit': 'Single inbox', 'OutreachAngle/Message': 'Hi — enquiries wait',
  Source: 'agent-batch-2026-06-23',
};

test('deriveSegment: lodge with no group markers -> small_lodge', () => {
  assert.equal(deriveSegment(lodgeRow), 'small_lodge');
});

test('deriveSegment: collection markers -> large_collection', () => {
  assert.equal(deriveSegment({ ...lodgeRow, Name: 'Olifani Safari Collection', Type: 'Lodge collection' }), 'large_collection');
});

test('deriveSegment: small operator', () => {
  assert.equal(deriveSegment({ ...lodgeRow, Type: 'Tour operator/DMC', 'Established/Size': 'KATO Category E' }), 'small_operator');
});

test('deriveSegment: large operator via category A', () => {
  assert.equal(deriveSegment({ ...lodgeRow, Type: 'Tour operator/DMC', 'Established/Size': 'KATO Category A' }), 'large_operator');
});

test('deriveSegment: no email and no website -> phone_only', () => {
  assert.equal(deriveSegment({ ...lodgeRow, Email: '', Website: '', Phone: '+267 686 1449' }), 'phone_only');
});

test('csvRowToLead maps fields and arrays', () => {
  const lead = csvRowToLead(lodgeRow);
  assert.equal(lead.businessName, 'Emdoneni Lodge');
  assert.equal(lead.country, 'South Africa');
  assert.equal(lead.region, 'KwaZulu-Natal');
  assert.deepEqual(lead.emails, ['info@emdonenilodge.com']);
  assert.deepEqual(lead.phones, ['+27 35 562 7000']);
  assert.equal(lead.segment, 'small_lodge');
  assert.equal(lead.funnelLeak, 'Single inbox');
  assert.equal(lead.outreachAngle, 'Hi — enquiries wait');
  assert.equal(lead.crm.stage, 1);
  assert.ok(typeof lead.id === 'string' && lead.id.length > 0);
});

test('csvRowToLead handles missing email (no empty-string entries)', () => {
  const lead = csvRowToLead({ ...lodgeRow, Email: '', WhatsApp: '+27 11 000 0000' });
  assert.deepEqual(lead.emails, []);
  assert.equal(lead.whatsapp, '+27 11 000 0000');
});
```

- [ ] **Step 3: Run the test (expect fail)**

Run: `cd ~/Documents/GitHub/lodgehelm-crm && node --test scripts/lib/transform.test.mjs`
Expected: FAIL — `Cannot find module './transform.mjs'`.

- [ ] **Step 4: Implement `scripts/lib/transform.mjs`**

```javascript
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
```

- [ ] **Step 5: Run the test (expect pass)**

Run: `node --test scripts/lib/transform.test.mjs`
Expected: PASS — all 7 tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/lib/transform.mjs scripts/lib/transform.test.mjs
git commit -m "feat: tested CSV-to-lead transform with segment derivation"
```

---

## Task 6: Firestore importer + load the 500 leads

**Files:**
- Create: `scripts/import-leads.mjs`
- Modify: `.gitignore` (ignore service-account key)

**Interfaces:**
- Consumes: `csvRowToLead` (Task 5); a Firebase service-account key (founder downloads); the master CSV.
- Produces: 500 lead docs in the new project's `leads` collection, keyed by `lead.id`.

- [ ] **Step 1: Gitignore the service-account key**

Append to `.gitignore`:

```
serviceAccountKey.json
```

- [ ] **Step 2: Founder downloads the service-account key (manual)**

Firebase console → Project settings → Service accounts → Generate new private key → save as `~/Documents/GitHub/lodgehelm-crm/serviceAccountKey.json` (gitignored).

- [ ] **Step 3: Install dependencies**

Run: `cd ~/Documents/GitHub/lodgehelm-crm && npm install`
Expected: `firebase-admin` and `csv-parse` install with no errors.

- [ ] **Step 4: Write the importer**

```javascript
// scripts/import-leads.mjs — batch-import the master CSV into Firestore.
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import admin from 'firebase-admin';
import { csvRowToLead } from './lib/transform.mjs';

const CSV = process.env.CSV_PATH
  || '/Users/theshumba/Desktop/Projects/LodgeHelm/leads/lodgehelm_leads_master.csv';
const KEY = new URL('../serviceAccountKey.json', import.meta.url);

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(KEY))) });
const db = admin.firestore();

const rows = parse(fs.readFileSync(CSV), { columns: true, skip_empty_lines: true, trim: true });
const leads = rows.map(csvRowToLead).filter((l) => l.businessName);
console.log(`Parsed ${leads.length} leads from CSV`);

let n = 0;
for (let i = 0; i < leads.length; i += 400) {
  const batch = db.batch();
  for (const lead of leads.slice(i, i + 400)) {
    batch.set(db.collection('leads').doc(lead.id), lead, { merge: true });
    n++;
  }
  await batch.commit();
  console.log(`Committed ${n}/${leads.length}`);
}
console.log('Done.');
process.exit(0);
```

- [ ] **Step 5: Dry-run the parse count (no write) to sanity-check**

Run: `node -e "import('csv-parse/sync').then(async m=>{const fs=await import('node:fs');const t=await import('./scripts/lib/transform.mjs');const rows=m.parse(fs.readFileSync(process.env.CSV_PATH||'/Users/theshumba/Desktop/Projects/LodgeHelm/leads/lodgehelm_leads_master.csv'),{columns:true,skip_empty_lines:true,trim:true});console.log('rows',rows.length,'leads',rows.map(t.csvRowToLead).filter(l=>l.businessName).length);})"`
Expected: `rows 500 leads 500` (or 500/500).

- [ ] **Step 6: Run the import**

Run: `npm run import`
Expected: logs `Parsed 500 leads`, then `Committed 400/500`, `Committed 500/500`, `Done.`

- [ ] **Step 7: Verify in the app**

Run: `open ./lodgehelm-crm.html`
Expected: 500 leads visible; spot-check one (e.g. "Emdoneni Lodge") shows country/region/segment/funnelLeak/outreachAngle populated and a phone/email. Re-running `npm run import` does NOT duplicate (merge by id).

- [ ] **Step 8: Commit**

```bash
git add .gitignore scripts/import-leads.mjs
git commit -m "feat: Firestore lead importer; load 500-lead master list"
```

---

## Task 7: Daily worklist view

**Files:**
- Modify: `lodgehelm-crm.html` (add a "Today" view/section + nav entry)

**Interfaces:**
- Consumes: existing `isTodayLead(l)`, `daysUntil`, `state.leads`.
- Produces: a single screen listing today's actions, grouped.

- [ ] **Step 1: Add a "Today" nav item + view container**

Add a top-nav/sidebar entry "Today" that shows a view with three grouped lists, computed from `state.leads`:
- **Follow-ups due** — `l.crm.followUpDate` with `daysUntil(...) <= 0` and stage not Won/Lost.
- **Callbacks / meetings today** — `isTodayLead(l)` true.
- **Not yet contacted** — `l.crm.stage <= 2` (New/Researched) with no activity, capped at 25, sorted by segment then name.

Each row: business name, segment badge, country, the primary phone (click-to-call `tel:`) and a WhatsApp button (Task 8), and a quick "log call" affordance reusing the existing call-logging modal/handler.

- [ ] **Step 2: Make "Today" the default view on load**

Set the initial active view to "Today" so the founder lands on the worklist.

- [ ] **Step 3: Verify**

Run: `open ./lodgehelm-crm.html`
Expected: app opens on "Today"; the three groups populate (Not-yet-contacted shows imported leads); clicking a lead opens its detail; `tel:` link is present.

- [ ] **Step 4: Commit**

```bash
git add lodgehelm-crm.html
git commit -m "feat: daily worklist (Today) view"
```

---

## Task 8: WhatsApp logging + templates

**Files:**
- Modify: `lodgehelm-crm.html` (activity types, WhatsApp deep link, per-segment templates)

**Interfaces:**
- Consumes: `state.leads`, the existing activity-logging path, `lead.whatsapp`/`lead.phones`, `lead.segment`, `lead.ownerName`.
- Produces: a WhatsApp action that opens `wa.me` with a pre-filled, segment-appropriate message and logs a `whatsapp` activity.

- [ ] **Step 1: Add a per-segment WhatsApp template map**

Add a constant near the top of the script:

```javascript
const WA_TEMPLATES = {
  small_lodge: (l) => `Hi ${l.ownerName || 'there'} — quick one about ${l.businessName}. When you're out with guests, do booking enquiries ever sit a while before someone replies? I built a simple tool that catches them instantly. Mind if I share how it works? — Melusi, LodgeHelm`,
  large_collection: (l) => `Hi ${l.ownerName || 'there'} — across a collection like ${l.businessName}, even a few-hour delay on enquiries quietly costs bookings at the busiest camps. I run LodgeHelm — happy to show how it keeps response instant across properties. — Melusi`,
  small_operator: (l) => `Hi ${l.ownerName || 'there'} — in safari the operator who sends the first solid quote usually wins it. LodgeHelm helps ${l.businessName} reply instantly 24/7. Worth a 2-min look? — Melusi`,
  large_operator: (l) => `Hi ${l.ownerName || 'there'} — at ${l.businessName}'s enquiry volume, nights/weekends/time-zones are where bookings leak. LodgeHelm covers those automatically. Could I send a short demo? — Melusi`,
  phone_only: (l) => `Hi ${l.ownerName || 'there'} — bet a few enquiries slip past when you're on a game drive. There's a simple fix — mind if I show you? — Melusi, LodgeHelm`,
};
function waMessageFor(l) { return (WA_TEMPLATES[l.segment] || WA_TEMPLATES.small_lodge)(l); }
function waLink(l) {
  const num = (l.whatsapp || l.phones[0] || '').replace(/[^0-9]/g, '');
  return num ? `https://wa.me/${num}?text=${encodeURIComponent(waMessageFor(l))}` : '';
}
```

- [ ] **Step 2: Add a WhatsApp button to the lead detail + Today rows**

In the lead detail view and in each Today-view row, render a "WhatsApp" button when `waLink(l)` is non-empty; on click, `window.open(waLink(l), '_blank')` and log an activity of type `whatsapp` (reuse the existing activity-append helper, with `direction: 'out'`, `notes: 'WhatsApp opened with template'`).

- [ ] **Step 3: Verify**

Run: `open ./lodgehelm-crm.html`
Expected: open a phone_only lead → WhatsApp button present → clicking opens wa.me with the pre-filled segment message; an activity row "WhatsApp opened…" appears on the lead. A lead with no number shows no WhatsApp button.

- [ ] **Step 4: Commit**

```bash
git add lodgehelm-crm.html
git commit -m "feat: WhatsApp deep-link + per-segment templates + logging"
```

---

## Task 9: Deploy to GitHub Pages

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Produces: the CRM live at a GitHub Pages URL.

- [ ] **Step 1: Create the Pages workflow**

```yaml
name: Deploy Pages
on:
  push: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deployment.outputs.page_url }}" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: "." }
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Founder creates the GitHub repo + enables Pages (manual)**

Create a private GitHub repo `lodgehelm-crm`, push, then in repo Settings → Pages → Source = "GitHub Actions".

- [ ] **Step 3: Push**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy CRM to GitHub Pages"
git remote add origin git@github.com:theshumba/lodgehelm-crm.git   # if not already set
git push -u origin main
```

- [ ] **Step 4: Verify live**

Open the Pages URL (`https://theshumba.github.io/lodgehelm-crm/`).
Expected: LodgeHelm CRM loads, signs in anonymously, shows the 500 leads, opens on the Today view. Log a call on one lead → reload → it persists (Firestore).

- [ ] **Step 5: Update memory note (optional)**

Record the live URL + Firebase project in the LodgeHelm GTM memory.

---

## Self-Review

**Spec coverage (Phase 1 items):**
- Clone Crescendo → Tasks 1–4. ✓
- New dedicated Firebase project → Task 2. ✓
- Re-brand → Task 3. ✓
- Safari lead schema + LodgeHelm stages + segments → Tasks 4–5. ✓
- Import 500 leads → Tasks 5–6. ✓
- Call logging → reused from Crescendo (Task 1) + surfaced in Today view (Task 7). ✓
- WhatsApp logging + templates → Task 8. ✓
- Daily worklist → Task 7. ✓
- Deploy → Task 9. ✓
- (Phase 2 items — Gmail/AI/tracking/sequences/opt-out — intentionally deferred to the Phase 2 plan.)

**Placeholder scan:** No TBD/TODO; all code shown; manual steps (Firebase project, service key, GitHub repo) are unavoidable founder actions, each with exact instructions.

**Type consistency:** `csvRowToLead`/`deriveSegment` signatures match between Task 5 (def + tests) and Task 6 (import). Lead fields added in Task 4's `normalizeLead` (`country, region, segment, funnelLeak, outreachAngle, whatsapp, ownerName`) match those produced by `csvRowToLead` in Task 5 and consumed by `waLink`/templates in Task 8. Stage numeric `1` (New) used consistently in Task 4 labels, Task 5 transform, and Task 7 worklist.
