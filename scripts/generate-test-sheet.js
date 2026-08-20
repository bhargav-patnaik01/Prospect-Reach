/**
 * Builds a deterministic fixture prospects sheet for test/excel.test.js:
 * the untouched example row, several valid rows spanning known categories,
 * and one deliberately bad row (malformed email + unrecognized category).
 */
import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { COLUMNS, EXAMPLE_ROW } from '../src/excel.js';

/** Valid fixture rows, in sheet order, following the example row. */
export const VALID_ROWS = [
  ['Alice Adams', 'alice@example.com', 'Alpha Inc', 'Partnership'],
  ['Bob Brown', 'bob@example.com', 'Beta LLC', 'Cold Outreach'],
  ['Carol Chen', 'carol@example.com', 'Gamma Co', 'Newsletter'],
  ['Dan Diaz', 'dan@example.com', 'Delta Ltd', 'partnership'],
  ['Eve Evans', 'eve@example.com', 'Epsilon Co', 'Cold Outreach'],
];

/** The deliberately bad row: malformed email + unrecognized category. */
export const BAD_ROW = ['Frank Faulty', 'not-an-email', 'Zeta Co', 'Bogus Category'];

/**
 * Writes the fixture workbook to `outputPath`.
 * @param {string} outputPath
 */
export async function generateTestSheet(outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Prospects');
  sheet.columns = COLUMNS.map((header) => ({ header, width: 24 }));

  sheet.addRow(EXAMPLE_ROW);
  VALID_ROWS.slice(0, 2).forEach((row) => sheet.addRow(row));
  sheet.addRow(BAD_ROW);
  VALID_ROWS.slice(2).forEach((row) => sheet.addRow(row));

  await workbook.xlsx.writeFile(outputPath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = process.argv[2] ?? 'test/fixtures/prospects.test.xlsx';
  await generateTestSheet(outputPath);
  console.log(`Wrote ${outputPath}`);
}
