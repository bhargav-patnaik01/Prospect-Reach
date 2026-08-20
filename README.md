# Prospect Reach

Local sales outreach automation tool. This sprint builds the foundation only:
repo scaffold, the blank Excel template, and the Excel ingestion/validation/
archiving layer (`src/excel.js`). No UI, no Express server, no Playwright
automation, and no real email content yet — those are later sprints.

## Setup

```
npm install
npm run generate:template   # (re)generates templates/blank/prospects.xlsx
npm test                    # runs the excel.js test suite
```

Requires Node.js 18+ (ES modules).

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
templates/blank/prospects.xlsx     blank template reps fill in and upload
templates/categories/*.json        placeholder category definitions
scripts/generate-template.js       generates the blank template
scripts/generate-test-sheet.js     generates the test fixture sheet
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

## Known open questions

Carried over from `PROJECT_CALIBRATION.md` — not yet blocking:

- Real category names/email copy pending from the team lead; the current
  `{ name, subject, body }` JSON shape is a placeholder, not locked.
- Realistic send volume vs. Gmail's daily sending caps hasn't been
  stress-tested.
- Mailsuite tracking verification is out of scope for this sprint (no
  browser automation yet).
