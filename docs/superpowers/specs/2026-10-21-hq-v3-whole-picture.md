# HQ v3: the whole sales picture (21 October 2026)

Owner ask: "completely improve the LodgeHelm HQ and everything that can be improved, even if you
revamp it. Just make sure you don't mess anything up with the data."

## What the live data showed (snapshot of 2,285 leads, 21 Oct)

- 234 lodges have had one to three emails from the outreach engine. HQ filed every one of them under
  "Fresh cold" and offered a cold-call script that never mentions the emails.
- The engine logged 12 replies: 3 real ones (Colobus, Sambiya River, Wild Ridge), 2 auto-replies,
  7 "remove me" or "no". HQ showed none of them, and the real replies had no next step.
- Notes written by the engine are often stored three or four times, with the quoted email thread
  attached. The desk showed every copy, and the note date was blank (it read `n.date`, the data has
  `n.timestamp`).
- Logging "Not interested" on a call never set the lodge to not interested, so it stayed in the list.
- Back-office copy still spoke of a team, "Master", and "lead density across the UK".
- The UI copy is full of em dashes.

## What v3 changes

Look stays the green world (approved July). No change to the lead-doc contract, sync, merge, rules,
CLI or Call Brain seam. Every new view is derived from data that already exists.

1. **Contact history, derived.** One helper reads activity, notes and `crm.outreachReplyKind` and
   answers: emails sent, last email, replied (and the cleaned reply text), calls made, WhatsApps,
   asked not to be contacted.
2. **Rail in true order:** Wrote back · Due today · In play · Emailed, no reply · Spoken to · Never
   contacted. Country chips fold into one dropdown.
3. **Today screen leads with one next move:** replies first, then due calls, then lodges already
   emailed (warm), then never-contacted. Each can start a guided run. Adds a pipeline strip and a
   plain-language email outreach status read from `engineStatus/outreach` (one read).
4. **Desk:** "Asked not to be contacted" lodges get a red banner and no call, WhatsApp or email
   buttons. A "They wrote back" card shows the cleaned reply. "The story so far" replaces raw
   history. Emailed lodges get an opener that references the email. Notes deduped, dates fixed.
5. **Safety:** HQ write actions wait for the first cloud fetch, so a stale cached copy can never
   overwrite newer cloud data. One-click JSON backup in the drawer. `todayISO` stops going stale
   past midnight. "Not interested" on a call now archives as not interested.
6. **Copy:** no em dashes in HQ, one voice, single-user wording in the back office.
