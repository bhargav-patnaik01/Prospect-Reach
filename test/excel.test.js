import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  loadCategories,
  parseSheet,
  validateRows,
  commitRun,
  readCheckpoint,
} from '../src/excel.js';
import { generateTestSheet, BAD_ROW } from '../scripts/generate-test-sheet.js';

const CATEGORIES_DIR = join(import.meta.dirname, '..', 'templates', 'categories');

let workDir;
let fixturePath;

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'prospect-reach-test-'));
  fixturePath = join(workDir, 'prospects.fixture.xlsx');
  await generateTestSheet(fixturePath);
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test('validateRows: skips the example row, isolates the bad row, passes valid rows through', async () => {
  const knownCategories = await loadCategories(CATEGORIES_DIR);
  const rawRows = await parseSheet(fixturePath);
  const result = validateRows(rawRows, knownCategories);

  console.log('validateRows result:', JSON.stringify(result, null, 2));

  const badRow = rawRows.find((row) => row.name === BAD_ROW[0]);
  assert.ok(badRow, 'fixture must contain the deliberately bad row');

  const errorsForBadRow = result.errors.filter((e) => e.row === badRow.__row);
  const warningsForBadRow = result.warnings.filter((w) => w.row === badRow.__row);
  assert.equal(errorsForBadRow.length, 1, 'bad row should produce exactly one error');
  assert.equal(warningsForBadRow.length, 1, 'bad row should produce exactly one warning');
  assert.equal(errorsForBadRow[0].column, 'Email');
  assert.equal(warningsForBadRow[0].column, 'Category');

  const exampleRow = rawRows.find((row) => row.name === 'Jane Doe');
  assert.ok(exampleRow, 'fixture must contain the untouched example row');
  assert.ok(!result.ready.some((row) => row.__row === exampleRow.__row));
  assert.ok(!result.warnings.some((w) => w.row === exampleRow.__row));
  assert.ok(!result.errors.some((e) => e.row === exampleRow.__row));

  assert.equal(result.ready.length, 5, 'the 5 valid rows should be ready');
  assert.ok(!result.ready.some((row) => row.__row === badRow.__row), 'bad row must not be ready');
});

test('commitRun: a send failure mid-run leaves unsent rows recoverable and never drops them', async () => {
  const knownCategories = await loadCategories(CATEGORIES_DIR);
  const rawRows = await parseSheet(fixturePath);
  const { ready } = validateRows(rawRows, knownCategories);
  assert.equal(ready.length, 5);

  const sheetPath = join(workDir, 'prospects.run.xlsx');
  await copyFile(fixturePath, sheetPath);
  const archivePath = join(workDir, 'archive.csv');
  const checkpointPath = join(workDir, 'checkpoint.json');

  const FAIL_AT_INDEX = 2; // 3rd ready row throws
  const sendLog = [];
  const send = async (row) => {
    if (sendLog.length === FAIL_AT_INDEX) {
      throw new Error(`simulated send failure for row ${row.__row}`);
    }
    sendLog.push(row.__row);
  };

  const summary = await commitRun({ rows: ready, send, archivePath, sheetPath, checkpointPath });

  assert.equal(summary.sent, FAIL_AT_INDEX, 'only rows before the failure should be sent');
  assert.equal(summary.remaining, ready.length - FAIL_AT_INDEX);
  assert.ok(summary.failure, 'summary must record the failure');
  assert.equal(summary.failure.row, ready[FAIL_AT_INDEX].__row);

  const remainingRowNumbers = summary.remainingRows.map((r) => r.__row);
  const expectedRemaining = ready.slice(FAIL_AT_INDEX).map((r) => r.__row);
  assert.deepEqual(remainingRowNumbers, expectedRemaining, 'unsent rows must be returned, none dropped');

  const checkpoint = await readCheckpoint(checkpointPath);
  assert.deepEqual(checkpoint.sentRowNumbers, ready.slice(0, FAIL_AT_INDEX).map((r) => r.__row));

  const archiveContents = await readFile(archivePath, 'utf8');
  const archivedLines = archiveContents.trim().split('\n');
  assert.equal(archivedLines.length, 1 + FAIL_AT_INDEX, 'header + sent rows only');

  const stillInSheet = await parseSheet(sheetPath);
  const stillPresentRows = new Set(stillInSheet.map((r) => r.__row));
  for (const rowNumber of expectedRemaining) {
    assert.ok(stillPresentRows.has(rowNumber), `unsent row ${rowNumber} must survive in the working sheet`);
  }
});
