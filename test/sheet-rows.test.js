/**
 * Proves that src/sheet-rows.js and src/validate.js — the two modules copied
 * verbatim into extension/lib/ by scripts/build-extension.js — behave
 * identically here (loaded via the Node `exceljs` build) as they will inside
 * the extension (loaded via the browser `exceljs.min.js` UMD build). Both
 * builds implement the same documented ExcelJS Workbook/Worksheet API, so
 * this is a legitimate parity check, not a simulation — see
 * PROJECT_CALIBRATION.md's Sprint 5 notes for why the extension's ExcelJS
 * bundle itself isn't exercised here (it requires a real browser/extension
 * context, which is a manual "Load unpacked" verification, not a unit test).
 */
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { extractRows } from '../src/sheet-rows.js';
import { validateRows, COLUMNS } from '../src/validate.js';
import { generateTestSheet, BAD_ROW } from '../scripts/generate-test-sheet.js';
import { loadCategories } from '../src/excel.js';

const CATEGORIES_DIR = join(import.meta.dirname, '..', 'templates', 'categories');

let workDir;
let fixturePath;

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'prospect-reach-sheet-rows-test-'));
  fixturePath = join(workDir, 'prospects.fixture.xlsx');
  await generateTestSheet(fixturePath);
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test('extractRows: reads header + data rows from a workbook loaded from a Buffer, matching parseSheet()', async () => {
  const buffer = await readFile(fixturePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rows = extractRows(workbook);

  assert.equal(rows.length, 7, 'example row + 5 valid rows + 1 bad row');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['__row', 'category', 'company', 'email', 'name'].sort());

  const badRow = rows.find((r) => r.name === BAD_ROW[0]);
  assert.ok(badRow, 'bad row must be extracted like any other row');
  assert.equal(badRow.email, 'not-an-email');
});

test('extractRows + validateRows composed the same way parseSheet()/excel.js compose them, from a Buffer (the shape the browser port receives via FileReader.readAsArrayBuffer)', async () => {
  const buffer = await readFile(fixturePath);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const rawRows = extractRows(workbook);

  const knownCategories = await loadCategories(CATEGORIES_DIR);
  const result = validateRows(rawRows, knownCategories);

  assert.equal(result.ready.length, 5);
  assert.equal(result.errors.length, 1);
  assert.equal(result.warnings.length, 1);
});

test('COLUMNS is re-exported unchanged from validate.js (single source of truth for template generation)', () => {
  assert.deepEqual(COLUMNS, ['Name', 'Email', 'Company', 'Category']);
});
