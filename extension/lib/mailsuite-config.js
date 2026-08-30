/**
 * Pure per-category Mailsuite config logic — zero I/O, zero environment
 * APIs, same rationale as validate.js/sheet-rows.js: copied verbatim into
 * extension/lib/mailsuite-config.js by scripts/build-extension.js so the
 * shape/validation rules only exist once.
 *
 * Per the pivot doc's TL-confirmed requirement, real email templates live
 * inside Mailsuite's own template library, not in this repo — but the
 * *mapping* from a category to (a) which Mailsuite template to pick in its
 * dropdown and (b) that template's exact placeholder syntax has to be
 * captured somewhere version-controlled. That's what
 * templates/categories/*.json's `mailsuiteTemplateName`/`placeholders`
 * fields are for. Real values are NOT filled in yet (Sprint 6) — every
 * category file currently ships an obviously-fake `"FIXTURE — ..."` name so
 * a real send attempt fails loudly instead of silently matching nothing.
 * Swapping in real values from the TL/live Mailsuite dashboard is a data
 * change to these JSON files, not a code change here.
 */

/**
 * Validates and normalizes one category definition's Mailsuite mapping.
 * Throws — deliberately, not a warning/error array like validateRows() —
 * because a malformed category config is a repo/data bug for a developer to
 * fix, not row-level user data a rep can be shown a review screen about.
 * @param {{name?: string, mailsuiteTemplateName?: string, subject?: string, placeholders?: {name?: string, company?: string}}} definition
 * @returns {{categoryName: string, mailsuiteTemplateName: string, subject: string, placeholders: {name: string, company: string}}}
 */
export function parseMailsuiteConfig(definition) {
  const categoryName = definition?.name?.trim();
  if (!categoryName) {
    throw new Error('Category definition is missing its "name" field.');
  }

  const mailsuiteTemplateName = definition?.mailsuiteTemplateName?.trim();
  if (!mailsuiteTemplateName) {
    throw new Error(
      `Category "${categoryName}" is missing "mailsuiteTemplateName" — every category needs ` +
        'the exact template name as it appears in Mailsuite\'s dropdown.',
    );
  }

  const subject = definition?.subject?.trim();
  if (!subject) {
    throw new Error(`Category "${categoryName}" is missing "subject" — every category needs a subject line.`);
  }

  const namePlaceholder = definition?.placeholders?.name?.trim();
  const companyPlaceholder = definition?.placeholders?.company?.trim();
  if (!namePlaceholder || !companyPlaceholder) {
    throw new Error(
      `Category "${categoryName}" is missing "placeholders.name" and/or "placeholders.company" — ` +
        "both are required to personalize that category's Mailsuite template.",
    );
  }

  return {
    categoryName,
    mailsuiteTemplateName,
    subject,
    placeholders: { name: namePlaceholder, company: companyPlaceholder },
  };
}

/**
 * Builds a lower-cased-category-name -> Mailsuite config map from a list of
 * already-parsed category JSON objects (Node's fs.readFile()+JSON.parse or
 * the extension's fetch()+.json() — the I/O differs, this doesn't care).
 * @param {Array<object>} categoryDefinitions
 * @returns {Map<string, {categoryName: string, mailsuiteTemplateName: string, placeholders: {name: string, company: string}}>}
 */
export function buildMailsuiteConfigMap(categoryDefinitions) {
  const map = new Map();
  for (const definition of categoryDefinitions) {
    const config = parseMailsuiteConfig(definition);
    map.set(config.categoryName.toLowerCase(), config);
  }
  return map;
}
