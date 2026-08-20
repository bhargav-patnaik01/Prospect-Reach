/**
 * Excel ingestion, validation, archiving, and partial-run-safe commit logic
 * for the prospects sheet. No console output here — logging belongs to the
 * caller (scripts, tests, and eventually the UI layer).
 */
import ExcelJS from 'exceljs';
import { access, appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join } from 'node:path';

/** Column headers, in order, expected in the prospects sheet. */
export const COLUMNS = ['Name', 'Email', 'Company', 'Category'];

/** The styled sample row shipped in the blank template; never real data. */
export const EXAMPLE_ROW = ['Jane Doe', 'jane@example.com', 'Acme Co', 'Partnership'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reads templates/categories/*.json and returns the set of known category
 * names (trimmed, lower-cased) that validateRows() checks rows against.
 * @param {string} dir - directory containing category JSON files.
 * @returns {Promise<Set<string>>}
 */
export async function loadCategories(dir) {
  const files = await readdir(dir);
  const names = new Set();

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readFile(join(dir, file), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.name === 'string' && data.name.trim()) {
      names.add(data.name.trim().toLowerCase());
    }
  }

  return names;
}

/**
 * Parses an uploaded prospects sheet into raw row objects keyed by
 * lower-cased column name (name/email/company/category), each tagged with
 * its 1-based sheet row number as `__row`. The header row is excluded.
 * @param {string | Buffer} input - file path or in-memory buffer.
 * @returns {Promise<Array<{__row: number, name?: string, email?: string, company?: string, category?: string}>>}
 */
export async function parseSheet(input) {
  const workbook = new ExcelJS.Workbook();
  if (Buffer.isBuffer(input)) {
    await workbook.xlsx.load(input);
  } else {
    await workbook.xlsx.readFile(input);
  }

  const sheet = workbook.worksheets[0];
  const headers = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim().toLowerCase();
  });

  const rows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (isRowBlank(row)) continue;

    const record = { __row: rowNumber };
    headers.forEach((header, colNumber) => {
      if (!header) return;
      record[header] = cellText(row.getCell(colNumber));
    });
    rows.push(record);
  }

  return rows;
}

function isRowBlank(row) {
  let blank = true;
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
      blank = false;
    }
  });
  return blank;
}

function cellText(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  return String(cell.value).trim();
}

function matchesExampleRow(row) {
  return (
    row.name === EXAMPLE_ROW[0] &&
    row.email === EXAMPLE_ROW[1] &&
    row.company === EXAMPLE_ROW[2] &&
    row.category === EXAMPLE_ROW[3]
  );
}

/**
 * Validates raw parsed rows against the known category set. Never throws on
 * bad data — bad rows are reported as structured errors/warnings instead.
 * @param {Array<object>} rawRows - output of parseSheet().
 * @param {Set<string>} knownCategories - output of loadCategories().
 * @returns {{ready: object[], warnings: object[], errors: object[]}}
 */
export function validateRows(rawRows, knownCategories) {
  const ready = [];
  const warnings = [];
  const errors = [];

  for (const row of rawRows) {
    if (matchesExampleRow(row)) continue;

    let hasError = false;
    const email = row.email ?? '';

    if (!email || !EMAIL_PATTERN.test(email)) {
      errors.push({
        row: row.__row,
        column: 'Email',
        message: email ? `Malformed email: "${email}"` : 'Email is missing',
      });
      hasError = true;
    }

    const category = row.category ?? '';
    const categoryKnown = category && knownCategories.has(category.trim().toLowerCase());
    if (!categoryKnown) {
      warnings.push({
        row: row.__row,
        column: 'Category',
        message: category ? `Unrecognized category: "${category}"` : 'Category is missing',
      });
    }

    if (!hasError) {
      ready.push(row);
    }
  }

  return { ready, warnings, errors };
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Appends processed rows to a CSV archive, each stamped with the time it was
 * archived. Writes a header line first if the archive doesn't exist yet.
 * @param {Array<object>} rows - rows to archive (name/email/company/category).
 * @param {string} archivePath - path to the archive CSV.
 * @param {{now?: () => string}} [options] - inject a clock for deterministic tests.
 */
export async function archiveToCsv(rows, archivePath, { now = () => new Date().toISOString() } = {}) {
  await mkdir(dirname(archivePath), { recursive: true });

  let fileExists = true;
  try {
    await access(archivePath);
  } catch {
    fileExists = false;
  }

  const lines = [];
  if (!fileExists) {
    lines.push(['Name', 'Email', 'Company', 'Category', 'SentAt'].map(csvEscape).join(','));
  }
  for (const row of rows) {
    lines.push([row.name, row.email, row.company, row.category, now()].map(csvEscape).join(','));
  }

  await appendFile(archivePath, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Clears all data rows after a completed run, preserving the header row
 * (row 1) and the styled example row (row 2) so the sheet is ready to reuse.
 * @param {string} sheetPath - path to the working prospects sheet.
 */
export async function resetSheet(sheetPath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sheetPath);
  const sheet = workbook.worksheets[0];

  for (let rowNumber = sheet.rowCount; rowNumber > 2; rowNumber -= 1) {
    sheet.spliceRows(rowNumber, 1);
  }

  await workbook.xlsx.writeFile(sheetPath);
}

/**
 * Reads the last-known commit checkpoint, or an empty one if none exists.
 * @param {string} checkpointPath
 * @returns {Promise<{sentRowNumbers: number[]}>}
 */
export async function readCheckpoint(checkpointPath) {
  try {
    const raw = await readFile(checkpointPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { sentRowNumbers: [] };
  }
}

async function writeCheckpoint(checkpointPath, sentRowNumbers) {
  await mkdir(dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, JSON.stringify({ sentRowNumbers }, null, 2), 'utf8');
}

/**
 * Processes ready rows one at a time through the injected `send` callback,
 * archiving and checkpointing after each successful send. If `send` throws,
 * the run stops immediately: everything sent so far is already archived and
 * checkpointed, and every unsent row is returned in `remainingRows` and left
 * untouched in the working sheet — nothing is dropped. `resetSheet` is only
 * called when every row sends successfully.
 * @param {object} args
 * @param {object[]} args.rows - validated, ready rows to send (each with `__row`).
 * @param {(row: object) => Promise<void>} args.send - injected send callback.
 * @param {string} args.archivePath - CSV archive path.
 * @param {string} args.sheetPath - working sheet path, reset only on full success.
 * @param {string} args.checkpointPath - progress checkpoint file path.
 * @returns {Promise<{sent: number, remaining: number, remainingRows: object[], failure: {row: number, message: string} | null}>}
 */
export async function commitRun({ rows, send, archivePath, sheetPath, checkpointPath }) {
  const sent = [];
  let failure = null;

  for (const row of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await send(row);
    } catch (error) {
      failure = { row: row.__row, message: error.message };
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    await archiveToCsv([row], archivePath);
    sent.push(row);
    // eslint-disable-next-line no-await-in-loop
    await writeCheckpoint(checkpointPath, sent.map((r) => r.__row));
  }

  const remainingRows = rows.slice(sent.length);

  if (!failure && remainingRows.length === 0) {
    await resetSheet(sheetPath);
  }

  return {
    sent: sent.length,
    remaining: remainingRows.length,
    remainingRows,
    failure,
  };
}
