# Sales Outreach Automation — Project Calibration

**Purpose of this file:** give Claude Code full context on what this project is, why it's
shaped the way it is, and how we work together on it. This is not a sprint plan — sprints
get scoped and handed over one at a time in conversation. Read this once at the start of
a session; refer back to it if a decision seems to conflict with something built earlier.

---

## What this is

An internal tool for a sales team. Reps currently send outreach emails manually — same
structure every time, only name/subject/small content changes based on category. This
tool personalizes and sends/schedules those emails automatically, while preserving the
team's existing email tracking (Mailsuite) and requiring zero new subscriptions.

## Who it's for

Sales team, a few users, each running this locally on their own laptop, sending from
their own already-logged-in Gmail. Not a hosted product, not multi-tenant, not a SaaS —
a personal productivity tool that happens to be shared as a repo.

## Hard constraints — do not violate these

- **$0 budget.** No paid APIs, no paid Chrome extensions, no cloud hosting, no paid tiers
  of anything, ever, in any future sprint.
- **Fully local.** No backend server beyond `localhost`, no data leaves the laptop except
  the emails themselves going out through Gmail.
- **Cross-platform.** Must work on both macOS and Windows without divergent codepaths
  where avoidable.
- **Plug-and-play.** A non-technical sales rep should be able to double-click a shortcut
  and use it. No terminal literacy assumed after initial setup.
- **Uses the rep's real Gmail + real Chrome profile.** Not a service account, not OAuth
  API sending — the automation drives the actual browser the rep is already logged into.

## The core architectural insight (don't relitigate this without new information)

The team tracks email opens/clicks via **Mailsuite**, a free Chrome extension. Mailsuite
tracks passively by observing the real Gmail compose/send DOM in the browser — it does
**not** require any API integration, webhook, or code to talk to it. Any email sent
through an actual Gmail compose window in a browser where Mailsuite is installed gets
tracked automatically, whether a human typed it or a script filled it in.

This is why the system uses **Playwright driving the real, already-logged-in Chrome
browser** rather than the Gmail API or SMTP. API/SMTP sending would be simpler code but
would bypass Mailsuite entirely — tracking is the whole point, so this constraint is not
up for revisiting later "to simplify the code."

Mailsuite's own Mail Merge feature would solve part of this off-the-shelf but requires a
paid Advanced plan (~$9.99/user/month) — violates the $0 constraint, hence building this
instead of buying it.

## Tech stack (decided, don't re-litigate without a real reason)

- **Node.js** — runtime for everything.
- **Playwright** — browser automation, `channel: 'chrome'` against the real installed
  Chrome and the rep's actual profile, `headless: false` always (a human should be able to
  see what it's doing and intervene on 2FA/CAPTCHA).
- **Express** — tiny local server, serves the UI and a few endpoints. No database.
- **SheetJS / xlsx libraries** — Excel parsing.
- Plain HTML/CSS/JS for the UI — no framework needed at this scale, don't introduce React
  or similar unless a sprint genuinely requires it.

## Data flow (end to end, for orientation)

1. Rep downloads a blank `prospects.xlsx` template (exact columns: `Name | Email |
   Company | Category`) from the tool's UI.
2. Rep fills it with real prospect data, one category per row, matching a category name
   that has a corresponding template file.
3. Rep uploads the filled sheet back into the tool.
4. Tool validates and shows a **pre-run review screen** — every row's status (ready /
   warning + reason), nothing hidden. This is a mandatory human approval gate before any
   email goes out — never let "Run" fire without this screen having been seen.
5. Rep clicks "Run Campaign." Playwright opens Gmail compose per ready row, fills in the
   personalized subject/body, and either sends immediately or hands off to Gmail's native
   "Schedule send" (so delivery survives the laptop/browser closing later).
6. On completion: sent/scheduled rows get archived to a log CSV and cleared from the
   working sheet (header + example row preserved for next use). Unsent rows from an
   interrupted run are **never** silently dropped — this is a data-safety requirement,
   not a nice-to-have.

## Current status (update this section as sprints complete)

- [x] Repo scaffold
- [x] Excel read/validate/archive/reset (`src/excel.js`)
- [x] Blank template file (`templates/blank/prospects.xlsx`)
- [x] Placeholder category templates
- [x] Playwright automation — send-now path (built; not yet manually verified against a real Gmail account — dev environment has no real Chrome/display)
- [x] Playwright automation — schedule-send path (built; same manual-verification caveat as above)
- [x] Per-row failure handling (batch survives a bad row)
- [ ] UI — download template
- [ ] UI — upload + validate
- [ ] UI — pre-run review screen
- [ ] UI — run + live status + completion summary
- [ ] Desktop shortcuts (Mac + Windows)
- [x] README
- [ ] Real templates/categories swapped in (waiting on team lead)
- [ ] Mailsuite tracking verified against a real batch

## Known open questions (waiting on external input, not yet blocking)

- Exact categories and email copy — coming from the team lead. Template file shape
  (`{{token}}` substitution, JSON per category) is a working assumption, not locked — if
  real content needs conditional blocks, attachments, or multi-part bodies, the template
  system may need to grow beyond simple token substitution. Flag this if it comes up
  rather than forcing real content into a structure that doesn't fit.
- Realistic daily send volume vs. Gmail's sending caps (~500/day personal, ~2,000/day
  Workspace) — not yet stress-tested against actual prospect list sizes.
- Mailsuite tracking hasn't been verified end-to-end yet (extension not installed on dev
  machine as of this writing) — treat as a verification task, not a build task, once
  available.
- Sprint 2's Playwright automation layer (`src/automation.js`) is built and its pure
  logic (template resolution, per-row defensive validation) is smoke-tested, but the
  actual compose/send/schedule flows against Gmail's real DOM have not been run —
  this dev environment has no real installed Chrome, no display, and no logged-in test
  Gmail account. `scripts/run-test-batch.js` needs to be run on a real machine before
  trusting `src/gmail-selectors.js`; expect at least minor selector patching.

## How we work together on this

- Work happens **one sprint at a time.** Each sprint is scoped in conversation with the
  human before being handed to you — don't pull in scope from the roadmap below or invent
  future sprints unprompted.
- After each sprint, the human reviews the output before the next sprint is scoped. Don't
  assume the next logical step is authorized — wait for it.
- If a requirement here conflicts with something faster/simpler, raise it — don't quietly
  choose the simpler path (this already happened once: Gmail API vs. browser automation,
  and browser automation is correct here despite being more complex).
- If external inputs (templates, Mailsuite, etc.) aren't available yet, build against
  placeholders as specified rather than blocking.
- Keep this file updated: check off completed items in **Current status**, and append to
  **Known open questions** if a sprint surfaces a new one.
