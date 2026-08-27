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

**Branch, not a new repo:** this is a new branch (`chrome-extension-pivot-hygiene`) rather
than a separate repository, so the two architectures share one commit history and one
issue tracker, and anyone landing on the repo can see exactly where and why the pivot
happened via `git log`. `master` is left exactly as it was — a working, debugged
reference for the Playwright-era Gmail/Mailsuite selector behavior — and is not merged
into or built on top of by this branch.

## Sprint history on this branch

- **Sprint 4 (repo hygiene):** carried forward what's still valuable from the Playwright
  build and pruned what no longer applies. No extension code yet at that point.
- **Sprint 5 (this sprint — extension scaffold + Excel layer port):** the actual, loadable
  extension now exists under `extension/` — `manifest.json`, a side panel UI, and the
  Excel validation logic ported to browser I/O. Still **no Gmail automation** — no content
  script touches `mail.google.com`, and "Run Campaign" is a visibly disabled placeholder.
  See `PROJECT_CALIBRATION.md`'s "SPRINT 5 NOTES" section for the judgment calls made
  (side panel vs. popup, testing approach, xlsx library choice) and what still needs a
  human to manually verify via "Load unpacked" (this dev environment has no real Chrome
  window to click through).

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

## Setup — for an end user (rep)

Chrome's **"Load unpacked"** developer mode — no npm, no terminal, no build step:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this repo's `extension/` folder.
4. Click the extension's toolbar icon to open the side panel — download the template,
   fill it in, upload it back, review the results.

Ship via "Load unpacked" for now (free, no publishing wait); revisit the one-time $5
"Unlisted" Chrome Web Store listing later only if Developer Mode's warning banners prove
genuinely annoying in daily use.

**What works today (Sprint 5):** download template → upload → parse → review, entirely
inside the extension, zero server. **What doesn't yet:** "Run Campaign" is a disabled
placeholder — sending/scheduling through Gmail is a later sprint.

## Working on this repo as a developer

`extension/lib/*.js`, `extension/templates/*`, and `extension/vendor/exceljs.min.js` are
all **build artifacts** — generated from `src/`, `templates/`, and `node_modules/exceljs`
respectively by `scripts/build-extension.js`. Don't hand-edit anything under
`extension/lib/` or `extension/templates/`; edit the source it was copied from and rebuild.

```
npm install
npm run generate:template   # (re)generates templates/blank/prospects.xlsx
npm run build:extension     # (re)populates extension/lib, extension/templates, extension/vendor
npm test                    # runs the full test suite (excel.js + shared validation logic)
```

Requires Node.js 18+ (ES modules) — for development only. End users never run npm; they
just load the already-built `extension/` folder, which is committed to the repo like
`templates/blank/prospects.xlsx` already was.

After changing `src/validate.js`, `src/sheet-rows.js`, `templates/blank/prospects.xlsx`,
or `templates/categories/*.json`, re-run `npm run build:extension` and commit the
regenerated `extension/` files alongside your source change — they're not auto-synced.

## Excel library choice

**exceljs**, not xlsx/SheetJS. The blank template needs write-side cell styling (gray
fill + italic on the example row, bold header) and a locked/protected header row —
SheetJS's community edition has limited write-side styling support, while exceljs
supports both cleanly. (Carried over unchanged from the pre-pivot README.)

## Repo layout

```
src/validate.js                    pure row-validation rules — zero I/O, shared verbatim
                                    with the extension (single source of truth)
src/sheet-rows.js                  pure row-extraction from an ExcelJS workbook — zero I/O,
                                    also shared verbatim with the extension
src/excel.js                       Node I/O wrapper: fs-backed parseSheet/loadCategories,
                                    archive/reset/commitRun (re-exports validate.js's API)
src/gmail-selectors.js             every known Gmail/Mailsuite DOM selector, centralized
templates/blank/prospects.xlsx     blank template reps fill in and upload
templates/categories/*.json        placeholder category definitions (superseded long-term
                                    by Mailsuite's own template library — see pivot notes)
scripts/generate-template.js       generates the blank template
scripts/generate-test-sheet.js     generates the excel.js test fixture sheet
scripts/build-extension.js         (re)populates extension/lib, extension/templates,
                                    extension/vendor from the sources above
test/excel.test.js                 Node-fs-backed test harness (node:test)
test/sheet-rows.test.js            proves validate.js/sheet-rows.js behave correctly against
                                    a Buffer/ArrayBuffer — the shape the extension hands them

extension/manifest.json            Manifest V3, minimal permissions (storage, downloads,
                                    sidePanel) — no mail.google.com host permission yet
extension/background.js            wires the toolbar icon to open the side panel; no batch
                                    orchestration lives here yet
extension/sidepanel.html/.js/.css  side panel UI: download template → upload → review
extension/lib/validate.js          <- copied from src/validate.js (build artifact)
extension/lib/sheet-rows.js        <- copied from src/sheet-rows.js (build artifact)
extension/lib/browser-excel.js     extension-specific I/O glue (fetch/FileReader/
                                    chrome.storage.session) — hand-authored, not a copy
extension/templates/               <- copied from templates/ (build artifact), plus a
                                    generated index.json listing bundled category files
extension/vendor/exceljs.min.js    <- copied from node_modules/exceljs (build artifact);
                                    the browser UMD build of the same exceljs version
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
