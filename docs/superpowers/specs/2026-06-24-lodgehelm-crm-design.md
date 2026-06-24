# LodgeHelm CRM + AI Outreach Engine — Design Spec

**Date:** 2026-06-24
**Owner:** Melusi (founder, LodgeHelm)
**Status:** Approved design → spec for review

---

## 1. Purpose

A sales CRM for LodgeHelm's founder-led outreach to African safari lodges, camps, and
tour operators. It clones the proven Crescendo CRM front-end for call/pipeline management,
imports the existing 500-lead master list, and adds an AI-assisted email engine that
researches each company, personalises and segments outreach, sends from the founder's own
Gmail, and tracks engagement — all while protecting domain deliverability.

**Primary user:** one person (Melusi), working a daily list of calls + emails.

**Success = ** Melusi opens the app each morning, sees exactly who to call/email/follow-up,
logs calls in two clicks, and sends personalised, high-deliverability emails with an AI
draft he approves — and can see who engaged.

---

## 2. Architecture (plain terms)

A **hybrid** of the existing static CRM plus a thin backend for the jobs that cannot live
safely in a webpage (anything needing a secret key or a server endpoint).

```
┌─────────────────────────────────────────────┐
│  LodgeHelm CRM  (single-file HTML, re-skinned │
│  clone of Crescendo)                          │
│  • leads, pipeline, call logging, worklist    │
│  • reads/writes Firestore directly            │
│  • calls backend via fetch() for email + AI   │
└───────────────┬───────────────────────────────┘
                │ HTTPS
┌───────────────▼───────────────────────────────┐
│  Firebase Cloud Functions  (the thin backend)  │
│  • gmailAuth / gmailSend   (OAuth, send as you)│
│  • trackOpen / trackClick  (pixel + redirect)  │
│  • aiResearch              (company lookup)     │
│  • aiDraftEmail            (segmented draft)    │
│  • checkReplies            (auto-stop cadence)  │
│  • runSequence             (scheduled follow-ups)│
└───────────────┬───────────────────────────────┘
                │
        ┌───────┴────────┬──────────────┐
        ▼                ▼              ▼
   Firestore        Gmail API      Anthropic API
   (data store)    (send/read)     (Claude: write/research)
```

**Why this shape:**
- Reuses the Crescendo UI the founder already likes and the Firebase he already runs.
- Firebase Functions can read/write Firestore with the admin SDK, hold OAuth tokens and
  API keys securely, and host the tracking endpoints — one ecosystem, no extra hosting.
- Low-volume, highly-personalised sending from the founder's own mailbox out-performs a
  bulk cold-email tool for this audience and keeps replies in his normal inbox.

**Stack:** Vanilla HTML/JS/Tailwind (front-end, cloned) · Firebase Auth + Firestore (data)
· Firebase Cloud Functions on Blaze (backend) · Gmail API (send/read) · Anthropic Claude
API (drafting + research, with web search for company lookup).

**Repo:** `~/Documents/GitHub/lodgehelm-crm/` — separate from `crescendo-crm`. The CRM page
is `lodgehelm-crm.html`; functions live in `functions/`.

---

## 3. What the founder provides (one-time setup)

1. **Sending mailbox on a dedicated outreach domain.** Per 2026 deliverability practice
   (§8), do NOT cold-send from the primary brand domain or a free `@gmail.com`. Register a
   close cousin domain (e.g. `getlodgehelm.com` / `try-lodgehelm.com`), put a Google
   Workspace mailbox on it (`melusi@getlodgehelm.com`, ~$6/mo), and set **SPF, 2048-bit
   DKIM, and DMARC** (`p=quarantine`+) on it (guided copy-paste). This protects the main
   `lodgehelm` domain's reputation if outreach ever dips. Run a warm-up tool on the inbox.
2. **Anthropic API key** (drafting/research).
3. **Firebase Blaze plan** enabled on the LodgeHelm CRM project (pay-as-you-go, ~£0–2/mo).
4. **Google OAuth consent + client credentials** for the Gmail connection (we set up once).

