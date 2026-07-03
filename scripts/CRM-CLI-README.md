# LodgeHelm CRM — Terminal CLI

`scripts/crm.mjs` gives full terminal access to the **live** production CRM (Firestore
project `lodgehelm-crm`, `leads` collection — ~1081 real leads). Every write uses the exact
field names, activity shape and `_modAt`/`_modBy`/`_srvAt` stamping the web app uses, so
terminal actions appear in the app's timeline and Activity Monitor like any other rep action.

## Setup

Requires `serviceAccountKey.json` at the repo root (gitignored — **never commit it**).
The CLI exits with a clear error if it's missing.

```
npm run crm -- <command>        # via npm
node scripts/crm.mjs <command>  # direct
```

## Commands

| Command | What it does |
|---|---|
| `crm today` | Day's worklist: follow-ups due/overdue, callbacks/meetings today, top not-yet-contacted qualified leads by priority (`--limit N`, default 25) |
| `crm search <query> [--country X] [--segment Y] [--stage N] [--status qualified\|unqualified\|crm\|archive] [--limit N]` | Client-side search over name/country/segment/owner |
| `crm show <id-or-name>` | Full lead card: channels, contacts, funnel leak, angle, crm.* fields, notes, recent activity |
| `crm call <id> --outcome <no-answer\|gatekeeper\|spoke\|interested\|not-interested\|callback\|voicemail\|wrong-number> [--note "..."] [--callback YYYY-MM-DD]` | Logs a call exactly like the app's `logCall()` and advances stage (see rules below) |
| `crm wa <id> [--sent]` | Prints the wa.me deep link with the per-segment template prefilled; `--sent` logs the app's "WhatsApp opened with template" activity |
| `crm note <id> "text"` | Adds a note (`crm.notes` unshift) + "added note" activity |
| `crm stage <id> <1-6\|New\|Researched\|Contacted\|Follow-up\|Replied\|Won> [--lost "reason"]` | Moves stage; `--lost` archives with `disposition=not_interested` + `outcomeReason` (Lost is a disposition, not a stage) |
| `crm stats` | Pipeline counts per stage, qualified/bank split, activity last 7 days, calls today, follow-ups due |
| `crm draft <id> [--channel email\|whatsapp]` | Ready-to-send outreach draft (mirrors the app's `generateEmail()` tone; signed Melusi / LodgeHelm / lodgehelm.app; no emojis, no hype, never "free") |

**Global:** `--dry-run` prints what would be written without touching Firestore.
**Env:** `CRM_USER` sets attribution (default `Master` — matches all existing live writes).

### Call outcome → stage rules

- Any dial attempt on a stage-1/2 lead → stage 3 (Contacted), first/last-contact stamped.
- `callback` → stage 4 (Follow-up) + `followUpDate` (`--callback` date, else tomorrow).
- `interested` → stage 5 (Replied) + auto follow-up in 2 days if none set.
- `not-interested` → `crm.disposition = not_interested` (stage untouched).
- First committing action on a `qualified` lead promotes it to `status: crm`
  ("moved to CRM" activity), mirroring the app's `moveToCRM()`.

## Safety notes

- **This is live production data.** Reads (`today`, `search`, `show`, `stats`, `draft`) are
  always safe. For write commands, use `--dry-run` first if unsure.
- Writes replace the whole lead doc (same as the app's sync push) with fresh
  `_modAt`/`_modBy`/`_srvAt`, so the app's merge logic orders them correctly.
- Tombstoned leads (`_deleted: true`) are skipped, matching the app.
- The CLI never deletes leads — deletion stays a deliberate app/script action.
- Never commit `serviceAccountKey.json` (gitignored; verify with
  `git check-ignore serviceAccountKey.json`).

## Real output samples (2026-07-03)

`crm stats`:

```
LEADS: 1081 total
Split: qualified=990  unqualified=91  (unqualified = Lead Bank)

PIPELINE (status=crm, 0 leads):
  1. New         0
  2. Researched  0
  3. Contacted   0
  4. Follow-up   0
  5. Replied     0
  6. Won         0
  Lost (disposition=not_interested): 0

ACTIVITY: last 7 days=0   today=0   calls today=0
Follow-ups due/overdue: 0
```

`crm today --limit 8` (worklist group 3):

```
== Top not-yet-contacted qualified leads (by priority, top 8) (8) ==
ID                                           NAME                               COUNTRY       SEGMENT           PRIO    STAGE         BEST CHANNEL
ongava-game-reserve-pcsasq                   Ongava Game Reserve                Namibia       small_lodge       high    1:New         tel:083 330 3920
amakhala-safari-lodge-4mkuuz                 Amakhala Safari Lodge              South Africa  small_lodge       high    1:New         tel:+27 82 659 1796
...
```

`crm show ongava-game-reserve-pcsasq`:

```
Ongava Game Reserve  [ongava-game-reserve-pcsasq]
----------------------------------------------------------------------
Status:      qualified  (Has named contact)
Stage:       1 — New   Disposition: nurture
Priority:    high   Data tier: rich (score 90)   Deal value: £1200
Country:     Namibia   Region: —   Segment: small_lodge
Owner:       Rob Moffett
Website:     https://ongava.com/
Phone 1:     083 330 3920
Email 1:     rob.moffett@ongava.com
...
Activity (0):
  (none)
```

`crm call zz-test-cli-lead --outcome callback --callback 2026-07-04 --note "Asked to ring back Friday"`
(run against a synthetic test lead, then deleted — live leads untouched):

```
Saved zz-test-cli-lead:
  status -> crm (moved to CRM pipeline)
  dateFirstContact -> 2026-07-03
  dateLastContact -> 2026-07-03
  activity: logged call (Asked to call back)
  stage -> 4 (Follow-up)
  followUpDate -> 2026-07-04
  note: Asked to ring back Friday
```

`crm wa zz-test-cli-lead --sent`:

```
Message:
Hi Test Owner — quick one about ZZ CLI Test — delete me. When you're out with guests, do
booking enquiries ever sit a while before someone replies? I built a simple tool that
catches them instantly. Mind if I share how it works? — Melusi, LodgeHelm

Link:
https://wa.me/10000000001?text=Hi%20Test%20Owner%20%E2%80%94%20quick%20one%20about...

Saved zz-test-cli-lead:
  activity: WhatsApp opened with template
```

Resulting activity entry in Firestore (identical shape to app writes —
`{action, by, date}` newest-first):

```json
{"action":"logged call (Asked to call back)","by":"Master","date":"2026-07-03T00:16:29.517Z"}
```
