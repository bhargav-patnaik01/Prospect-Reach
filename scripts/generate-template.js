/**
 * Deterministically generates templates/blank/prospects.xlsx.
 *
 * Run with `npm run generate:template`. Re-running overwrites the committed
 * file with byte-for-byte equivalent structure (same columns, styles, and
 * example row) — only exceljs/zip metadata timestamps may differ, which is
 * expected and harmless.
 */
import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS, EXAMPLE_ROW } from '../src/excel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'templates', 'blank', 'prospects.xlsx');

async function main() {
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Prospects');

  sheet.columns = COLUMNS.map((header) => ({ header, width: 24 }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.protection = { locked: true };
  });

  const exampleRow = sheet.getRow(2);
  exampleRow.values = EXAMPLE_ROW;
  exampleRow.font = { italic: true };
  exampleRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9D9D9' },
    };
    // Data rows stay unlocked so the rep can type over/around the example
    // once sheet protection is enabled below — only the header is locked.
    cell.protection = { locked: false };
  });

  // Every other cell in the sheet must be explicitly unlocked, otherwise
  // exceljs's sheet protection defaults all cells to locked.
  for (let rowNumber = 3; rowNumber <= 200; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    for (let col = 1; col <= COLUMNS.length; col += 1) {
      row.getCell(col).protection = { locked: false };
    }
  }

  await sheet.protect('', { selectLockedCells: true, selectUnlockedCells: true });

  await workbook.xlsx.writeFile(OUTPUT_PATH);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
