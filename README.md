# Prospect Reach

Local sales outreach automation tool for a small sales team. Personalizes and sends/
schedules outreach emails from a rep's own already-logged-in Gmail, while preserving
Mailsuite tracking — see `PROJECT_CALIBRATION.md` for full context, and its
**ARCHITECTURE PIVOT** section in particular for why this branch looks the way it does.

## Why this branch exists

Sprints 1–3 (preserved untouched on the `master` branch) built this as a Node.js app
driving a real Chrome window via Playwright/CDP against a second, dedicated Chrome
profile. It worked, and the Gmail/Mailsuite DOM knowledge from that effort is genuinely
valuable — but the second-profile requirement caused recurring setup, persistence, and
re-login problems for a non-technical rep.

This branch pivots to a **Chrome extension (Manifest V3)** that runs inside the rep's
real, everyday, already-logged-in Chrome — the same one with Mailsuite installed. No
second profile, no CDP, no automation fingerprint, and (once the extension itself is
built) no Node.js requirement for end users at all.

**Branch, not a new repo:** this is a new branch (`chrome-extension-pivot`) rather than
a separate repository, so the two architectures share one commit history and one issue
tracker, and anyone landing on the repo can see exactly where and why the pivot
happened via `git log`. `master` is left exactly as it was — a working, debugged
reference for the Playwright-era Gmail/Mailsuite selector behavior — and is not merged
into or built on top of by this branch.

## What this sprint is (repo hygiene only)

This sprint carries forward what's still valuable from the Playwright build and prunes
what no longer applies. It does **not** contain any extension code yet — no
`manifest.json`, no content script, no popup/side panel. That's Sprint 5.

**Carried forward, unchanged:**
- `src/excel.js` — parsing/validation/archiving logic. Framework-agnostic; only its
  file I/O will need to move from Node's `fs` to browser File/ArrayBuffer APIs later.
- `src/gmail-selectors.js` — real, debugged Gmail/Mailsuite DOM selector knowledge
  (compose button, Mailsuite template dropdown, schedule-send date/time widget quirks).
  The single most valuable asset from the Playwright effort — not reinvented here.
- `scripts/generate-template.js` — generates `templates/blank/prospects.xlsx` (locked
  header row, styled example row). Column structure is unchanged by the pivot.
- `scripts/generate-test-sheet.js` + `test/excel.test.js` — fixture generation and test
  coverage for `excel.js`.
- `templates/categories/*.json` — kept because `excel.js`'s `loadCategories()` reads
  this directory for row validation and the test suite depends on it existing. Not one
  of this sprint's originally-listed carry-over items — see PROJECT_CALIBRATION.md's
  pivot section for why it was kept anyway.

**Left behind, not ported:**
- `src/automation.js` and `src/templates.js` — pure Playwright API calls / only
  consumed by automation.js. No home in a content script; the *sequence knowledge*
  they encoded is already captured in `gmail-selectors.js`.
- `scripts/run-test-batch.js` — drove `automation.js` against a real Chrome profile.
- `playwright` and `express` — removed from `package.json` entirely.
- Any `CHROME_PROFILE_DIR`/`CHROME_PROFILE_NAME`/dedicated-profile concept — this
  problem category doesn't exist once the code runs inside the rep's own Chrome.
- The old Node/npm-based README instructions below (replaced by this one).

## Setup (once the extension exists)

This will use Chrome's **"Load unpacked"** developer mode — no npm, no terminal, no
build step for the end user:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this repo's extension folder.
4. Pin the extension, open Gmail, and use it from there.

This flow doesn't exist yet — Sprint 5 adds `manifest.json` and the rest of the
extension. Ship via "Load unpacked" for now (free, no publishing wait); revisit the
one-time $5 "Unlisted" Chrome Web Store listing later only if Developer Mode's warning
banners prove genuinely annoying in daily use.

## Working on the carried-over code today

The carried-over modules are still plain Node.js and can be exercised the same way
they were pre-pivot, while the extension itself is being built:

```
npm install
npm run generate:template   # (re)generates templates/blank/prospects.xlsx
npm test                    # runs the excel.js test suite
```