---

## 4. Data model (Firestore)

Mirrors Crescendo's lead shape, plus outreach fields. Collections:

- **`leads`** — one per business. Fields: name, country, region, type, website, email,
  phone, whatsapp, establishedSize, description, bookingChannels, funnelLeak, outreachAngle,
  source, **segment** (auto: `small_lodge | large_collection | small_operator |
  large_operator | phone_only`), **stage** (New → Researched → Contacted → Follow-up →
  Replied → Won/Lost), ownerName, ownerNameConfidence, research (cached JSON), lastTouchAt,
  nextActionAt, doNotContact (bool).
- **`activities`** — call/email/whatsapp/note events per lead: type, direction, outcome,
  notes, timestamp, (email refs).
- **`emails`** — every sent email: leadId, subject, body, threadId, messageId, sentAt,
  opens[] (timestamps, treated as soft signal), clicks[] (timestamps, trusted signal),
  repliedAt, sequenceStep, status.
- **`sequences`** — active follow-up cadences: leadId, step, nextSendAt, paused (auto-true
  on reply), template.
- **`settings`** — sending caps, signature, warmup state, OAuth tokens (server-only doc),
  the baked-in email playbook (subject templates, segment guides, deliverability rules).

Existing 500-lead master CSV (`lodgehelm_leads_master.csv`) is imported on Phase 1, mapping
columns 1:1 and auto-deriving `segment` from Type + Established/Size.

---

## 5. Features

