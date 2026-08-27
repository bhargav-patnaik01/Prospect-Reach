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

**Pre-pivot (Playwright architecture — history preserved untouched on the `master` branch,
not rebuilt here):**
- [x] Repo scaffold
- [x] Excel read/validate/archive/reset (`src/excel.js`)
- [x] Blank template file (`templates/blank/prospects.xlsx`)
- [x] Placeholder category templates
- [x] Playwright automation — send-now path (built; never manually verified against a real Gmail account)
- [x] Playwright automation — schedule-send path (built; same caveat)
- [x] Per-row failure handling (batch survives a bad row)
- [x] README (Playwright/npm-based version — superseded by this branch's README)

**Post-pivot (this branch — Chrome extension architecture):**
- [x] Repo hygiene sprint (Sprint 4) — carried forward `excel.js`, `gmail-selectors.js`,
      template generation, and test fixtures; dropped Playwright/Express; rewrote README
      for the "Load unpacked" setup flow
- [x] Sprint 5 — extension scaffold + Excel layer port (this sprint):
  - [x] `manifest.json` (Manifest V3) — `storage`, `downloads`, `sidePanel` permissions
        only; no `mail.google.com` host permission yet (not needed until Sprint 6)
  - [x] Side panel UI shell (`extension/sidepanel.html`/`.js`/`.css`) — download template
        → upload → parse → review table; "Run Campaign" present but visibly disabled
  - [x] Excel validation logic ported to browser I/O — `src/validate.js` and
        `src/sheet-rows.js` extracted as zero-I/O shared modules, copied verbatim into
        `extension/lib/` by `scripts/build-extension.js`; `extension/lib/browser-excel.js`
        supplies the browser-specific I/O glue (`fetch`/`FileReader`/`chrome.storage`)
  - [x] `loadCategories()`'s browser equivalent (`loadCategoriesBrowser()`) reads bundled
        `templates/categories/*.json` via `chrome.runtime.getURL()` + `fetch()`, using a
        build-time-generated `index.json` file list (a packaged extension has no
        `fs.readdir()` equivalent)
  - [x] Archive/reset state model designed for the new context (`buildArchiveCsv()`,
        `saveBatch()`/`loadBatch()`/`resetBatch()` against `chrome.storage.session`) — not
        wired to a working "Run Campaign" yet, since there's no batch to run
  - [ ] Manual "Load unpacked" verification in a real Chrome window (not done in this dev
        environment — no display/real Chrome available; see Sprint 5 summary for what was
        verified instead and what still needs a human to confirm)
- [ ] Content script — port `gmail-selectors.js` DOM knowledge from Playwright locators to
      plain content-script DOM code (Sprint 6)
- [ ] Background service worker — batch orchestration + keep-alive strategy (Sprint 7)
- [ ] Mailsuite in-compose template picker integration (per-category template name +
      placeholder syntax, confirmed with TL per category)
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
- `src/gmail-selectors.js`'s selector knowledge was debugged against real Gmail/Mailsuite
  DOM during the Playwright era, but never against a content-script execution context —
  expect some adaptation (Playwright locators vs. plain `document.querySelector`/DOM
  events) even though the underlying selector strings should mostly carry over as-is.

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

---

## ARCHITECTURE PIVOT (supersedes earlier Playwright-based sections above)

**Decision:** moved from Playwright/CDP browser automation to a **Chrome extension** (Manifest V3)
running directly inside the rep's real, already-logged-in Chrome and Gmail session.

**Why:** Playwright required a second, separate Chrome profile isolated from the rep's everyday
browser (Chrome's CDP automation can't safely share a lock with a live daily-use profile). This
caused three compounding, hard-to-fully-eliminate problems in practice: the profile had to be
manually set up/copied (non-technical reps struggle with this), the profile did not reliably
persist Mailsuite/login state between runs, and re-authentication was recurring. Root cause was
likely a persistence bug (profile getting reset/copied fresh each run) rather than a Chrome
security wall — but even a fully-fixed Playwright approach still requires that second profile to
exist at all, which is inherent complexity, not incidental.

A Chrome extension removes the second-profile requirement entirely: it runs inside the one
Chrome the rep already uses, with Mailsuite already installed and already logged in. No CDP, no
`--no-sandbox`/`navigator.webdriver` automation fingerprint, no Node.js requirement for end
users at all (Excel parsing happens client-side in the extension).

**What carries over from the Playwright build (not wasted work):**
- All Gmail/Mailsuite DOM selector knowledge from Sprint 3 (compose button, Mailsuite template
  dropdown, schedule-send quick-pick panel + date/time widget quirks) — translates directly from
  Playwright API calls to plain DOM manipulation in a content script.
- Sprint 1's `excel.js` validation logic — parsing/validation rules port near-as-is; only file
  I/O changes (browser File/Blob APIs vs. Node filesystem).
- The review-screen UX (download → upload → review → run → live status → summary) — same flow,
  now rendered in an extension popup/side panel instead of a localhost page.

**What's dropped:** Playwright, CDP, the dedicated automation Chrome profile and all its
env vars (`CHROME_PROFILE_DIR`, `CHROME_PROFILE_NAME`), the Express server, `npm start`,
the Node.js-installed-on-every-laptop requirement.

**New components:**
- `manifest.json` (Manifest V3) — permissions scoped to `mail.google.com`, `storage`, `downloads`.
- Content script injected into Gmail — the actual click/fill logic (ported from `automation.js`).
- Background service worker — orchestrates batch runs, messages between content script and UI.
- Popup or side-panel UI — replaces `public/index.html`.

**Open design decisions (flagged, not yet settled):**
1. Should a campaign run drive the rep's currently-open Gmail tab, or should the extension open
   a dedicated new tab for the run? (Leaning toward dedicated new tab, to avoid disrupting a rep
   actively working in their inbox — needs confirmation before building.)
2. Manifest V3 service workers are non-persistent (killed after ~30s idle) — a long batch run
   needs a keep-alive strategy (periodic ping, or driving state from the content script/side-panel
   connection instead of relying on the service worker alone). Needs to be designed in from the
   start, not discovered mid-batch.

**Distribution decision:** ship via Chrome's "Load unpacked" (Developer Mode) — free, no
publishing wait, matches $0/local/plug-and-play constraints. Revisit "Unlisted" Chrome Web Store
publishing later (one-time $5 fee, real auto-updates, less setup friction) only if Developer
Mode's occasional warning banners prove genuinely annoying to the team in practice.

**Mailsuite template picker requirement (confirmed with TL):** real templates already exist
inside Mailsuite's own template library and must be selected via Mailsuite's in-compose picker —
not authored in our own files. Personalization is NOT automatic on template insertion (confirmed:
Mailsuite inserts static text with manual placeholders); our find-and-replace logic still runs,
just against Mailsuite's inserted DOM content. Each category's config now needs, per template:
the exact Mailsuite template name (for dropdown matching) and the exact placeholder syntax used
inside that specific template (varies per template — confirm with TL per category, not assumed
globally).

**Repo hygiene sprint note (this branch):** `src/templates.js` (category token substitution) was
**not** carried forward — it was only ever consumed by `src/automation.js` (dropped entirely,
being pure Playwright API calls with no home in a content script), and nothing else in the
carried-over code imports it. The pivot's own "Mailsuite template picker requirement" above
already establishes that hand-authored category templates are being replaced by Mailsuite's own
in-compose template library, so re-porting `templates.js`'s token-substitution shape now would
likely be thrown away once real per-template placeholder syntax is confirmed with the TL.

`templates/categories/*.json` (placeholder category definitions), by contrast, **were** carried
forward as-is even though they weren't on the sprint's original five-item list — `src/excel.js`'s
`loadCategories()` reads this directory to build its set of known category names for row
validation, and `test/excel.test.js` depends on it existing to pass. Dropping it would have
broken the very carry-over items (`excel.js` + its test suite) this sprint exists to preserve.
Both `src/templates.js` and the pre-pivot `templates/categories/*.json` content still exist,
untouched, in the `master` branch's history if needed for reference later.

---

## SPRINT 5 NOTES — extension scaffold + Excel layer port

**Side panel vs. popup:** chose the side panel (`chrome.sidePanel`). A popup closes the
instant focus leaves it, which is a poor fit for a review table someone wants to actually
study — scroll through rows, maybe switch to Gmail to double-check something, then come
back — before deciding to run a campaign. The side panel stays open independent of focus.
Cost: a popup would have been slightly less code (no `background.js` needed just to call
`chrome.sidePanel.setPanelBehavior()`), but that's a small, one-time cost against a UX
mismatch that would recur every single review.

**Sharing validation logic instead of duplicating it:** `src/excel.js`'s row-validation
rules (`validateRows`) and row-extraction logic (the guts of `parseSheet`) had zero actual
Node dependencies — they only ever touched `fs` and the Node `exceljs` import in the
*wrapper* functions around them, not in the logic itself. Pulled both into their own
zero-I/O modules — `src/validate.js` and `src/sheet-rows.js` — and `scripts/build-extension.js`
copies them **verbatim** into `extension/lib/`. This means the actual validation rules
exist in exactly one place in the repo; the Node and browser I/O wrappers around them
(`src/excel.js`'s `parseSheet()`/`loadCategories()` vs. `extension/lib/browser-excel.js`'s
`parseSheetFromArrayBuffer()`/`loadCategoriesBrowser()`) are the only genuinely
environment-specific code, and that was true in the original design too — the port didn't
change the rules, only relocated them.

**Testing approach for extension-context code:** did not mock `chrome.*` APIs. Instead,
`test/sheet-rows.test.js` proves `src/sheet-rows.js` + `src/validate.js` — the exact files
copied into `extension/lib/` — behave correctly against a workbook loaded from an
in-memory `Buffer`/`ArrayBuffer` (the same shape `FileReader.readAsArrayBuffer()` hands the
extension), all under Node's built-in test runner, no mocking framework added. This works
because ExcelJS's Node build and browser UMD build (`exceljs.min.js`) implement the same
documented `Workbook`/`Worksheet` API — the same version, just two builds — so exercising
the shared logic against the Node build is a legitimate parity check, not a simulation.
What this approach *cannot* cover automatically: `chrome.runtime.getURL()`,
`chrome.storage.session`, and `fetch()` against a `chrome-extension://` URL only exist in
a real extension page context. Those — `loadCategoriesBrowser()`'s bundled-file fetch,
`saveBatch()`/`loadBatch()`/`resetBatch()`, and the vendored `exceljs.min.js` UMD bundle
actually parsing a real `.xlsx` file inside a live side panel — were **not** exercised by
an automated test in this sprint. This dev environment has no display and no real Chrome
window to drive "Load unpacked" through (its folder picker is a native OS dialog, not
something browser automation can drive even when a display is present). All extension JS
files pass `node --check` (syntax only) and `manifest.json`/`index.json` parse as valid
JSON, but **a human needs to do the actual "Load unpacked" + click-through verification**
before trusting this end-to-end. Flagged rather than claimed as done.

**xlsx library — kept exceljs, browser UMD build, not a swap to SheetJS:** exceljs ships a
`browser` field in its `package.json` (`dist/exceljs.min.js`, ~925 KB minified) implementing
the same read/write API as the Node build. Runtime-writing an `.xlsx` file was never needed
in the extension anyway — the blank template is pre-generated at build time
(`npm run generate:template`) and served as a static bundled asset; the extension only ever
*reads* an uploaded sheet at runtime. Since exceljs already had a browser build with an
identical API to what `src/sheet-rows.js` already used, swapping to SheetJS would have meant
re-verifying every row-extraction edge case against a different library's API for no
functional gain — kept exceljs to keep the ported logic verifiably unchanged.

**`templates/categories/index.json`:** a build-time-generated file listing the category
JSON filenames, because a packaged/unpacked extension has no `fs.readdir()`-equivalent to
discover its own bundled files at runtime the way `src/excel.js`'s `loadCategories()` does
via Node's `readdir`. Generated by `scripts/build-extension.js`; not hand-maintained.

**Not yet verified — needs a human:** actually running "Load unpacked" in a real Chrome
window, confirming no console errors, confirming the permissions prompt is minimal/sane,
and clicking through download → upload → review with a real filled sheet. Everything else
in this sprint's exit criteria was verified (ported test suite passes; validation rules
proven unchanged via the Buffer-based parity tests; no `mail.google.com` permission
present; "Run Campaign" is visibly disabled, not faked).