Requires Node.js 18+ (ES modules). This is a development convenience for iterating on
`excel.js`/`gmail-selectors.js`/templates — it is **not** how the finished tool will run
for end users.

## Excel library choice

**exceljs**, not xlsx/SheetJS. The blank template needs write-side cell styling (gray
fill + italic on the example row, bold header) and a locked/protected header row —
SheetJS's community edition has limited write-side styling support, while exceljs
supports both cleanly. (Carried over unchanged from the pre-pivot README.)

## Repo layout

```
src/excel.js                       core parsing/validation/archiving module
src/gmail-selectors.js             every known Gmail/Mailsuite DOM selector, centralized
templates/blank/prospects.xlsx     blank template reps fill in and upload
templates/categories/*.json        placeholder category definitions (superseded long-term
                                    by Mailsuite's own template library — see pivot notes)
scripts/generate-template.js       generates the blank template
scripts/generate-test-sheet.js     generates the excel.js test fixture sheet
test/excel.test.js                 test harness (node:test)
```

## Public API (`src/excel.js`)

- `loadCategories(dir)` → `Promise<Set<string>>` — reads
  `templates/categories/*.json` and returns the known category names,
  trimmed and lower-cased for case-insensitive comparison.
- `parseSheet(input)` → `Promise<object[]>` — parses an uploaded sheet (file
  path or `Buffer`) into raw row objects keyed by lower-cased column name
  (`name`, `email`, `company`, `category`), each tagged with its 1-based
  sheet row number as `__row`.
- `validateRows(rawRows, knownCategories)` → `{ ready, warnings, errors }` —
  never throws on bad data. Skips the untouched example row entirely. A
  missing/malformed email pushes a structured `{ row, column, message }`
  entry to `errors`; an unrecognized category pushes one to `warnings` but
  still lets the row through to `ready` (it's still processable). Rows with
  an email error are excluded from `ready`.
- `archiveToCsv(rows, archivePath, options?)` → appends the given rows to a
  CSV archive, writing a header line if the file doesn't exist yet, and
  stamping each row with a timestamp (`options.now` overrides the clock for
  tests).
- `resetSheet(sheetPath)` → clears all data rows after a completed run,
  preserving the header row and the styled example row.
- `commitRun({ rows, send, archivePath, sheetPath, checkpointPath })` →
  `Promise<{ sent, remaining, remainingRows, failure }>` — processes `rows`
  one at a time through the injected `send(row)` callback, archiving and
  checkpointing immediately after each successful send. If `send` throws,
  the run stops right there: everything already sent stays archived and
  checkpointed, every unsent row is returned in `remainingRows` and left
  untouched in the working sheet, and `resetSheet` is only called once every
  row has sent successfully. `readCheckpoint(checkpointPath)` recovers the
  last-known progress (`{ sentRowNumbers }`).

`COLUMNS` and `EXAMPLE_ROW` are also exported so the template/fixture
generators share a single source of truth with the validation logic.

(Note: `send(row)` above was previously implemented by Playwright's `runBatch()` in
`src/automation.js`. That implementation is gone — Sprint 5's content script/service
worker is what plugs into this callback next, driving the real Gmail DOM directly
instead of through Playwright.)

## Known open questions

Carried over from `PROJECT_CALIBRATION.md` — not yet blocking:

- Real category names/email copy pending from the team lead.
- Real templates now need to be selected from Mailsuite's own in-compose template
  picker rather than authored in our own JSON files — each category's config needs the
  exact Mailsuite template name and its specific placeholder syntax, confirmed with the
  TL per category (see PROJECT_CALIBRATION.md's pivot section).
- Realistic send volume vs. Gmail's daily sending caps hasn't been stress-tested.
- Mailsuite tracking verification hasn't happened yet.
- Two open extension design decisions are flagged, not yet settled, in
  PROJECT_CALIBRATION.md's pivot section: driving the rep's open Gmail tab vs. a
  dedicated new tab, and the Manifest V3 service worker keep-alive strategy for long
  batch runs.