### 5.1 CRM / calling (Phase 1 — usable first)
- Cloned, re-branded LodgeHelm UI (Crescendo's pipeline, dispositions, calendar).
- Import 500 leads from the master CSV.
- Log calls (outcome, notes), set callbacks/reminders, move stages.
- Log WhatsApp + call touches (not just email) — ~70 leads are phone/WhatsApp-only.
- **Daily worklist:** one screen — today's calls, due follow-ups, un-contacted priorities.
- WhatsApp message templates (per segment) with click-to-copy / wa.me deep link.

### 5.2 AI email engine (Phase 2)
- **Company research:** on demand per lead, AI does a quick web lookup, extracts a 2-3
  line brief + the **owner/manager name** (with confidence). Cached on the lead (not
  re-spent). Powers personalisation.
- **Auto-segmentation:** each lead classified into one of 5 segments; drives tone/angle.
- **AI draft:** generates subject + body for the lead's segment — greets by first name
  ("Hi James,"), 1 line on LodgeHelm, the segment-appropriate angle, the **14-day trial**
  offer, signed as Melusi. Founder reviews/edits in the CRM before anything sends.
- **Merge-field guard:** blocks send if first name missing (no "Hi ,"); falls back to a
  safe generic opener or flags for manual edit.

### 5.3 Sending, tracking, deliverability (Phase 2)
- Send via Gmail API as the founder; the email appears in his Gmail Sent and replies return
  to his inbox. **Plain-text, ≤125 words, 0–1 link, no images/attachments** (enforced by the
  draft engine per §8).
- **Engagement signals — honest by design (§8).** In 2026 opens are unreliable: Apple Mail
  Privacy Protection (95%+ of Apple users) and Gmail image proxying inflate "opens" with
  false positives, and the open-pixel itself hurts plain-text deliverability. So:
  - **Clicks** (one wrapped link via our own tracking subdomain) and **replies** are the
    primary, trusted engagement signals shown in the CRM.
  - **Open tracking is an optional toggle, OFF by default for the first touch**, and labelled
    in the UI as "unreliable (often false)". This satisfies "did they see it?" curiosity
    without letting the founder act on bad data or harm deliverability.
- **Auto-stop on reply:** `checkReplies` watches the thread; any reply pauses the sequence
  and flags the lead as Replied. (No logic ever keys on opens.)
- **4-step follow-up cadence** over ~18 days (Day 0 / 3 / 8–10 / 16–18), each adding new
  value on the same thread, ending in a soft "breakup"; founder approves each, or enables
  auto-send within caps. (~42% of replies come from follow-ups — §8.)
- **Daily send cap + throttling + 30–45 day warmup ramp** (start 5–10/day → ramp to 40–50;
  founder-led ideal 20–40/day) to protect domain reputation.
- **One-click unsubscribe / opt-out** link + `doNotContact` enforcement (EU/UK compliant);
  physical address + opt-out in footer.
- **Timezone-aware** send suggestions (use lead country → local business morning).

### 5.4 Baked-in 2026 email playbook
A research agent runs once (during build) to produce the current best-practice playbook for
2026 SaaS cold outreach (subject lines that open without tripping spam, deliverability
rules, segment tone guides, cadence). Findings are stored in `settings` and injected into
the AI drafting prompts + offered as ready templates — not re-researched per email.
(Findings appended in §8.)

---

## 6. Phasing

- **Phase 1 — Calling CRM (first, fast):** clone + re-skin, import 500 leads, call/WhatsApp
  logging, daily worklist, deploy. Founder starts dialling immediately.
- **Phase 2 — Email engine:** Functions backend, Gmail OAuth, AI research + drafting +
  segmentation, tracking, sequences, opt-out, deliverability guards.

Each phase ships independently; Phase 1 has no backend dependency.

---

## 7. Out of scope (for now)
- Multi-user / team seats (single user).
- Inbound enquiry handling (that's the LodgeHelm product itself, not the CRM).
- Bulk/blast sending, paid email-warmup services, external ESPs.
- Instagram/Facebook outreach.

---

## 8. 2026 Email Playbook (research findings)

Researched 2026-06-24; baked into `settings.playbook` and injected into the AI draft prompts.
Source list at end of section.

### 8.1 Subject lines
Short (≤7 words / ~40 chars), lowercase or sentence-case, curiosity or a *specific*
observation about *their* business, no selling. Lowercase beat Title Case by ~21%;
personalised subjects ~2x reply rate. Reference their lodge/region/site whenever possible.

**Banned in subjects & body:** Title Case, ALL CAPS, `!`, `$`, emoji, fake `Re:`/`Fwd:`,
and the tokens: free, guarantee, act now, limited time, offer, deal, % off, 100%,
"increase revenue", "boost bookings".

**Templates (placeholders):** `quick question about {LodgeName}` · `enquiries coming in
overnight?` · `{LodgeName} — saw your booking page` · `how fast does {LodgeName} reply to
enquiries?` · `noticed something on {website}` · `{FirstName}, quick one on quotes` ·
`weekend enquiries at {LodgeName}` · `slow follow-up = lost bookings?` · `your {Region}
season is starting` · `idea for {LodgeName}'s enquiry inbox` · `who handles enquiries when
you're in camp?` · `{LodgeName} + after-hours bookings` · `2-min thought on your enquiry
flow` · `do enquiries sit overnight?`

### 8.2 Deliverability rules (hard pass/fail in 2026)
- **Auth before any send:** SPF, **2048-bit DKIM** (1024 is downranked), DMARC `p=quarantine`+.
  Dedicated sending domain + custom tracking subdomain (§3).
- **Warm-up 30–45 days:** Wk1 5–10/day → +10–15/week → Wk4 40–50/day. Steady ceiling
  50–75/day (max 100); **founder-led ideal 20–40/day**. Run a warm-up tool.
- **Body:** plain text (≈2x reply vs HTML), **0–1 link**, no images, no pixel in touch 1,
  no attachments, **≤125 words**, one low-friction CTA, real text signature.
- **Opt-out:** soft line ("if this isn't relevant, just say and I won't follow up") — cuts
  spam complaints (the #1 reputation killer). Honour instantly → `doNotContact`.
- **Body phrases to avoid:** free, guarantee, risk-free, no obligation, act now, limited
  time, exclusive deal, "Dear Sir/Madam", "I hope this email finds you well", "increase
  revenue by X%".

### 8.3 Opens vs clicks vs replies
Opens are effectively dead — Apple MPP (on by default, 95%+ of Apple users; Apple Mail
~49% of opens) pre-loads the pixel via proxy, Gmail caches images. **Never gate logic on
opens; never reference "I saw you opened this."** Trust **clicks** (one link, own tracking
subdomain, only when there's a real reason) and **replies** (the gold metric). Omit the
open-pixel on first touch entirely. Design every email to earn a one-line reply.

### 8.4 Segment messaging
| Segment | Len | Tone | The ONE angle | Sample opener |
|---|---|---|---|---|
| small_lodge | 50–80w | warm, peer-to-peer | enquiries missed while you're in camp/off-grid | "Hi {Name} — when you're out with guests at {LodgeName}, enquiries can sit for hours before anyone sees them." |
| large_collection | 80–110w | professional, ops/ROI | consistency & speed-to-quote across all properties | "Hi {Name} — across a collection like {Brand}, even a few-hour delay quietly costs bookings at your busiest camps." |
| small_operator | 60–90w | sharp, time-saving | first credible quote wins the booking | "Hi {Name} — in safari, the operator who sends the first solid itinerary usually wins it." |
| large_operator | 90–120w | credible, measured, no hype | capacity & 24/7 response SLA without growing the team | "Hi {Name} — at {Company}'s volume, even great consultants can't cover nights, weekends and time zones — that's where bookings leak." |
| phone_only | 40–60w, ultra-simple | casual, concrete, zero jargon | never miss a WhatsApp/phone enquiry | "Hi {Name} — bet a few WhatsApp enquiries slip past when you're on a game drive. There's a simple fix." |

Cross-segment: lead with *their* missed-enquiry/slow-quote world, mention "LodgeHelm" once
and late, one CTA, never sound like a discount pitch.

### 8.5 Follow-up cadence (4 touches / ~18 days)
~42% of replies come from follow-ups. Day 0 core message · Day 3 gentle bump + 1 new proof
point · Day 8–10 different angle (e.g. after-hours bookings) · Day 16–18 soft "breakup"
(often pulls the most replies). Each touch adds something new, shorter than the last, same
thread; stop on any reply/opt-out.

### 8.6 The offer (14-day trial, premium framing)
Never say "free" (cheap signal + spam trigger). Sell risk-free proof + outcome. Paste-ready:
> "If you're curious, I can set it up on {LodgeName}'s enquiries for a couple of weeks —
> you'd see exactly which bookings it catches before deciding anything. No setup on your side."

### 8.7 Engine guardrails (one line)
Plain text · ≤125 words · 0–1 link · no images/pixel touch 1 · lowercase personalised
subject · lead with their missed-enquiry problem · mention LodgeHelm once · one CTA · soft
opt-out · 4 touches/~18 days · track clicks/replies not opens · never the word "free".

**Sources:** Unify GTM (Cold Email 2026), Mailshake 2026 Deliverability Checklist, MailReach
(domain warm-up 2026), Mixmax (subject lines 2026), VerticalResponse (spam-trigger subjects
2026), Postmark & beehiiv (Apple MPP), Instantly (cold-email benchmark 2026), ReachInbox
(follow-up sequence 2026), Puzzle Inbox (plain text vs HTML), Ken Yarmosh (premium positioning).

---

## 9. Costs
~$6/mo Google Workspace + a few $/mo Anthropic + ~£0–2/mo Firebase Blaze. Under ~$15/mo.

## 10. Risks & mitigations
- **Deliverability / spam:** domain auth + warmup + caps + plain-ish text + opt-out (§5.3, §8).
- **False "opens"** (Apple/Gmail proxies): trust clicks over opens (§5.3).
- **Looking like a bot:** human approves every send in Phase 2; auto-stop on reply.
- **Token cost creep:** research cached per lead; playbook baked once, not per-email.
- **Blaze billing surprise:** set a budget alert; usage is tiny.
