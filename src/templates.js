/**
 * Token substitution for outreach templates. Works against Sprint 1's
 * placeholder category objects ({ name, subject, body }) today, and against
 * real copy once it lands, without any code change — empty strings and
 * missing tokens are both handled, never special-cased into a throw.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function substitute(text, lowerRow) {
  return String(text ?? '').replace(TOKEN_PATTERN, (_match, token) => {
    const key = token.toLowerCase();
    if (!(key in lowerRow)) {
      console.warn(`[templates] Missing value for token {{${token}}} — substituting empty string.`);
      return '';
    }
    return String(lowerRow[key] ?? '');
  });
}

/**
 * Resolves a category template against one prospect row.
 * @param {{name?: string, subject?: string, body?: string}} categoryJson - a category template, e.g. loaded from templates/categories/*.json.
 * @param {object} row - a prospect row; token lookup is case-insensitive, so
 *   both `{ Name, Email, Company, Category }` (raw sheet columns) and
 *   `{ name, email, company, category }` (src/excel.js's parsed shape) work.
 * @returns {{to: string, subject: string, body: string}}
 */
export function resolveTemplate(categoryJson, row) {
  const lowerRow = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    lowerRow[key.toLowerCase()] = value;
  }

  return {
    to: lowerRow.email ?? '',
    subject: substitute(categoryJson?.subject, lowerRow),
    body: substitute(categoryJson?.body, lowerRow),
  };
}

/**
 * Reads templates/categories/*.json into a map of category name (trimmed,
 * lower-cased) → the full category object, for resolveTemplate() to consume.
 * @param {string} dir - directory containing category JSON files.
 * @returns {Promise<Record<string, {name: string, subject: string, body: string}>>}
 */
export async function loadCategoryTemplates(dir) {
  const files = await readdir(dir);
  const templates = {};

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await readFile(join(dir, file), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.name === 'string' && data.name.trim()) {
      templates[data.name.trim().toLowerCase()] = data;
    }
  }

  return templates;
}
