/**
 * Pure validation logic for parsed prospects rows — zero I/O, zero
 * environment-specific APIs (no `fs`, no `chrome.*`). Runs identically under
 * Node (src/excel.js, test/excel.test.js) and inside the extension (copied
 * verbatim into extension/lib/validate.js by scripts/build-extension.js),
 * so the row-validation rules only ever exist in one place.
 */

/** Column headers, in order, expected in the prospects sheet. */
export const COLUMNS = ['Name', 'Email', 'Company', 'Category'];

/** The styled sample row shipped in the blank template; never real data. */
export const EXAMPLE_ROW = ['Jane Doe', 'jane@example.com', 'Acme Co', 'Partnership'];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * @param {Array<object>} rawRows - output of a parseSheet()-shaped function.
 * @param {Set<string>} knownCategories - lower-cased known category names.
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
