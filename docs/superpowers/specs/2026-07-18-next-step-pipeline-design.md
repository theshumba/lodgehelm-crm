# Next Step pipeline — design

**Date:** 2026-07-18 · **Approved by:** Melusi (option "Do it for me")

## Problem

After acting on a lead (send email, log call, finish a meeting) the CRM card looks
identical to before — nothing moves, nothing tells Melusi what to do next. Leads sit
silently at "Contacted" and he feels stuck.

## The one idea

Every active lead always carries exactly one **Next Step** — `{ label, due }` — and the
CRM **sets it automatically the moment an action is logged**. Always overridable.

## Data model (per-lead, inside `lead.crm`)

- `nextStep: { label: string, due: 'YYYY-MM-DD' } | null`
- `lastAction: { label: string, date: 'YYYY-MM-DD' } | null`
- **Sync rule:** `crm.followUpDate` is always kept equal to `nextStep.due` (empty when
  no step). All existing due-today / overdue logic (home stats, filters, CLI `today`,
  archive resurfacing) keeps working untouched.
- Editing `followUpDate` directly (date input, +Nd chips) writes through to
  `nextStep.due` (creating a `Follow up` step if none exists).

## Stage renames (labels only, numbers unchanged)

4 `Follow-up` → **Awaiting reply** · 5 `Replied` → **In discussion**.
CLI accepts old names as aliases.

## Auto rules

| Action | lastAction | Next step | Due | Stage |
|---|---|---|---|---|
| Email sent / compose opened | Emailed | Chase for a reply | +3d | ≥4 Awaiting reply |
| WhatsApp opened | Sent WhatsApp | Chase for a reply | +3d | ≥4 Awaiting reply |
| Call: connected | Spoke to contact | Send the info / follow-up email | +2d | ≥3 Contacted |
| Call: gatekeeper | Reached gatekeeper | Call back, ask for the owner | +2d | ≥3 |
| Call: asked to call back | They asked to call back | Call back | +1d | ≥3 |
| Call: no answer / voicemail | Called, no answer / Left voicemail | Try again | +2d | (No Answer backlog, unchanged) |
| Call: wrong number | Wrong / dead number | Find a working number | +3d | — |
| Call: not interested | Not interested | *(cleared)* | — | — |
| Meeting toggled ON | Booked a meeting | Prep for the meeting | meeting date | ≥5 In discussion |
| Meeting date changed | — | (Prep step follows new date) | — | — |
| Meeting toggled OFF | Meeting cancelled | Get the meeting rebooked | +2d | — |
| Meeting marked complete | Meeting done | Send recap / proposal | +2d | ≥5 In discussion (was: =4) |
| Stage → Won | Won the deal | *(cleared)* | — | 6 |
| Archive / Not interested | — | *(cleared, followUpDate too)* | — | — |
| Reactivate from archive | — | Get back in touch | today | — |

Auto stage moves only ever move **forward** (`bumpStage` raises, never lowers).

## UI

**Card band** (top of every CRM card, full width): `✅ <lastAction> · <date>` line, then
`➡ NEXT STEP: <label>` + due chip (red overdue / amber today / muted future) + buttons
**✓ Done**, **Snooze +3d**, **Change**. If no step: amber "No next step — dead end"
band with **+ Set next step**.

**Picker modal** (`openNextStepModal`): quick-picks (Chase for a reply · Send proposal /
quote · Prep for the meeting · Send recap / proposal · Call again · Check in later ·
custom text), date chips (Today / Tomorrow / +2d / +3d / +1w / +2w / +1m) + date input,
plus "No next step needed" (clears). **✓ Done** opens the same modal in mark-done mode
(old step becomes `lastAction`).

**Home:** priority rows show the actual next-step label ("Next: Chase for a reply")
instead of generic "Follow-up today"; new **Needs a next step** nudge listing active
CRM leads (stage <6, live disposition) with no step, one-click to set.

**Kanban + Today rows:** show the next-step label instead of the generic follow-up text.

## CLI (`scripts/crm.mjs`)

- `crm next <id> "label" [--due YYYY-MM-DD|+Nd]` — set next step (default +3d)
- `crm done <id> ["new label"] [--due ...]` — mark step done → lastAction, set new one
- `crm meeting-done <id> [--note "..."] [--due +Nd]` — stage ≥5, next = Send recap / proposal (+2d)
- `crm call` mirrors the app's auto rules; `crm show` prints Next step + Last action;
  stage names renamed with old-name aliases.

## Out of scope

Deal maths, Firestore rules, email generator, bulk actions, seed data.

## Testing

`node --check` on extracted scripts; CLI `--dry-run` against live data; first live use =
Rift Valley Explorers (Belinda) meeting-done flow.
