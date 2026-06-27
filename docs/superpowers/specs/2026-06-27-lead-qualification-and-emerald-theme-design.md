# LodgeHelm CRM — Lead Qualification Split + Emerald Theme

**Date:** 2026-06-27
**Status:** Approved & implemented

## Problem

All 1,081 leads sat at `status: "unqualified"`, so every lead rendered in the Lead Bank — there was no real Lead Bank vs Qualified separation. The built-in "Qualify" step opened Crescendo's old web-agency form (strategy design / digital commerce…), irrelevant to safari-lodge outreach, so it was never used. Separately, the ochre/safari accent (`#C9821E`) was disliked, and the earlier completeness triage had scored only ~581 of 1,081 leads.

## Lead inventory (verified live)

1,081 total = 500 original master CSV + 581 net-new Prospeo. Reachability: 826 phone, 483 email, 445 both, 217 neither (site-only). 581 have a named owner/contact (the Prospeo set); the original 500 have emails + outreach angles but no owner name.

## Qualification rule (decided with founder)

A lead is **Qualified** when ALL hold; otherwise it stays in the **Lead Bank**:

1. **Reachable** — email OR phone OR WhatsApp (any channel).
2. **ICP fit** — country is known. Foreign operators (US/UK/AU/…) are kept (they sell African safaris); only blank-country leads fail.
3. **Decision-maker (two-track)** — has a named owner/contact, **OR** has email + a written outreach angle. The second track keeps the 500 hand-enriched, emailable leads in play despite having no owner name.

**Model:** auto-split by rule. The founder can still manually **Force-qualify** a bank lead or **Send to bank** a qualified one.

### Projected & realised split

846 Qualified / 235 Lead Bank. Of the 846: 364 via named contact, 482 via email+angle. Of the 235: 199 unreachable (site-only), 18 unreachable + blank country, 18 reachable-with-country but no name/angle. "Lead Bank" now honestly means *not yet workable*.

## Implementation

### Data (`scripts/backfill-qualification.mjs`, run once, `--dry-run` supported)
- Sets `status` (`qualified`/`unqualified`) + `qualReason` on each lead. Never touches `crm`/`archive` leads.
- Re-scores completeness for all 1,081 → `crm.dataScore`, `crm.dataTier`, `crm.priority`, `dealValue`. Non-destructive merge.

### App (`lodgehelm-crm.html`)
- `computeQualification(lead)` embeds the rule (kept in sync with the script). `getQualLabel(lead)` renders the "why" chip.
- `autoQualifyLead(id, {manual})` and `sendLeadToBank(id)` mutations. New leads auto-qualify on `addLead`.
- Lead Bank now filters `status === 'unqualified'` (was `!== 'archive'`); nav badge matches. Status dropdown removed (redundant).
- Lead Bank cards: "why in bank" chip + **Force-qualify** button. Qualified cards: qualification-reason chip (replacing Crescendo service-tags), owner name, **To bank** + **Move to CRM**.

### Theme
- Emerald + sand: primary `#0F5132` (hover `#0C4429`, active `#0A3A23`), highlight `#d7e8df`; surfaces nudged to warm sand; text `#1c2b24`. Dark mode primary `#2FA968` → `#1A7A4C` → `#0F5132`. All ochre usage was token-scoped, so no hardcoded colours needed changing.

## Out of scope
Phase-2 email/AI engine; lead enrichment (finding owner names / revealing emails for the 235 bank leads).
