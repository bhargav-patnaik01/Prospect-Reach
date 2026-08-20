# Prospect Reach

Local sales outreach automation tool. Sprint 1 built the foundation: repo
scaffold, the blank Excel template, and the Excel ingestion/validation/
archiving layer (`src/excel.js`). Sprint 2 added the Playwright browser
automation layer (`src/automation.js`, `src/templates.js`) that takes
Sprint 1's `ready` rows and actually composes and sends/schedules Gmail
messages by driving a real, already-logged-in Chrome window — not the
Gmail API — so it behaves exactly like a human using Gmail. Still no UI, no
Express server, and no real email copy (placeholder categories only) —
those are later sprints. Mailsuite-specific tracking verification is a
separate, later sprint too.

## Setup

```
npm install
npm run generate:template   # (re)generates templates/blank/prospects.xlsx
npm test                    # runs the excel.js test suite
```

Requires Node.js 18+ (ES modules).

## Running the Playwright automation layer

`src/automation.js` drives **real, installed Chrome** (`channel: 'chrome'`,
not Playwright's bundled Chromium) against **your actual Chrome profile**,
via `launchPersistentContext`. It builds no login flow and expects Gmail to
already be authenticated in that profile when the browser window opens.

**Precondition:** the Chrome profile directory you point it at must already
be logged into a test Gmail account — use a throwaway test account, not a
real rep's inbox, while this is unverified. No credentials are read, stored,
or hardcoded anywhere in this repo.

To run the manual test batch (**this actually sends/schedules real mail** —
it is not part of `npm test` and does not run in CI):

```
CHROME_PROFILE_DIR="/path/to/a/chrome/profile" node scripts/run-test-batch.js
```

On Windows, `CHROME_PROFILE_DIR` is typically a **copy** of a folder under
`%LOCALAPPDATA%\Google\Chrome\User Data` — use a copy, not your live profile,
so the automated window can't collide with a Chrome window you're actively
using. The script opens a visible (`headless: false`) Chrome window, sends
half the fixture rows now, schedules the other half, and prints a
`{ succeeded, failed }` summary. Verify manually in the test account that
sent messages arrived, scheduled messages show under "Scheduled," and the
one deliberately bad row (malformed email) landed only in `failed`.

### Maintenance note: Gmail DOM fragility

Every Gmail selector automation.js touches lives in `src/gmail-selectors.js`.
Gmail changes its DOM without notice and its class names are obfuscated, so
selectors there prefer `aria-label`/`data-tooltip`/visible text over class
names. If `composeMessage`, `sendNow`, or `scheduleSend` start timing out,
that file is the one place to check and patch — `scheduleSend` in particular
throws a specific error naming the selector that went missing, rather than
silently falling back to send-now.

## Excel library choice

**exceljs**, not xlsx/SheetJS. The blank template needs write-side cell
styling (gray fill + italic on the example row, bold header) and a locked/
protected header row — SheetJS's community edition has limited write-side
styling support, while exceljs supports both cleanly.

## npm scripts

- `npm run generate:template` — deterministically (re)writes
  `templates/blank/prospects.xlsx` from `scripts/generate-template.js`.
- `npm test` — runs `test/excel.test.js` via Node's built-in test runner
  (`node --test`), no extra framework.

## Repo layout

```
src/excel.js                       core parsing/validation/archiving module
src/automation.js                  Playwright browser automation (compose/send/schedule/batch)
src/gmail-selectors.js             every Gmail DOM selector, centralized
src/templates.js                   category template token substitution
templates/blank/prospects.xlsx     blank template reps fill in and upload
templates/categories/*.json        placeholder category definitions
scripts/generate-template.js       generates the blank template
scripts/generate-test-sheet.js     generates the excel.js test fixture sheet
scripts/run-test-batch.js          manual test batch — sends/schedules real mail
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

## Public API (`src/templates.js`)

- `resolveTemplate(categoryJson, row)` → `{ to, subject, body }` — substitutes
  `{{Token}}` placeholders in a category's `subject`/`body` using the row's
  fields, case-insensitively (so both raw sheet columns like `Name` and
  `src/excel.js`'s lower-cased `name` work). A missing token substitutes to
  `''` and logs a warning; it never throws, and runs the same way whether
  `subject`/`body` are empty placeholders or real copy.
- `loadCategoryTemplates(dir)` → `Promise<Record<string, object>>` — reads
  `templates/categories/*.json` into a map of lower-cased category name →
  the full category object, for `resolveTemplate()` and `runBatch()` to use.

## Public API (`src/automation.js`)

- `launchBrowser({ userDataDir, headless? })` → `{ context, page }` — launches
  real installed Chrome against an already-authenticated profile and
  navigates to Gmail. Throws if `userDataDir` is omitted.
- `closeBrowser(context)` — closes the context from `launchBrowser()`.
- `composeMessage(page, { to, subject, body })` → a `Locator` scoped to the
  new compose dialog, with To/Subject/Body already filled in.
- `sendNow(page, composeHandle)` → `{ success, error? }` — clicks Send and
  confirms via the "Message sent" toast or the compose window closing;
  never assumes success just because nothing threw.
- `scheduleSend(page, composeHandle, { date, time })` → `{ success }` —
  drives Gmail's native scheduler and verifies its own confirmation toast;
  throws a specific error naming the missing selector if any step in the
  flow can't find what it's looking for (never silently falls back to
  send-now).
- `runBatch(rows, { mode, scheduleFor?, categories, page })` →
  `{ succeeded, failed }` — processes rows one at a time (Gmail UI
  automation isn't safely parallelizable); a malformed email or unknown
  category is caught defensively here even if it slipped past Sprint 1
  validation. One bad row never aborts the rest of the batch.

## Known open questions

Carried over from `PROJECT_CALIBRATION.md` — not yet blocking:

- Real category names/email copy pending from the team lead; the current
  `{ name, subject, body }` JSON shape is a placeholder, not locked.
- Realistic send volume vs. Gmail's daily sending caps hasn't been
  stress-tested.
- Mailsuite tracking verification (Lane B) hasn't happened yet — this
  sprint only builds against Gmail's own UI/confirmations, not Mailsuite.
- The manual batch script (`scripts/run-test-batch.js`) hasn't been run
  against a real Gmail account yet — it needs a machine with real Chrome,
  a display, and a logged-in test account, none of which this dev
  environment had. Selectors in `src/gmail-selectors.js` are a best-effort
  first pass and should be expected to need at least minor patching once
  run for real.
