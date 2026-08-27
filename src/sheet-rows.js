/**
 * Pure row-extraction logic for an already-loaded ExcelJS workbook — no I/O,
 * no `fs`, no environment-specific APIs. Only calls documented ExcelJS
 * workbook/worksheet APIs, which are identical between the Node build
 * (`exceljs`) and the browser UMD build (`exceljs.min.js`) bundled into the
 * extension — so this file is safe to share unmodified between src/excel.js
 * (Node, fs-backed) and extension/lib/browser-excel.js (fetch/File-backed).
 * Copied verbatim into extension/lib/sheet-rows.js by
 * scripts/build-extension.js.
 */

/**
 * Extracts raw row objects from an ExcelJS workbook's first worksheet, keyed
 * by lower-cased column name, each tagged with its 1-based sheet row number
 * as `__row`. The header row (row 1) is excluded.
 * @param {import('exceljs').Workbook} workbook
 * @returns {Array<{__row: number, name?: string, email?: string, company?: string, category?: string}>}
 */
export function extractRows(workbook) {
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
