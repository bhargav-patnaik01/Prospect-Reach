/**
 * Extension-specific I/O glue around the shared, environment-agnostic logic
 * in lib/validate.js and lib/sheet-rows.js (both copied verbatim from
 * src/ by scripts/build-extension.js — do not hand-edit them here).
 *
 * This file has no Node equivalent: it's the browser side of the fork in
 * src/excel.js's Node-only loadCategories()/parseSheet() functions. It runs
 * in the side panel page context (a normal `chrome-extension://` page — has
 * `window`/`fetch`/`FileReader`, unlike a content script or service worker),
 * using the vendored ExcelJS browser UMD build (vendor/exceljs.min.js,
 * loaded as a plain <script> before this file — see sidepanel.html) instead
 * of the Node `exceljs` package import.
 */
import { extractRows } from './sheet-rows.js';

/**
 * Reads templates/categories/*.json bundled with the extension and returns
 * the set of known category names (trimmed, lower-cased) — the browser
 * equivalent of src/excel.js's loadCategories(dir), which reads the same
 * files off disk with `fs`. Requires manual "Load unpacked" verification:
 * fetching a chrome-extension:// URL only works from an actual extension
 * page context, not a plain Node test — see PROJECT_CALIBRATION.md.
 * @param {string[]} fileNames - category JSON file names, relative to templates/categories/.
 * @returns {Promise<Set<string>>}
 */
export async function loadCategoriesBrowser(fileNames) {
  const names = new Set();

  for (const fileName of fileNames) {
    const url = chrome.runtime.getURL(`templates/categories/${fileName}`);
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(url);
    // eslint-disable-next-line no-await-in-loop
    const data = await response.json();
    if (data && typeof data.name === 'string' && data.name.trim()) {
      names.add(data.name.trim().toLowerCase());
    }
  }

  return names;
}

/**
 * Parses an uploaded prospects sheet (already read into an ArrayBuffer via
 * FileReader.readAsArrayBuffer) into the same raw row shape src/excel.js's
 * parseSheet() produces. Uses the globally-loaded browser ExcelJS build
 * (window.ExcelJS) plus the shared extractRows() — see sheet-rows.js.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<Array<object>>}
 */
export async function parseSheetFromArrayBuffer(arrayBuffer) {
  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  return extractRows(workbook);
}

/**
 * Builds CSV lines for a completed batch, mirroring src/excel.js's
 * archiveToCsv() row/column shape. Design-only this sprint (Sprint 5) — no
 * campaign run exists yet to call this from. Once Sprint 7 adds a working
 * "Run Campaign," this is what feeds a `chrome.downloads.download()` call
 * (Blob + `URL.createObjectURL`) instead of `fs.appendFile`.
 * @param {Array<{name: string, email: string, company: string, category: string}>} rows
 * @param {{now?: () => string}} [options]
 * @returns {string} CSV text, including header row.
 */
export function buildArchiveCsv(rows, { now = () => new Date().toISOString() } = {}) {
  const escape = (value) => {
    const str = String(value ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const lines = [['Name', 'Email', 'Company', 'Category', 'SentAt'].map(escape).join(',')];
  for (const row of rows) {
    lines.push([row.name, row.email, row.company, row.category, now()].map(escape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

const BATCH_STORAGE_KEY = 'prospectBatch';

/**
 * Persists the current parsed/validated batch to chrome.storage.session —
 * deliberately session storage, not local: prospect data (names, emails)
 * shouldn't linger on disk between browser restarts, and nothing here needs
 * to survive one. This is what keeps the review table intact if the rep
 * closes and reopens the side panel mid-review, without ever writing PII to
 * disk the way the old filesystem-based working sheet did.
 * @param {{fileName: string, rawRows: object[], result: {ready: object[], warnings: object[], errors: object[]}}} batch
 */
export async function saveBatch(batch) {
  await chrome.storage.session.set({ [BATCH_STORAGE_KEY]: batch });
}

/** @returns {Promise<object | null>} the persisted batch, or null if none. */
export async function loadBatch() {
  const stored = await chrome.storage.session.get(BATCH_STORAGE_KEY);
  return stored[BATCH_STORAGE_KEY] ?? null;
}

/**
 * Clears the persisted batch — the browser equivalent of src/excel.js's
 * resetSheet(), minus any file to reset: there's no working .xlsx on disk
 * to clear rows from, just this one piece of session state.
 */
export async function resetBatch() {
  await chrome.storage.session.remove(BATCH_STORAGE_KEY);
}
