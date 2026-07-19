# LodgeHelm HQ — "HQ is the app" redesign

**Date:** 2026-07-19 · **Owner verdict on v1:** "doesn't feel good, feels like a section
bolted inside the old CRM." All four named problems confirmed by the owner:
old CRM chrome everywhere · nothing says where to start · the HQ screen doesn't explain
itself · he expected one fresh app. Chosen direction (owner answers, 2026-07-19):
guided call-by-call day · old sections tucked away (structure left to Claude) ·
green world everywhere.

## What this is

Turn the single-file app (`lodgehelm-crm.html`) from "a CRM with an HQ tab" into
**LodgeHelm HQ — one app that runs the calling day**, with the old CRM demoted to a
back-office drawer. UI layer only. **No data-shape, rules, CLI, or Call Brain changes.**

## 1. One world — the green theme becomes the app

- Redefine the global design tokens (`:root`, and both `[data-theme]` variants map to the
  same values — one committed look, no light/dark split): deep safari green `#143b2e`
  page, ink `#1c1c19` cards, ivory `#f5efe6` text, amber `#e0863a` as primary,
  Space Grotesk display / Inter body / IBM Plex Mono details.
- Status colours reuse the existing dark-theme set (already tuned for dark surfaces).
- Theme toggle removed (one world, nothing to toggle).
- Targeted contrast pass on hardcoded colours (`.btn-primary` white-on-amber → ink, etc.).
- `#section-hq` keeps its scoped styles; the rest of the app inherits the world via tokens
  (mirror-don't-rebuild: the token system does the retheme).

## 2. Navigation flip — HQ is home, old CRM is a drawer

- The 13-item sand sidebar stops being the frame. It becomes a **"Back office" drawer**
  on every screen size: hidden by default, opened from one top-bar button, slides over.
  Same `data-section` wiring — zero logic change. HQ is removed from the drawer list
  (it's the app, not a section).
- Top bar: LodgeHelm **HQ** wordmark (click = back to HQ), lead search, refresh,
  Back office button. When a back-office section is open, a "← HQ" button appears.
- Old sections keep full function, restyled by the tokens only.

## 3. Guided day — the app tells you what to do

**Morning screen** (workspace when no lead is selected):
- Date + greeting, then the one number: "**You have N calls to make today**"
  (X overdue · Y due today). Big amber **Start calling** button.
- No due calls → offers "Call fresh leads" (top of pipeline) instead.
- First-run dismissible "How your day works" strip: Start → Prep → Call → Log → drop
  recordings on Call Brain tonight.
- Below: Call Brain inbox + patterns (unchanged content) and the day stats.

**Session mode** (`Start` pressed):
- Queue = today's due calls (or fresh pull). Hands you one lead at a time:
  land on **Prep**, big call button, script on **Call**, log the outcome → auto-advance
  to the next lead. Sticky session band: "Call 3 of 14", thin progress bar, Skip,
  End day.
- Logging an outcome via the existing outcome select is the advance trigger
  (reuses `logCall` — Next Step pipeline untouched).
- After the last call: end-of-day screen — outcomes summary + "drop today's recordings
  on Call Brain" reminder.
- Session survives refresh (localStorage `lodgehelm-hq-session`, same-day only).
- Mobile: workspace pane is the default (morning screen first, not the rail).

## 4. Workspace that explains itself

- Tabs 5 → 4, ordered as the call lifecycle, each with a plain-word caption:
  **Prep** (before the call — crib, record, notes, history) · **Call** (the script) ·
  **Send** (WhatsApp after) · **Brain** (Call Brain's notes).
- The old Answers tab folds into Prep as a collapsible "Everything they've told you"
  (same fields, same `answers` keys — the editable all-fields view lives there).
- Picking a lead always lands on Prep (read first, then dial).

## 5. Feel (Emil/design-eng rules applied)

- Custom ease-out `cubic-bezier(0.23,1,0.32,1)`; UI transitions ≤250ms.
- Press feedback `scale(0.97)` on buttons/chips; no `transition: all`.
- Session advance = 200ms fade/slide of the workspace only (never on typing re-renders).
- Progress bar animates width 300ms ease-out. Drawer slides with the iOS-ish curve.
- Reduced-motion respected via the existing media block.

## Hard constraints (must not break)

- Lead doc contract: `crib`, `stage`, `answers`, `ticks`, `brain` untouched.
- `saveState`/merge/push logic, read-light fetch, owner auth overlay: untouched.
- `scripts/crm.mjs` CLI and `call-brain` crm-push seam: untouched (they never read the HTML).
- Old sections all remain reachable and functional from the drawer.
- Firestore rules and data: untouched.

## Out of scope

Old-section redesigns beyond token inheritance · email flows · Blaze upgrade ·
retiring the Desktop call-system HTML (owner-gated, separate step).
